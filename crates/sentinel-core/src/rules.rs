use crate::domain::*;
use chrono::{DateTime, Utc};
mod setup;

fn matches_event(e: &Evidence, provider: &str, channel: &str, id: u32) -> bool {
    e.kind == "windows.event"
        && e.provider.as_deref() == Some(provider)
        && e.channel.as_deref() == Some(channel)
        && e.event_id == Some(id)
        && e.schema_version == Some(0)
}

fn finding(
    rule: &str,
    title: &str,
    observation: &str,
    evidence: Vec<String>,
    limitations: &[&str],
    next: &str,
) -> Finding {
    Finding {
        id: format!("finding-{rule}-{}", evidence.join("-")),
        rule_id: rule.into(),
        title: title.into(),
        observation: observation.into(),
        evidence_ids: evidence,
        strength: "对记录内容较强；对根因不足".into(),
        limitations: limitations.iter().map(|s| (*s).into()).collect(),
        next_step: next.into(),
    }
}

pub fn analyze(scenario: &Scenario, start: &str, end: &str) -> Report {
    let start = DateTime::parse_from_rfc3339(start).expect("validated start");
    let end = DateTime::parse_from_rfc3339(end).expect("validated end");
    let mut findings = Vec::new();
    let mut unknowns = vec!["这些是合成样本，不能用于判断当前电脑的健康或故障根因。".to_string()];
    let applicable: Vec<&Evidence> = scenario
        .evidence
        .iter()
        .filter(|e| {
            if let Some(t) = e.observed_at_utc.as_ref() {
                DateTime::parse_from_rfc3339(t).is_ok_and(|t| t >= start && t <= end)
            } else {
                true
            }
        })
        .collect();
    if applicable.len() != scenario.evidence.len() {
        unknowns.push("部分证据不在所选时间窗口，未用于事件结论。".into());
    }
    for e in &applicable {
        if matches_event(e, "Microsoft-Windows-Kernel-Power", "System", 41) {
            findings.push(finding(
                "WIN-RESTART-001",
                "记录到未正常关机后的启动事件",
                "样本中存在 Kernel-Power 41。它描述未正常关机后的启动情况，不能单独定位原因。",
                vec![e.id.clone()],
                &[
                    "不能仅凭这条事件判断电源、主板或 CPU 损坏。",
                    "BugcheckCode 为 0 也不能排除所有故障。",
                ],
                "先确认当时是否长按电源、断电或蓝屏，再补充同一时间段的记录。",
            ));
        }
        if matches_event(e, "Application Error", "Application", 1000) {
            findings.push(finding(
                "WIN-APP-001",
                "应用存在异常记录",
                "样本记录了应用异常；故障模块是记录中的线索，不能直接当作根因。",
                vec![e.id.clone()],
                &[
                    "ntdll.dll 等系统模块可能只是故障表现。",
                    "本轮没有排除驱动、插件、应用代码或硬件因素。",
                ],
                "记录程序版本和近期变更；先按一个变量复测，不随意替换系统 DLL。",
            ));
            if let Some(wer) = applicable.iter().find(|w| {
                matches_event(w, "Windows Error Reporting", "Application", 1001)
                    && e.entity.is_some()
                    && e.entity == w.entity
                    && e.boot_session.is_some()
                    && e.boot_session == w.boot_session
                    && e.source == w.source
                    && match (&e.observed_at_utc, &w.observed_at_utc) {
                        (Some(a), Some(b)) => match (
                            DateTime::parse_from_rfc3339(a),
                            DateTime::parse_from_rfc3339(b),
                        ) {
                            (Ok(a), Ok(b)) => {
                                (b - a).num_seconds() >= 0 && (b - a).num_seconds() <= 120
                            }
                            _ => false,
                        },
                        _ => false,
                    }
            }) {
                findings.push(finding("TIMELINE-APP-001", "两条记录符合受限关联条件", "同一来源中，同一应用和启动会话的 WER 记录在异常事件后 120 秒内出现，可并列查看。", vec![e.id.clone(), wer.id.clone()], &["样本中声明的实体身份与时间关联不证明故障因果。", "当前只支持合成样本 schema 0，不代表实际 Windows 版本的格式已验收。"], "结合两条记录查看程序身份、异常代码和复现场景。"));
            }
        }
        if e.kind == "storage.health"
            && e.fields
                .get("declaredHealth")
                .is_some_and(|v| v == "failed")
        {
            findings.push(finding(
                "STORAGE-001",
                "样本声明了存储健康告警",
                "合成报告证据中 declaredHealth 为 failed；这是报告声明，不是本产品实测。",
                vec![e.id.clone()],
                &[
                    "尚未完成真实 smartctl 或 CrystalDiskInfo 格式验收。",
                    "没有测试时间，不能把它关联到本次闪退，也不能预测损坏时间。",
                ],
                "若真实报告出现类似告警，先备份重要资料，再用受支持来源核实，避免自动运行长测。",
            ));
        }
    }
    if findings.is_empty() {
        unknowns.push("本轮没有足够的匹配证据；没有记录不代表没有故障。".into());
    }
    for c in &scenario.coverage {
        if c.status != "available" && c.status != "empty" {
            unknowns.push(format!("{}：{}", c.source, c.detail));
        }
    }
    Report {
        schema_version: 1,
        provenance: "synthetic".into(),
        rule_version: "preview-0.1.0".into(),
        generated_at_utc: Utc::now().to_rfc3339(),
        findings,
        evidence: scenario.evidence.clone(),
        coverage: scenario.coverage.clone(),
        unknowns,
        audit_checks: vec![],
    }
}

