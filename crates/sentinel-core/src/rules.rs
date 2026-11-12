use crate::domain::*;
use chrono::{DateTime, Utc};

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
    }
}
