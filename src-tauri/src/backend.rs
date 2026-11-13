use sentinel_core::{
    Store, diagnostics::*, domain::*, gateway::ModelGateway, runner::Cancellation,
    tools::ToolRegistry,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
type Result<T> = std::result::Result<T, String>;

pub struct Backend {
    pub store: Mutex<Store>,
    pub tools: Arc<Mutex<ToolRegistry>>,
    pub gateway: Mutex<ModelGateway>,
    pub model_settings_path: Option<std::path::PathBuf>,
    active: Mutex<HashMap<String, Cancellation>>,
    failures: Mutex<HashMap<String, String>>,
}
impl Backend {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
            tools: Arc::new(Mutex::new(ToolRegistry::default())),
            gateway: Mutex::new(ModelGateway::default()),
            model_settings_path: None,
            active: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
        }
    }
    pub fn run_error(&self, id: &str) -> Result<()> {
        if self
            .failures
            .lock()
            .map_err(|_| "运行服务不可用。")?
            .contains_key(id)
        {
            return Err(
                "后台结果未能保存；请检查空间/目录权限并重新打开应用恢复，不要将此轮视为通过。"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn with_model_settings(mut self, path: std::path::PathBuf) -> Self {
        if path.exists() {
            if let Ok(config) = sentinel_core::provider::load_config(&path) {
                if let Ok(provider) = sentinel_core::provider::HttpsJsonProvider::new(config) {
                    self.gateway = Mutex::new(ModelGateway::with_provider(Arc::new(provider)));
                }
            }
        }
        self.model_settings_path = Some(path);
        self
    }
    pub fn configure_model(&self, config: sentinel_core::provider::ModelConfig) -> Result<()> {
        let path = self
            .model_settings_path
            .as_ref()
            .ok_or("未配置模型凭据目录。")?;
        let provider = sentinel_core::provider::HttpsJsonProvider::new(config.clone())?;
        sentinel_core::provider::save_config(path, &config)?;
        *self.gateway.lock().map_err(|_| "模型服务不可用。")? =
            ModelGateway::with_provider(Arc::new(provider));
        Ok(())
    }
    pub fn clear_model(&self) -> Result<()> {
        if let Some(path) = &self.model_settings_path {
            if path.exists() {
                sentinel_core::artifacts::checked_local_path(path)?;
                std::fs::remove_file(path).map_err(|_| "模型凭据删除失败。")?;
            }
        }
        *self.gateway.lock().map_err(|_| "模型服务不可用。")? = ModelGateway::default();
        Ok(())
    }
    pub fn start(self: &Arc<Self>, request: StartRequest) -> Result<CaseRecord> {
        let c = self
            .store
            .lock()
            .map_err(|_| "案例服务不可用。")?
            .get(&request.case_id)?;
        if c.diagnostic.is_none() {
            return self
                .store
                .lock()
                .map_err(|_| "案例服务不可用。")?
                .start(request);
        }
        let mut active = self.active.lock().map_err(|_| "运行服务不可用。")?;
        let mut store = self.store.lock().map_err(|_| "案例服务不可用。")?;
        let c = store.get(&request.case_id)?;
        if let Some(plan) = &c.plan {
            for a in &plan.actions {
                if a.action_id == "storage.smartctl_read" {
                    self.tools
                        .lock()
                        .map_err(|_| "工具服务不可用。")?
                        .validate_device(
                            a.tool_token.as_deref().ok_or("缺少工具标识。")?,
                            a.device_token.as_deref().ok_or("缺少设备标识。")?,
                        )?;
                    let identity = self
                        .tools
                        .lock()
                        .map_err(|_| "工具服务不可用。")?
                        .identity(a.tool_token.as_deref().ok_or("缺少工具标识。")?)?;
                    if plan.tool_identity.as_ref() != Some(&identity) {
                        return Err("工具身份已变化，请重新预览并确认。".into());
                    }
                }
            }
        }
        if active.len() >= 2
            && !c
                .diagnostic
                .as_ref()
                .and_then(|d| d.runs.last())
                .is_some_and(|r| active.contains_key(&r.id))
        {
            return Err("已有两轮检查运行，请等待结束。".into());
        }
        let begun = store.begin_native_run(request)?;
        let Some(work) = begun.work else {
            return Ok(begun.record);
        };
        let cancel = Cancellation::default();
        let run_id = work.run_id.clone();
        active.insert(run_id.clone(), cancel.clone());
        drop(store);
        drop(active);
        let backend = self.clone();
        let worker_run = run_id.clone();
        let spawn = std::thread::Builder::new()
            .name("sentinel-diagnostics".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    sentinel_core::execution::execute(&work, &backend.tools, &cancel)
                }));
                let (report, tasks) = match result {
                    Ok(Ok(result)) => result,
                    _ => {
                        let report = sentinel_core::execution::failure_report(
                            "后台执行未能提交结果；未自动重跑。",
                        );
                        let tasks = vec![TaskResult {
                            action_id: "runner".into(),
                            status: "failed".into(),
                            detail: "后台执行失败。".into(),
                            exit_code: None,
                            artifact_id: None,
                        }];
                        (report, tasks)
                    }
                };
                let saved = match backend.store.lock() {
                    Ok(mut store) => store
                        .finish_native_run(
                            &work.record.id,
                            &worker_run,
                            report,
                            tasks,
                            cancel.is_cancelled(),
                        )
                        .map(|_| ()),
                    Err(_) => Err("案例存储不可用。".into()),
                };
                if saved.is_err() {
                    if let Ok(mut failures) = backend.failures.lock() {
                        failures.insert(worker_run.clone(), "结果保存失败。".into());
                    }
                }
                if let Ok(mut active) = backend.active.lock() {
                    active.remove(&worker_run);
                }
            });
        if spawn.is_err() {
            // Return a recoverable interrupted state rather than leaving a nonexistent worker collecting.
            if let Ok(mut active) = self.active.lock() {
                active.remove(&run_id);
            }
            if let Ok(mut store) = self.store.lock() {
                let report = sentinel_core::execution::failure_report("无法创建后台线程。");
                let _ = store.finish_native_run(
                    &begun.record.id,
                    &run_id,
                    report,
                    vec![TaskResult {
                        action_id: "runner".into(),
                        status: "failed".into(),
                        detail: "后台线程未创建。".into(),
                        exit_code: None,
                        artifact_id: None,
                    }],
                    false,
                );
            }
            return Err("无法创建后台检查，请新建复测后重试。".into());
        }
        Ok(begun.record)
    }
    pub fn cancel(&self, r: RunRequest) -> Result<CaseRecord> {
        let active = self.active.lock().map_err(|_| "运行服务不可用。")?;
        let mut_result = self
            .store
            .lock()
            .map_err(|_| "案例服务不可用。")?
            .cancel_native_run(&r.case_id, &r.run_id)?;
        if let Some(cancel) = active.get(&r.run_id) {
            cancel.cancel();
        }
        Ok(mut_result)
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        if let Ok(active) = self.active.lock() {
            for c in active.values() {
                c.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asynchronous_import_run_is_pollable_and_idempotent() {
        let root = std::env::temp_dir().join(format!("sentinel-backend-{}", uuid_for_test()));
        std::fs::create_dir(&root).unwrap();
        let backend = Arc::new(Backend::new(
            Store::open(&root.join("metadata.sqlite")).unwrap(),
        ));
        let request: CreateCase = serde_json_for_test();
        let c = backend.store.lock().unwrap().create(request).unwrap();
        backend
            .store
            .lock()
            .unwrap()
            .import_bytes(
                &c.id,
                sentinel_core::parsers::ReportFormat::SmartctlJson,
                include_bytes!("../../tests/fixtures/reports/smartctl-ata-alert.json"),
            )
            .unwrap();
        let c = backend
            .store
            .lock()
            .unwrap()
            .build_import_plan(&c.id)
            .unwrap();
        let p = c.plan.unwrap();
        let consent = backend
            .store
            .lock()
            .unwrap()
            .approve(ApproveRequest {
                case_id: c.id.clone(),
                plan_id: p.id.clone(),
                plan_hash: p.hash.clone(),
            })
            .unwrap();
        let request = StartRequest {
            case_id: c.id.clone(),
            plan_id: p.id,
            plan_hash: p.hash,
            consent_token: consent.token,
        };
        let initial = backend.start(request.clone()).unwrap();
        assert_eq!(initial.status, "collecting");
        let start = std::time::Instant::now();
        loop {
            let c = backend.store.lock().unwrap().get(&c.id).unwrap();
            if c.report.is_some() {
                break;
            }
            assert!(start.elapsed() < std::time::Duration::from_secs(3));
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let repeated = backend.start(request).unwrap();
        assert!(repeated.report.is_some());
        assert_eq!(repeated.diagnostic.unwrap().runs.len(), 1);
        // Wait for worker cleanup before removing the application-owned temporary directory.
        while !backend.active.lock().unwrap().is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        drop(backend);
        std::fs::remove_dir_all(root).unwrap();
    }
    fn uuid_for_test() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }
    fn serde_json_for_test() -> CreateCase {
        CreateCase {
            scenario_id: String::new(),
            symptom: "合成测试".into(),
            incident_start_utc: "2026-11-12T01:53:00Z".into(),
            incident_end_utc: "2026-11-12T02:13:00Z".into(),
            display_timezone: "UTC".into(),
            environment: "personal".into(),
            category: Some(Category::StorageIo),
            interview: None,
        }
    }
}
