//! Backend API v3 integration (frontend is intentionally not changed here):
//! - create_setup_audit accepts optional environment/timezone, no symptom/category/interview.
//!   build_plan -> approve_plan -> start_plan runs the six fixed R0 checks with one consent.
//! - get_app_status keeps the legacy synthetic handshake; use get_backend_capabilities for v2.
//! - create_case: omit scenarioId, supply category and optional interview. The five old scenarioIds remain demo-only.
//! - build_plan -> approve_plan -> start_plan authorizes an entire fixed read-only package.
//!   Real start_plan returns collecting; poll get_run(caseId,runId) or get_case. cancel_run is independent.
//! - import_report opens a native picker (no arbitrary path in IPC); then build_import_plan analyzes selected reports.
//! - probe_tools does not execute. probe_storage_devices requires confirmed=true; build_tool_plan exposes path/hash
//!   before its separate approve/start. CDI is import-only, smartctl is scan/read-only, never a generic command.
//! - create_retest_run preserves prior reports; set_run_window sets the new observation interval before planning.
//! - configure_model stores user-scoped ciphertext; assist_interview/explain_report require allowModel=true to send.
//!   The default provider speaks DeepSeek-compatible Chat Completions. Legacy protocol is explicit.
//! - All requests use invoke(command,{request:dto}), camelCase and deny_unknown_fields.
mod backend;
mod file_dialog;
use backend::Backend;
use sentinel_core::{
    Store,
    artifacts::Artifact,
    authorize_window,
    diagnostics::*,
    domain::*,
    tools::{DeviceCandidate, ToolCandidate},
};
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};
type AppStore = Arc<Backend>;
type Result<T> = std::result::Result<T, String>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    version: &'static str,
    mode: &'static str,
    model_enabled: bool,
    real_collection_enabled: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendCapabilities {
    api_version: u32,
    real_collection_enabled: bool,
    model_configured: bool,
    supported_categories: Vec<Category>,
    report_import_enabled: bool,
    async_runs: bool,
    tool_execution: &'static str,
    model_target: Option<String>,
    model_protocol: &'static str,
    model_name: Option<String>,
    setup_audit_enabled: bool,
}
fn access(window: &WebviewWindow) -> Result<()> {
    authorize_window(window.label())
}
#[tauri::command]
fn get_app_status(window: WebviewWindow) -> Result<AppStatus> {
    access(&window)?;
    // Legacy handshake describes the preview; new callers use get_backend_capabilities.
    Ok(AppStatus {
        version: "0.1.0",
        mode: "native-synthetic",
        model_enabled: false,
        real_collection_enabled: false,
    })
}
#[tauri::command]
fn get_backend_capabilities(
    window: WebviewWindow,
    state: State<AppStore>,
) -> Result<BackendCapabilities> {
    access(&window)?;
    let gateway = state.gateway.lock().map_err(|_| "模型服务不可用。")?;
    Ok(BackendCapabilities {
        api_version: 3,
        real_collection_enabled: cfg!(windows),
        model_configured: gateway.enabled(),
        supported_categories: vec![
            Category::GamingDisplay,
            Category::RestartBsod,
            Category::StorageIo,
            Category::OfficePeripheral,
        ],
        report_import_enabled: cfg!(windows),
        async_runs: true,
        tool_execution: "smartctl_confirmed_read_only;crystal_disk_info_import_only",
        model_target: gateway.target(),
        model_protocol: gateway.protocol(),
        model_name: gateway.model(),
        setup_audit_enabled: cfg!(windows),
    })
}
#[tauri::command]
async fn get_hardware_info(
    window: WebviewWindow,
) -> Result<sentinel_core::hardware::HardwareSnapshot> {
    access(&window)?;
    tauri::async_runtime::spawn_blocking(sentinel_core::hardware::collect)
        .await
        .map_err(|_| "硬件信息读取失败。")?
}
#[tauri::command]
fn create_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CreateCase,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .create(request)
}
#[tauri::command]
fn create_setup_audit(
    window: WebviewWindow,
    state: State<AppStore>,
    request: SetupAuditRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .create_setup_audit(request)
}
#[tauri::command]
fn get_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    let case = state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .get(&request.case_id)?;
    if let Some(run) = case.diagnostic.as_ref().and_then(|d| d.runs.last()) {
        state.run_error(&run.id)?;
    }
    Ok(case)
}
#[tauri::command]
fn list_cases(window: WebviewWindow, state: State<AppStore>) -> Result<Vec<CaseRecord>> {
    access(&window)?;
    state.store.lock().map_err(|_| "案例服务不可用。")?.list()
}
#[tauri::command]
fn build_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .build_plan(&request.case_id)
}
#[tauri::command]
fn build_import_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .build_import_plan(&request.case_id)
}
#[tauri::command]
fn build_tool_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: ToolPlanRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    let identity = {
        let tools = state.tools.lock().map_err(|_| "工具服务不可用。")?;
        tools.validate_device(&request.tool_token, &request.device_token)?;
        tools.identity(&request.tool_token)?
    };
    let id = request.case_id.clone();
    let store = state.store.lock().map_err(|_| "案例服务不可用。")?;
    store.build_native_plan(&id, Some(request))?;
    store.bind_tool_identity(&id, identity)
}
#[tauri::command]
fn approve_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: ApproveRequest,
) -> Result<Consent> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .approve(request)
}
#[tauri::command]
async fn start_plan(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: StartRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || backend.start(request))
        .await
        .map_err(|_| "启动检查失败。")?
}
#[tauri::command]
fn cancel_run(
    window: WebviewWindow,
    state: State<AppStore>,
    request: RunRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state.cancel(request)
}
#[tauri::command]
fn get_run(
    window: WebviewWindow,
    state: State<AppStore>,
    request: RunRequest,
) -> Result<DiagnosticRun> {
    access(&window)?;
    state.run_error(&request.run_id)?;
    let c = state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .get(&request.case_id)?;
    c.diagnostic
        .and_then(|d| d.runs.into_iter().find(|r| r.id == request.run_id))
        .ok_or("运行不存在。".into())
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateInterview {
    case_id: String,
    context: InterviewContext,
}
#[tauri::command]
fn update_interview(
    window: WebviewWindow,
    state: State<AppStore>,
    request: UpdateInterview,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .update_interview(&request.case_id, request.context)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WindowRequest {
    case_id: String,
    incident_start_utc: String,
    incident_end_utc: String,
}
#[tauri::command]
fn set_run_window(
    window: WebviewWindow,
    state: State<AppStore>,
    request: WindowRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .set_run_window(
            &request.case_id,
            request.incident_start_utc,
            request.incident_end_utc,
        )
}
#[tauri::command]
fn create_retest_run(
    window: WebviewWindow,
    state: State<AppStore>,
    request: RetestRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .create_retest_run(request)
}
#[tauri::command]
async fn assist_interview(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: InterviewRequest,
) -> Result<InterviewResult> {
    access(&window)?;
    let gateway = state
        .gateway
        .lock()
        .map_err(|_| "模型服务不可用。")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || gateway.assist_interview(request))
        .await
        .map_err(|_| "问诊服务失败。")?
}
#[tauri::command]
async fn explain_report(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: ExplainRequest,
) -> Result<Explanation> {
    access(&window)?;
    let gateway = if request.allow_model {
        state
            .gateway
            .lock()
            .map_err(|_| "模型服务不可用。")?
            .clone()
    } else {
        sentinel_core::gateway::ModelGateway::default()
    };
    let case = state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .get(&request.case_id)?;
    let run_id = case
        .diagnostic
        .as_ref()
        .and_then(|d| d.runs.last())
        .map(|r| r.id.clone());
    let report = case.report.ok_or("本轮尚无报告。")?;
    let allowed = case.plan.map_or(vec![], |p| p.action_ids);
    let explanation =
        tauri::async_runtime::spawn_blocking(move || gateway.explain_report(&report, allowed))
            .await
            .map_err(|_| "报告解释失败。")?;
    if let Some(run_id) = run_id {
        state
            .store
            .lock()
            .map_err(|_| "案例服务不可用。")?
            .save_explanation(&request.case_id, &run_id, explanation.clone())?;
    }
    Ok(explanation)
}
/// Chat Completions by default; configuration stores DPAPI ciphertext, never tests the endpoint.
#[tauri::command]
fn configure_model(
    window: WebviewWindow,
    state: State<AppStore>,
    request: sentinel_core::provider::ModelConfig,
) -> Result<()> {
    access(&window)?;
    state.configure_model(request)
}
#[tauri::command]
fn clear_model(window: WebviewWindow, state: State<AppStore>) -> Result<()> {
    access(&window)?;
    state.clear_model()
}
#[tauri::command]
async fn probe_tools(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: ProbeRequest,
) -> Result<Vec<ToolCandidate>> {
    access(&window)?;
    let tools = state.tools.clone();
    tauri::async_runtime::spawn_blocking(move || {
        tools
            .lock()
            .map_err(|_| "工具服务不可用。")?
            .probe(request.toolbox_directory.as_deref())
    })
    .await
    .map_err(|_| "工具发现失败。")?
}
#[tauri::command]
async fn probe_storage_devices(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: DeviceProbeRequest,
) -> Result<Vec<DeviceCandidate>> {
    access(&window)?;
    let tools = state.tools.clone();
    tauri::async_runtime::spawn_blocking(move || {
        tools.lock().map_err(|_| "工具服务不可用。")?.probe_devices(
            &request.tool_token,
            request.confirmed,
            &sentinel_core::runner::Cancellation::default(),
        )
    })
    .await
    .map_err(|_| "设备枚举失败。")?
}
#[tauri::command]
async fn import_report(
    window: WebviewWindow,
    state: State<'_, AppStore>,
    request: ImportRequest,
) -> Result<Option<CaseRecord>> {
    access(&window)?;
    let backend = state.inner().clone();
    backend
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .get(&request.case_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = file_dialog::select_report()? else {
            return Ok(None);
        };
        backend
            .store
            .lock()
            .map_err(|_| "案例服务不可用。")?
            .import_path(&request.case_id, request.format, &path)
            .map(Some)
    })
    .await
    .map_err(|_| "报告导入失败。")?
}
#[tauri::command]
fn list_artifacts(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<Vec<Artifact>> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .list_artifacts(&request.case_id)
}
#[tauri::command]
fn export_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: ExportRequest,
) -> Result<ExportResult> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .export(request)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenSettingsRequest {
    uri: String,
}