/// Real and imported observations retain their provenance and never reuse synthetic wording.
pub fn analyze_evidence(
    evidence: Vec<Evidence>,
    coverage: Vec<Coverage>,
    start: &str,
    end: &str,
    warnings: Vec<String>,
) -> crate::Result<Report> {
    let start = DateTime::parse_from_rfc3339(start).map_err(|_| "开始时间无效。")?;
    let end = DateTime::parse_from_rfc3339(end).map_err(|_| "结束时间无效。")?;
    if end < start {
        return Err("时间窗口无效。".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    if evidence.iter().any(|e| !ids.insert(e.id.clone())) {
        return Err("存在重复证据 ID。".into());
    }
    let native = evidence.iter().any(|e| {
        e.fields
            .get("measurementOrigin")
            .is_some_and(|s| s == "native_collected")
    });
    let imported = coverage
        .iter()
        .any(|c| c.source.starts_with("artifact:") || c.source == "storage.smartctl_read")
        || evidence.iter().any(|e| {
            e.fields
                .get("measurementOrigin")
                .is_some_and(|s| s == "imported_report_declared")
        });
    let provenance = match (native, imported) {
        (true, true) => "mixed",
        (false, true) => "imported_report_declared",
        _ => "native_collected",
    };
    let mut unknowns = warnings;
    let mut findings = vec![];
    let event = |e: &Evidence, p: &str, c: &str, id: u32| {
        e.kind == "windows.event"
            && e.provider.as_deref() == Some(p)
            && e.channel.as_deref() == Some(c)
            && e.event_id == Some(id)
            && e.schema_version.is_some()
    };
    for e in &evidence {
        if e.kind == "windows.event" {
            if !e
                .fields
                .get("measurementOrigin")
                .is_some_and(|s| s == "native_collected")
            {
                continue;
            }
            if !e
                .observed_at_utc
                .as_ref()
                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                .is_some_and(|t| t >= start && t <= end)
            {
                unknowns.push("有事件时间未知或位于本轮窗口外，未用于结论。".into());
                continue;
            }
        }
        let rule = if event(e, "Microsoft-Windows-Kernel-Power", "System", 41) {
            Some((
                "WIN-RESTART-001",
                "记录到未正常关机后的启动",
                "该事件记录上次关机未正常完成，不能单独判断电源或其他硬件损坏。",
                "确认是否曾断电、长按电源或蓝屏，记录触发场景后单变量复测。",
            ))
        } else if event(
            e,
            "Microsoft-Windows-WER-SystemErrorReporting",
            "System",
            1001,
        ) {
            Some((
                "WIN-RESTART-001",
                "记录到系统 BugCheck 报告",
                "存在系统错误检查报告；停止代码与转储路径是线索，当前没有分析 dump。",
                "记录停止代码和近期驱动变更，先备份资料，再由用户决定是否回退近期变更并复测。",
            ))
        } else if e.kind == "windows.event"
            && e.provider.as_deref() == Some("Microsoft-Windows-WHEA-Logger")
            && e.channel.as_deref() == Some("System")
            && e.event_id
                .is_some_and(|id| [17, 18, 19, 20, 46, 47].contains(&id))
        {
            Some((
                "WIN-HW-001",
                "记录到 WHEA 硬件错误相关事件",
                "系统记录了硬件错误相关报告；已纠正与未纠正事件不能混同，不能仅按事件号确诊某个零件。",
                "保存事件细节、触发时间和近期超频/硬件变更；先停止主动复现，必要时联系专业人员核查。",
            ))
        } else if event(e, "Display", "System", 4101) {
            Some((
                "WIN-DISPLAY-001",
                "显示驱动出现恢复记录",
                "存在显示驱动停止响应后恢复的事件；不能仅凭 TDR 认定显卡硬件损坏。",
                "记录驱动版本、运行的游戏与后台叠加层；每次只调整一个因素后复测。",
            ))
        } else if event(e, "Application Error", "Application", 1000) {
            Some((
                "WIN-APP-001",
                "应用出现崩溃记录",
                "应用异常记录提供模块和异常线索；ntdll.dll 等系统 DLL 不是直接根因结论。",
                "记录程序版本与近期插件变更；由用户先停用一个相关插件再复测，不替换系统 DLL。",
            ))
        } else if event(e, "Application Hang", "Application", 1002) {
            Some((
                "WIN-APP-002",
                "应用出现无响应记录",
                "系统报告应用无响应，不能据此排除存储、插件或系统资源因素。",
                "记录卡顿时的操作和应用版本，保存文件后只改变一个应用相关因素再复测。",
            ))
        } else if event(e, "Microsoft-Windows-Kernel-PnP", "System", 219)
            || (e.kind == "windows.event"
                && e.provider.as_deref() == Some("Microsoft-Windows-DriverFrameworks-UserMode")
                && [
                    Some("System"),
                    Some("Microsoft-Windows-DriverFrameworks-UserMode/Operational"),
                ]
                .contains(&e.channel.as_deref())
                && e.event_id.is_some_and(|id| [10110, 10111].contains(&id)))
            || (e.kind == "device.snapshot"
                && e.fields
                    .get("configManagerErrorCode")
                    .is_some_and(|v| v != "0" && !v.is_empty()))
        {
            Some((
                "WIN-USB-001",
                "设备或用户模式驱动存在异常线索",
                "PnP/驱动状态与设备相关；不代表已证实 USB 物理断连，也不自动证明设备损坏。",
                "保存工作后，由用户一次只更换一个 USB 接口或线缆，记录断连是否重复，再发起复测。",
            ))
        } else if e.kind == "storage.health"
            && e.fields
                .get("declaredHealth")
                .is_some_and(|v| ["failed", "warning"].contains(&v.as_str()))
        {
            Some((
                "STORAGE-001",
                "存储报告声明健康告警",
                "受支持的解析字段包含告警；属于报告声明，不是寿命预测，也不直接解释本次所有卡顿。",
                "先备份重要资料；避免长测和反复复现，核对磁盘身份及报告时间，必要时寻求专业帮助。",
            ))
        } else {
            None
        };
        if let Some((id, title, observation, next)) = rule {
            findings.push(finding(
                id,
                title,
                observation,
                vec![e.id.clone()],
                &["时间接近不等于因果；未覆盖的检查不能视为排除。"],
                next,
            ));
        }
    }
    let within = |e: &Evidence| {
        e.observed_at_utc
            .as_ref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| t >= start && t <= end)
    };
    for app in evidence
        .iter()
        .filter(|e| event(e, "Application Error", "Application", 1000) && within(e))
    {
        if let Some(wer) = evidence.iter().find(|w| {
            event(w, "Windows Error Reporting", "Application", 1001)
                && within(w)
                && app.entity.is_some()
                && app.entity == w.entity
                && app.boot_session.is_some()
                && app.boot_session == w.boot_session
                && app.source == w.source
                && app
                    .fields
                    .get("measurementOrigin")
                    .is_some_and(|v| v == "native_collected")
                && w.fields
                    .get("measurementOrigin")
                    .is_some_and(|v| v == "native_collected")
                && match (&app.observed_at_utc, &w.observed_at_utc) {
                    (Some(a), Some(b)) => match (
                        DateTime::parse_from_rfc3339(a),
                        DateTime::parse_from_rfc3339(b),
                    ) {
                        (Ok(a), Ok(b)) => (0..=120).contains(&(b - a).num_seconds()),
                        _ => false,
                    },
                    _ => false,
                }
        }) {
            findings.push(finding(
                "TIMELINE-APP-001",
                "应用异常与 WER 满足受限时间关联",
                "同一来源、应用身份与已知启动会话中的 WER 出现在应用异常后 120 秒内，可并列查看。",
                vec![app.id.clone(), wer.id.clone()],
                &["关联不证明因果；启动会话未知或不同实体的记录不合并。"],
                "核对应用版本和异常代码，再选择一个变量复测。",
            ));
        }
    }
    let audit = setup::analyze(&evidence, &coverage);
    findings.extend(audit.findings);
    unknowns.extend(audit.unknowns);
    for c in &coverage {
        if !["available", "empty"].contains(&c.status.as_str()) {
            unknowns.push(format!("{}：{} ({})", c.source, c.detail, c.status));
        }
    }
    if findings.is_empty() {
        unknowns.push("没有匹配到足以形成观察的证据；空结果不代表电脑正常。".into());
    }
    if !native && !imported {
        unknowns.push("本轮未取得可用证据。".into());
    }
    unknowns.sort();
    unknowns.dedup();
    Ok(Report {
        schema_version: 1,
        provenance: provenance.into(),
        rule_version: if audit.checks.is_empty() {
            "calibrated-0.2.0"
        } else {
            "setup-0.3.0"
        }
        .into(),
        generated_at_utc: Utc::now().to_rfc3339(),
        findings,
        evidence,
        coverage,
        unknowns,
        audit_checks: audit.checks,
    })
}
