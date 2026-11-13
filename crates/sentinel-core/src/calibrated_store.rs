use crate::{
    artifacts::{Artifact, ArtifactStore},
    diagnostics::*,
    parsers::{ParseStatus, ReportFormat},
    *,
};

pub struct WorkPackage {
    pub record: CaseRecord,
    pub run_id: String,
    pub actions: Vec<ActionSpec>,
}
pub struct BeginRun {
    pub record: CaseRecord,
    pub work: Option<WorkPackage>,
}

pub(crate) fn valid_native_plan(c: &CaseRecord, id: &str, hash: &str) -> Result<Plan> {
    let p = c.plan.as_ref().ok_or("请先预览计划。")?;
    let d = c.diagnostic.as_ref().ok_or("不是诊断案例。")?;
    let run = d.runs.last().ok_or("缺少运行。")?;
    if p.id != id
        || p.hash != hash
        || plan_hash(p)? != hash
        || p.case_id != c.id
        || p.run_id.as_deref() != Some(&run.id)
        || p.policy_version
            != if d.mode == CaseMode::SetupAudit {
                "setup-0.3.0"
            } else {
                "calibrated-0.2.0"
            }
        || p.adapter_version
            != if d.mode == CaseMode::SetupAudit {
                "windows-0.3.0"
            } else {
                "windows-0.2.0"
            }
        || !p.scenario_id.is_empty()
        || p.incident_start_utc != c.incident_start_utc
        || p.incident_end_utc != c.incident_end_utc
        || p.action_ids
            != p.actions
                .iter()
                .map(|a| a.action_id.clone())
                .collect::<Vec<_>>()
    {
        return Err("计划身份或范围已变化，请重新确认。".into());
    }
    let native = match d.mode {
        CaseMode::SetupAudit => setup_audit_actions(),
        CaseMode::Diagnostic => native_actions(d.category.ok_or("缺少故障分类。")?),
    };
    let valid = p.actions == native
        || (d.mode == CaseMode::Diagnostic
            && (p.actions == [import_action()]
                || (p.actions.len() == 1
                    && p.actions[0]
                        == tool_action(
                            p.actions[0].tool_token.clone().ok_or("缺少工具标识。")?,
                            p.actions[0].device_token.clone().ok_or("缺少设备标识。")?,
                        ))));
    if !valid {
        return Err("动作不在当前策略白名单内。".into());
    }
    if p.actions.iter().any(|a| a.requires_external_confirmation) {
        let identity = p
            .tool_identity
            .as_ref()
            .ok_or("外部工具计划缺少路径与哈希，请重新发现并建立计划。")?;
        if identity.tool_id != "smartctl"
            || p.actions[0].tool_token.as_deref() != Some(&identity.token)
        {
            return Err("工具身份与计划不匹配。".into());
        }
    } else if p.tool_identity.is_some() {
        return Err("本机检查计划不应包含外部工具授权。".into());
    }
    Ok(p.clone())
}
fn import_action() -> ActionSpec {
    ActionSpec {
        action_id: "report.import".into(),
        description: "分析本轮用户已选择并导入的报告；不启动外部程序".into(),
        risk: "R0".into(),
        estimated_seconds: 5,
        output_limit_bytes: 20 * 1024 * 1024,
        requires_external_confirmation: false,
        tool_token: None,
        device_token: None,
    }
}
fn tool_action(tool_token: String, device_token: String) -> ActionSpec {
    ActionSpec {
        action_id: "storage.smartctl_read".into(),
        description: "经单独确认运行本地 smartctl，只读查询已枚举磁盘；可能唤醒设备".into(),
        risk: "R1".into(),
        estimated_seconds: 60,
        output_limit_bytes: 20 * 1024 * 1024,
        requires_external_confirmation: true,
        tool_token: Some(tool_token),
        device_token: Some(device_token),
    }
}

