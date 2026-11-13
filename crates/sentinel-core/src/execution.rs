//! Execute a reserved immutable plan, with no database lock held.
use crate::{
    WorkPackage,
    diagnostics::TaskResult,
    domain::{Coverage, Evidence, Report},
    runner::Cancellation,
    tools::ToolRegistry,
};
use std::sync::{Arc, Mutex};

pub fn failure_report(detail: &str) -> Report {
    Report {
        schema_version: 1,
        provenance: "native_collected".into(),
        rule_version: "calibrated-0.2.0".into(),
        generated_at_utc: chrono::Utc::now().to_rfc3339(),
        findings: vec![],
        evidence: vec![],
        coverage: vec![Coverage {
            source: "runner".into(),
            status: "failed".into(),
            detail: detail.into(),
        }],
        unknowns: vec!["执行未完成，不能视为检查通过。".into()],
        audit_checks: vec![],
    }
}

pub fn execute(
    work: &WorkPackage,
    tools: &Arc<Mutex<ToolRegistry>>,
    cancel: &Cancellation,
) -> crate::Result<(Report, Vec<TaskResult>)> {
    let run = work
        .record
        .diagnostic
        .as_ref()
        .and_then(|d| d.runs.last())
        .ok_or("缺少运行。")?;
    let mut evidence = run.imported_evidence.clone();
    let mut coverage = run.import_coverage.clone();
    let mut warnings = run.warnings.clone();
    let mut tasks = Vec::new();
    for action in &work.actions {
        if cancel.is_cancelled() {
            coverage.push(Coverage {
                source: action.action_id.clone(),
                status: "cancelled".into(),
                detail: "用户取消，未完成的数据不能视为通过。".into(),
            });
            tasks.push(TaskResult {
                action_id: action.action_id.clone(),
                status: "cancelled".into(),
                detail: "本轮已取消。".into(),
                exit_code: None,
                artifact_id: None,
            });
            continue;
        }
        if action.action_id == "report.import" {
            tasks.push(TaskResult {
                action_id: action.action_id.clone(),
                status: "completed".into(),
                detail: "分析已导入的报告与解析警告。".into(),
                exit_code: None,
                artifact_id: None,
            });
            continue;
        }
        let result = if action.action_id == "storage.smartctl_read" {
            (||->crate::Result<(crate::runner::ProcessOutput,Option<crate::collectors::Collection>)> {
                let tool=action.tool_token.as_deref().ok_or("缺少工具标识。")?; let device=action.device_token.as_deref().ok_or("缺少设备标识。")?;
                let output=tools.lock().map_err(|_|"工具服务不可用。")?.read(tool,device,cancel)?;
                if ["completed","failed"].contains(&output.status.as_str()) {
                    let mut parsed=crate::parsers::parse_report(crate::parsers::ReportFormat::SmartctlJson,&output.stdout).map_err(|_|"工具输出不符合受支持报告格式。")?;
                    if output.exit_code.and_then(|code|u8::try_from(code).ok()).map(|code|code.to_string()).as_ref()!=parsed.evidence.first().and_then(|e|e.fields.get("toolExitStatus")) {
                        // Preserve actual process status separately; parser may return unsupported with no evidence.
                        parsed.warnings.push("已保留实际进程退出码；报告声明与进程状态须分别审阅。".into());
                    }
                    warnings.extend(parsed.warnings);
                    warnings.push("smartctl 实际运行，但解析器的格式验收仍为 synthetic_only；健康值是工具声明。".into());
                    let c=crate::collectors::Collection{evidence:parsed.evidence,coverage:vec![Coverage{source:action.action_id.clone(),status:match parsed.status {crate::parsers::ParseStatus::Parsed=>"available",crate::parsers::ParseStatus::Partial=>"partial",crate::parsers::ParseStatus::Unsupported=>"unsupported"}.into(),detail:"外部工具只读输出；退出码按位保留，不能按非零直接判硬件坏。".into()}]};
                    return Ok((output,Some(c)));
                } Ok((output,None))
            })()
        } else {
            crate::collectors::collect(
                action,
                &work.record.incident_start_utc,
                &work.record.incident_end_utc,
                cancel,
            )
        };
        match result {
            Ok((output, collection)) => {
                let mut task_status = output.status.clone();
                if let Some(c) = collection {
                    let all_usable = c
                        .coverage
                        .iter()
                        .all(|x| ["available", "empty"].contains(&x.status.as_str()));
                    task_status = if all_usable {
                        "completed"
                    } else {
                        "completed_partial"
                    }
                    .into();
                    // Prefix each collection so IDs never collide across actions or with imported artifacts.
                    evidence.extend(c.evidence.into_iter().map(|mut e| {
                        e.id = format!("{}:{}:{}", work.run_id, action.action_id, e.id);
                        e
                    }));
                    coverage.extend(c.coverage);
                } else {
                    coverage.push(Coverage {
                        source: action.action_id.clone(),
                        status: output.status.clone(),
                        detail: "受控进程没有提交完整结果，部分字节未当作有效证据。".into(),
                    });
                }
                tasks.push(TaskResult {
                    action_id: action.action_id.clone(),
                    status: task_status,
                    detail: "未自动提权、改变系统配置或重试。".into(),
                    exit_code: output.exit_code,
                    artifact_id: None,
                });
            }
            Err(message) => {
                coverage.push(Coverage {
                    source: action.action_id.clone(),
                    status: "failed".into(),
                    detail: message.clone(),
                });
                tasks.push(TaskResult {
                    action_id: action.action_id.clone(),
                    status: "failed".into(),
                    detail: message,
                    exit_code: None,
                    artifact_id: None,
                });
            }
        }
    }
    // Deduplicate repeated import identities defensively.
    let mut ids = std::collections::BTreeSet::new();
    evidence.retain(|e: &Evidence| ids.insert(e.id.clone()));
    Ok((
        crate::rules::analyze_evidence(
            evidence,
            coverage,
            &work.record.incident_start_utc,
            &work.record.incident_end_utc,
            warnings,
        )?,
        tasks,
    ))
}