#[cfg(windows)]
fn shell_open_ms_settings(uri: &str) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }
    let op: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain([0])
        .collect();
    let file: Vec<u16> = std::ffi::OsStr::new(uri).encode_wide().chain([0]).collect();
    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if res <= 32 {
        return Err(format!("无法打开 Windows 设置页面（错误码 {res}）。"));
    }
    Ok(())
}

#[tauri::command]
fn open_windows_settings(window: WebviewWindow, request: OpenSettingsRequest) -> Result<()> {
    access(&window)?;
    const ALLOWED: &[&str] = &[
        "ms-settings:powersleep",
        "ms-settings:display",
        "ms-settings:display-advanced",
        "ms-settings:gaming-gamemode",
        "ms-settings:display-advancedgraphics",
        "ms-settings:storagesense",
    ];
    if !ALLOWED.contains(&request.uri.as_str()) {
        return Err("仅允许跳转受信任的 Windows 系统设置页面。".into());
    }
    #[cfg(windows)]
    {
        shell_open_ms_settings(&request.uri)
    }
    #[cfg(not(windows))]
    {
        Err("仅在 Windows 桌面端支持直达系统设置。".into())
    }
}

#[tauri::command]
fn delete_case(window: WebviewWindow, state: State<AppStore>, request: CaseRequest) -> Result<()> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .delete(&request.case_id)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameCaseRequest {
    case_id: String,
    title: String,
}
#[tauri::command]
fn rename_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: RenameCaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "案例服务不可用。")?
        .rename_case(&request.case_id, &request.title)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&path)?;
            let store =
                Store::open(&path.join("metadata.sqlite")).map_err(std::io::Error::other)?;
            app.manage(Arc::new(
                Backend::new(store).with_model_settings(path.join("model.dpapi")),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_backend_capabilities,
            get_hardware_info,
            create_case,
            create_setup_audit,
            get_case,
            list_cases,
            build_plan,
            build_import_plan,
            build_tool_plan,
            approve_plan,
            start_plan,
            cancel_run,
            get_run,
            update_interview,
            set_run_window,
            create_retest_run,
            assist_interview,
            explain_report,
            probe_tools,
            probe_storage_devices,
            import_report,
            list_artifacts,
            configure_model,
            clear_model,
            export_case,
            delete_case,
            rename_case,
            open_windows_settings
        ])
        .run(tauri::generate_context!())
        .expect("Sentinel PC could not initialize");
}