impl Store {
    pub(crate) fn create_diagnostic(&self, r: CreateCase) -> Result<CaseRecord> {
        let category = r.category.ok_or("缺少故障分类。")?;
        let title = match category {
            Category::GamingDisplay => "游戏与显示异常",
            Category::RestartBsod => "重启与蓝屏",
            Category::StorageIo => "存储与读写异常",
            Category::OfficePeripheral => "办公应用与外设异常",
        };
        let mut c = CaseRecord {
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            symptom: r.symptom.trim().into(),
            scenario_id: String::new(),
            incident_start_utc: r.incident_start_utc,
            incident_end_utc: r.incident_end_utc,
            display_timezone: r.display_timezone,
            environment: r.environment,
            created_at_utc: Utc::now().to_rfc3339(),
            status: "draft".into(),
            plan: None,
            report: None,
            diagnostic: Some(DiagnosticContext {
                mode: CaseMode::Diagnostic,
                category: Some(category),
                interview: r.interview.unwrap_or_default(),
                runs: vec![DiagnosticRun::new(None, None)],
            }),
        };
        if let Some(run) = c.diagnostic.as_mut().and_then(|d| d.runs.last_mut()) {
            run.incident_start_utc = c.incident_start_utc.clone();
            run.incident_end_utc = c.incident_end_utc.clone();
        }
        self.save(&c)?;
        Ok(c)
    }
    pub fn create_setup_audit(&self, r: SetupAuditRequest) -> Result<CaseRecord> {
        if !["personal", "workplace", "unknown"].contains(&r.environment.as_str())
            || !["Asia/Hong_Kong", "Asia/Shanghai", "UTC"].contains(&r.display_timezone.as_str())
        {
            return Err("体检环境或时区无效。".into());
        }
        let now = Utc::now().to_rfc3339();
        let mut run = DiagnosticRun::new(None, None);
        run.incident_start_utc = now.clone();
        run.incident_end_utc = now.clone();
        let c = CaseRecord {
            id: Uuid::new_v4().to_string(),
            title: "一键体检".into(),
            symptom: String::new(),
            scenario_id: String::new(),
            incident_start_utc: now.clone(),
            incident_end_utc: now.clone(),
            display_timezone: r.display_timezone,
            environment: r.environment,
            created_at_utc: now,
            status: "draft".into(),
            plan: None,
            report: None,
            diagnostic: Some(DiagnosticContext {
                mode: CaseMode::SetupAudit,
                category: None,
                interview: InterviewContext::default(),
                runs: vec![run],
            }),
        };
        self.save(&c)?;
        Ok(c)
    }
    pub fn update_interview(&self, id: &str, interview: InterviewContext) -> Result<CaseRecord> {
        gateway::validate_interview(&interview)?;
        let mut c = self.get(id)?;
        if ["collecting", "cancelling"].contains(&c.status.as_str()) || c.report.is_some() {
            return Err("当前运行已开始或完成，请新建复测轮次。".into());
        }
        let d = c.diagnostic.as_mut().ok_or("演示案例不支持真实问诊。")?;
        if d.mode == CaseMode::SetupAudit {
            return Err("体检模式无需问诊。".into());
        }
        d.interview = interview;
        c.plan = None;
        c.status = "draft".into();
        self.save(&c)?;
        Ok(c)
    }
    pub fn create_retest_run(&self, r: RetestRequest) -> Result<CaseRecord> {
        if r.changed_variable.trim().is_empty()
            || r.changed_variable.chars().count() > 1000
            || r.user_feedback.chars().count() > 1000
        {
            return Err("请记录一个修改变量及不超过 1000 字的反馈。".into());
        }
        let mut c = self.get(&r.case_id)?;
        let d = c.diagnostic.as_mut().ok_or("演示案例不支持真实复测。")?;
        if d.runs.len() >= 20
            || !d.runs.last().is_some_and(|run| {
                [
                    "completed",
                    "completed_partial",
                    "cancelled",
                    "failed",
                    "interrupted",
                ]
                .contains(&run.status.as_str())
            })
        {
            return Err("上一轮尚未结束或已达到 20 轮上限。".into());
        }
        d.runs.push(DiagnosticRun::new(
            Some(r.changed_variable),
            Some(r.user_feedback),
        ));
        if d.mode == CaseMode::SetupAudit {
            let now = Utc::now().to_rfc3339();
            c.incident_start_utc = now.clone();
            c.incident_end_utc = now;
        }
        if let Some(run) = d.runs.last_mut() {
            run.incident_start_utc = c.incident_start_utc.clone();
            run.incident_end_utc = c.incident_end_utc.clone();
        }
        c.status = "draft".into();
        c.plan = None;
        c.report = None;
        self.save(&c)?;
        Ok(c)
    }
    pub fn set_run_window(&self, id: &str, start: String, end: String) -> Result<CaseRecord> {
        let mut c = self.get(id)?;
        if c.diagnostic
            .as_ref()
            .is_some_and(|d| d.mode == CaseMode::SetupAudit)
        {
            return Err("体检采集当前配置，不需要问诊时间窗口。".into());
        }
        if c.report.is_some() || ["collecting", "cancelling"].contains(&c.status.as_str()) {
            return Err("只能修改尚未开始轮次的时间窗口。".into());
        }
        let request = CreateCase {
            scenario_id: String::new(),
            symptom: c.symptom.clone(),
            incident_start_utc: start.clone(),
            incident_end_utc: end.clone(),
            display_timezone: c.display_timezone.clone(),
            environment: c.environment.clone(),
            category: c.diagnostic.as_ref().and_then(|d| d.category),
            interview: None,
        };
        validate_request(&request)?;
        c.incident_start_utc = start;
        c.incident_end_utc = end;
        if let Some(run) = c.diagnostic.as_mut().and_then(|d| d.runs.last_mut()) {
            run.incident_start_utc = c.incident_start_utc.clone();
            run.incident_end_utc = c.incident_end_utc.clone();
        }
        c.plan = None;
        c.status = "draft".into();
        self.save(&c)?;
        Ok(c)
    }
    pub fn build_native_plan(&self, id: &str, tool: Option<ToolPlanRequest>) -> Result<CaseRecord> {
        self.build_calibrated_plan(id, tool, false)
    }
    pub fn build_import_plan(&self, id: &str) -> Result<CaseRecord> {
        self.build_calibrated_plan(id, None, true)
    }
    fn build_calibrated_plan(
        &self,
        id: &str,
        tool: Option<ToolPlanRequest>,
        import_only: bool,
    ) -> Result<CaseRecord> {
        let mut c = self.get(id)?;
        if c.report.is_some() || ["collecting", "cancelling"].contains(&c.status.as_str()) {
            return Err("当前轮次已开始，请先结束或新建复测。".into());
        }
        let d = c.diagnostic.as_mut().ok_or("不是诊断案例。")?;
        if d.mode == CaseMode::SetupAudit && (tool.is_some() || import_only) {
            return Err("体检使用完整的六组 R0 套餐，不启动外部工具或替换为单项计划。".into());
        }
        let run = d.runs.last_mut().ok_or("缺少运行。")?;
        if import_only && run.import_coverage.is_empty() {
            return Err("请先导入报告。".into());
        }
        let actions = if let Some(t) = tool {
            if t.case_id != id {
                return Err("工具计划案例不匹配。".into());
            }
            vec![tool_action(t.tool_token, t.device_token)]
        } else if import_only {
            vec![import_action()]
        } else {
            match d.mode {
                CaseMode::SetupAudit => setup_audit_actions(),
                CaseMode::Diagnostic => native_actions(d.category.ok_or("缺少故障分类。")?),
            }
        };
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM artifacts WHERE case_id=?1 AND run_id=?2 ORDER BY id")
            .map_err(storage_error)?;
        let artifacts: Vec<Artifact> = stmt
            .query_map(params![id, run.id], |r| r.get::<_, String>(0))
            .map_err(storage_error)?
            .map(|r| decode(&r.map_err(storage_error)?))
            .collect::<Result<_>>()?;
        let mut p = Plan {
            id: Uuid::new_v4().to_string(),
            case_id: id.into(),
            revision: c.plan.as_ref().map_or(1, |p| p.revision + 1),
            hash: String::new(),
            action_ids: actions.iter().map(|a| a.action_id.clone()).collect(),
            data_scopes: vec![format!(
                "本机只读；时间窗口 {} 至 {}；不主动调用模型；外部工具需独立确认，其联网行为不能由本产品保证",
                c.incident_start_utc, c.incident_end_utc
            )],
            policy_version: if d.mode == CaseMode::SetupAudit {
                "setup-0.3.0"
            } else {
                "calibrated-0.2.0"
            }
            .into(),
            adapter_version: if d.mode == CaseMode::SetupAudit {
                "windows-0.3.0"
            } else {
                "windows-0.2.0"
            }
            .into(),
            scenario_id: String::new(),
            incident_start_utc: c.incident_start_utc.clone(),
            incident_end_utc: c.incident_end_utc.clone(),
            actions,
            run_id: Some(run.id.clone()),
            artifact_hashes: artifacts.iter().map(|a| a.sha256.clone()).collect(),
            tool_identity: None,
        };
        p.hash = plan_hash(&p)?;
        run.status = "awaiting_consent".into();
        c.plan = Some(p);
        c.status = "awaiting_consent".into();
        self.save(&c)?;
        Ok(c)
    }
    pub fn begin_native_run(&mut self, r: StartRequest) -> Result<BeginRun> {
        let mut c = self.get(&r.case_id)?;
        let plan = valid_native_plan(&c, &r.plan_id, &r.plan_hash)?;
        let tx = self.conn.transaction().map_err(storage_error)?;
        let (id, hash, expiry, consumed): (String, String, String, i32) = tx
            .query_row(
                "SELECT case_id,plan_hash,expires_at,consumed FROM consents WHERE token=?1",
                [&r.consent_token],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| "同意不存在或已失效。")?;
        if id != c.id
            || hash != plan.hash
            || DateTime::parse_from_rfc3339(&expiry).map_err(|_| "同意时间无效。")? < Utc::now()
        {
            return Err("同意范围不符或已过期。".into());
        }
        if consumed == 1 {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM runs WHERE case_id=?1 AND plan_hash=?2)",
                    params![c.id, plan.hash],
                    |r| r.get(0),
                )
                .map_err(storage_error)?;
            if exists {
                return Ok(BeginRun {
                    record: c,
                    work: None,
                });
            }
            return Err("同意已使用，不能自动重跑。".into());
        }
        if c.status != "awaiting_consent" {
            return Err("当前不能启动。".into());
        }
        let run = c
            .diagnostic
            .as_mut()
            .and_then(|d| d.runs.last_mut())
            .ok_or("缺少运行。")?;
        run.status = "collecting".into();
        let run_id = run.id.clone();
        c.status = "collecting".into();
        tx.execute(
            "UPDATE consents SET consumed=1 WHERE token=?1 AND consumed=0",
            [r.consent_token],
        )
        .map_err(storage_error)?;
        tx.execute(
            "INSERT INTO runs(id,case_id,plan_hash,status) VALUES(?1,?2,?3,'collecting')",
            params![run_id, c.id, plan.hash],
        )
        .map_err(storage_error)?;
        tx.execute(
            "UPDATE cases SET body=?2 WHERE id=?1",
            params![c.id, encode(&c)?],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)?;
        Ok(BeginRun {
            record: c.clone(),
            work: Some(WorkPackage {
                record: c,
                run_id,
                actions: plan.actions,
            }),
        })
    }
    pub fn cancel_native_run(&self, case_id: &str, run_id: &str) -> Result<CaseRecord> {
        let mut c = self.get(case_id)?;
        let run = c
            .diagnostic
            .as_mut()
            .and_then(|d| d.runs.last_mut())
            .filter(|r| r.id == run_id)
            .ok_or("不是当前运行。")?;
        if run.status == "collecting" {
            run.status = "cancelling".into();
            c.status = "cancelling".into();
            self.save(&c)?;
        }
        Ok(c)
    }
    pub fn finish_native_run(
        &mut self,
        case_id: &str,
        run_id: &str,
        report: Report,
        tasks: Vec<TaskResult>,
        cancelled: bool,
    ) -> Result<CaseRecord> {
        let mut c = self.get(case_id)?;
        let d = c.diagnostic.as_mut().ok_or("不是诊断案例。")?;
        let previous = if d.runs.len() > 1 {
            Some(d.runs[d.runs.len() - 2].clone())
        } else {
            None
        };
        let run = d
            .runs
            .last_mut()
            .filter(|r| r.id == run_id)
            .ok_or("运行已变化，拒绝覆盖。")?;
        if !["collecting", "cancelling"].contains(&run.status.as_str()) {
            return Err("运行已终结，拒绝覆盖。".into());
        }
        let cancelled = cancelled || run.status == "cancelling";
        let status = if cancelled {
            "cancelled"
        } else if !tasks.is_empty() && tasks.iter().all(|t| t.status == "failed") {
            "failed"
        } else if !report.coverage.is_empty()
            && report
                .coverage
                .iter()
                .all(|c| ["available", "empty"].contains(&c.status.as_str()))
        {
            "completed"
        } else {
            "completed_partial"
        };
        run.status = status.into();
        run.tasks = tasks;
        run.explanation = Some(report_explanation(&report));
        run.report = Some(report.clone());
        if let Some(previous) = previous {
            run.comparison = Some(compare(&previous, run));
        }
        c.status = status.into();
        c.report = Some(report);
        let tx = self.conn.transaction().map_err(storage_error)?;
        tx.execute(
            "UPDATE cases SET body=?2 WHERE id=?1",
            params![c.id, encode(&c)?],
        )
        .map_err(storage_error)?;
        tx.execute(
            "UPDATE runs SET status=?2 WHERE id=?1",
            params![run_id, status],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)?;
        Ok(c)
    }
    pub fn import_path(
        &mut self,
        case_id: &str,
        format: ReportFormat,
        path: &std::path::Path,
    ) -> Result<CaseRecord> {
        let (_guard, bytes) = artifacts::open_source(path, parsers::MAX_REPORT_BYTES)?;
        self.import_bytes(case_id, format, &bytes)
    }
    pub fn import_bytes(
        &mut self,
        case_id: &str,
        format: ReportFormat,
        bytes: &[u8],
    ) -> Result<CaseRecord> {
        let mut c = self.get(case_id)?;
        if c.report.is_some() || ["collecting", "cancelling"].contains(&c.status.as_str()) {
            return Err("当前轮次已经开始或完成，请新建复测。".into());
        }
        let run = c
            .diagnostic
            .as_mut()
            .and_then(|d| d.runs.last_mut())
            .ok_or("只能导入真实诊断案例。")?;
        let size: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(size_bytes),0) FROM artifacts WHERE case_id=?1",
                [case_id],
                |r| r.get(0),
            )
            .map_err(storage_error)?;
        if size < 0 || size + bytes.len() as i64 > 100 * 1024 * 1024 {
            return Err("案例附件达到 100 MiB 上限。".into());
        }
        let store = ArtifactStore::new(self.artifact_root.as_ref().ok_or("未配置附件目录。")?)?;
        let (artifact, mut parsed) = store.prepare(case_id, &run.id, format, bytes)?;
        // Importing twice must not manufacture duplicate independent evidence.
        let duplicate:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM artifacts WHERE case_id=?1 AND run_id=?2 AND json_extract(body,'$.sha256')=?3)",params![case_id,run.id,artifact.sha256],|r|r.get(0)).map_err(storage_error)?;
        if duplicate {
            store.remove(case_id, &artifact.id)?;
            return Err("本轮已导入相同报告。".into());
        }
        for e in &mut parsed.evidence {
            e.id = format!("{}:{}", artifact.id, e.id);
            e.fields.insert("artifactId".into(), artifact.id.clone());
        }
        run.imported_evidence.extend(parsed.evidence);
        run.import_coverage.push(Coverage {
            source: format!("artifact:{}", artifact.id),
            status: match parsed.status {
                ParseStatus::Parsed => "available",
                ParseStatus::Partial => "partial",
                ParseStatus::Unsupported => "unsupported",
            }
            .into(),
            detail: "导入报告声明；格式仍为 synthetic_only 预览，工具来源与实测真实性未经核验。"
                .into(),
        });
        run.warnings.extend(parsed.warnings);
        run.warnings
            .push("解析器只完成合成格式验收；不能据文件声明验证真实工具已运行。".into());
        run.status = "draft".into();
        c.plan = None;
        c.status = "draft".into();
        let result = (|| -> Result<()> {
            let tx = self.conn.transaction().map_err(storage_error)?;
            tx.execute(
                "INSERT INTO artifacts(id,case_id,run_id,size_bytes,body) VALUES(?1,?2,?3,?4,?5)",
                params![
                    artifact.id,
                    case_id,
                    artifact.run_id,
                    artifact.size_bytes as i64,
                    encode(&artifact)?
                ],
            )
            .map_err(storage_error)?;
            tx.execute(
                "UPDATE cases SET body=?2 WHERE id=?1",
                params![case_id, encode(&c)?],
            )
            .map_err(storage_error)?;
            tx.commit().map_err(storage_error)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = store.remove(case_id, &artifact.id);
            result?;
        }
        Ok(c)
    }
    pub fn list_artifacts(&self, case_id: &str) -> Result<Vec<Artifact>> {
        self.get(case_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM artifacts WHERE case_id=?1 ORDER BY id")
            .map_err(storage_error)?;
        stmt.query_map([case_id], |r| r.get::<_, String>(0))
            .map_err(storage_error)?
            .map(|r| decode(&r.map_err(storage_error)?))
            .collect()
    }
    pub fn save_explanation(&self, id: &str, run_id: &str, explanation: Explanation) -> Result<()> {
        let mut c = self.get(id)?;
        let run = c
            .diagnostic
            .as_mut()
            .and_then(|d| d.runs.last_mut())
            .filter(|r| r.id == run_id && r.report.is_some())
            .ok_or("报告轮次已变化。")?;
        if explanation.origin == "model" {
            gateway::validate_explanation(&explanation, run.report.as_ref().ok_or("缺少报告。")?)?;
        }
        run.explanation = Some(explanation);
        self.save(&c)
    }
    pub fn bind_tool_identity(
        &self,
        id: &str,
        identity: crate::tools::ToolCandidate,
    ) -> Result<CaseRecord> {
        let mut c = self.get(id)?;
        if c.status != "awaiting_consent" {
            return Err("当前不能修改工具计划。".into());
        }
        let p = c.plan.as_mut().ok_or("缺少计划。")?;
        if p.actions.len() != 1
            || p.actions[0].tool_token.as_deref() != Some(&identity.token)
            || identity.tool_id != "smartctl"
        {
            return Err("工具身份与计划不匹配。".into());
        }
        p.tool_identity = Some(identity);
        p.hash = plan_hash(p)?;
        self.save(&c)?;
        Ok(c)
    }
}
