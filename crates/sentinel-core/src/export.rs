use crate::{Result, domain::*};
use serde_json::Value;
use std::collections::BTreeMap;

fn redact(value: &mut Value, replacements: &mut BTreeMap<String, String>, key: &str) {
    match value {
        Value::Object(map) => {
            if map.contains_key("kind") && map.contains_key("source") {
                if let Some(Value::Object(fields)) = map.get_mut("fields") {
                    // Default sharing/model input is an allowlist, never arbitrary event XML or report text.
                    fields.retain(|k, _| {
                        [
                            "locator",
                            "measurementOrigin",
                            "artifactId",
                            "declaredHealth",
                            "protocol",
                            "tool",
                            "declaredToolVersion",
                            "toolExitStatus",
                            "serialNumber",
                            "temperatureDeclared",
                            "nvmeCriticalWarning",
                            "configManagerErrorCode",
                            "Caption",
                            "Version",
                            "BuildNumber",
                            "TotalVisibleMemorySize",
                            "Name",
                            "NumberOfCores",
                            "NumberOfLogicalProcessors",
                            "DriverVersion",
                            "DriverDate",
                            "monitorKey",
                            "adapterRole",
                            "hasDiscreteAdapter",
                            "classificationSource",
                            "sessionKind",
                            "outputTechnology",
                            "physicalPortVerified",
                            "sourceApi",
                            "currentRefreshHz",
                            "width",
                            "height",
                            "edidModesJson",
                            "edidParseState",
                            "sourceModesJson",
                            "edidState",
                            "modesTruncated",
                            "configuredClockSpeed",
                            "reportedSpeed",
                            "speedUnit",
                            "memoryType",
                            "capacityBytes",
                            "profileState",
                            "channelState",
                            "schemeGuid",
                            "gameModeConfigured",
                            "hagsConfigured",
                            "effectiveGameState",
                            "policyLocked",
                            "volumeRole",
                            "totalBytes",
                            "freeBytes",
                            "sensorLabel",
                            "sensorKind",
                            "unit",
                            "sampleCount",
                            "maximum",
                            "last",
                            "yesCount",
                            "firstDeclaredTime",
                            "lastDeclaredTime",
                        ]
                        .contains(&k.as_str())
                    });
                }
            }
            for (k, v) in map {
                redact(v, replacements, k);
            }
        }
        Value::Array(items) => {
            for item in items {
                redact(item, replacements, key);
            }
        }
        Value::String(s) => {
            if key.to_lowercase().contains("version")
                && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            {
                return;
            }
            if [
                "serial",
                "token",
                "password",
                "username",
                "computername",
                "apikey",
                "api_key",
                "pnpdeviceid",
                "deviceinstanceid",
                "machineid",
                "entity",
            ]
            .iter()
            .any(|k| key.to_lowercase().contains(k))
            {
                let count = replacements.len() + 1;
                *s = replacements
                    .entry(s.clone())
                    .or_insert_with(|| format!("REDACTED_{count}"))
                    .clone();
            } else {
                // Preview exports contain bundled evidence only; arbitrary report text is not yet accepted.
                for pattern in [
                    r"(?i)[A-Z]:\\[^\r\n]+",
                    r"\\\\[^\s]+",
                    r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",
                    r"(?i)\b(?:sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9_.-]+)\b",
                    r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b",
                    r"(?i)(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}\b|[0-9a-f]{0,4}::[0-9a-f:]+)",
                ] {
                    *s = regex::Regex::new(pattern)
                        .expect("static pattern")
                        .replace_all(s, "[已脱敏]")
                        .to_string();
                }
            }
        }
        _ => {}
    }
}
pub(crate) fn redact_value(value: &mut Value) {
    redact(value, &mut BTreeMap::new(), "");
}
fn safe(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

pub fn render(c: &CaseRecord, format: &str) -> Result<ExportResult> {
    if !["markdown", "json"].contains(&format) {
        return Err("只允许 Markdown 或 JSON 导出。".into());
    }
    let report = c.report.as_ref().ok_or("请先完成样本分析。")?;
    // User symptom text, local paths, consent tokens, and database metadata are intentionally excluded.
    let mut value = serde_json::to_value(report).map_err(|_| "导出编码失败。")?;
    redact(&mut value, &mut BTreeMap::new(), "");
    if format == "json" {
        if let Some(d) = &c.diagnostic {
            if let Some(run) = d.runs.last() {
                let mut extra = serde_json::json!({"explanation":run.explanation,"comparison":run.comparison,"retests":d.runs.iter().map(|r|serde_json::json!({"id":r.id,"status":r.status,"createdAtUtc":r.created_at_utc,"changedVariableRecorded":r.changed_variable.is_some(),"userFeedbackRecorded":r.user_feedback.is_some()})).collect::<Vec<_>>()});
                redact_value(&mut extra);
                if let (Some(target), Some(extra)) = (value.as_object_mut(), extra.as_object()) {
                    target.extend(extra.clone());
                }
            }
        }
        return Ok(ExportResult {
            filename: if c.diagnostic.is_some() {
                "sentinel-diagnostic-report.json"
            } else {
                "sentinel-synthetic-report.json"
            }
            .into(),
            media_type: "application/json".into(),
            content: serde_json::to_string_pretty(&value).map_err(|_| "导出编码失败。")?,
        });
    }
    let report: Report = serde_json::from_value(value).map_err(|_| "脱敏报告格式无效。")?;
    let label = if report.provenance == "synthetic" {
        "合成样本报告；不是本机检测结果"
    } else {
        "诊断记录；观察与建议不等于根因确诊"
    };
    let mut text = format!(
        "# Sentinel PC · {label}\n\n来源：{}\n生成时间：{}\n规则版本：{}\n\n## 本轮覆盖\n\n",
        safe(&report.provenance),
        report.generated_at_utc,
        report.rule_version
    );
    for item in &report.coverage {
        text.push_str(&format!(
            "- {}：{}；{}\n",
            safe(&item.source),
            safe(&item.status),
            safe(&item.detail)
        ));
    }
    if !report.audit_checks.is_empty() {
        text.push_str("\n## 六组体检结果（未知不等于通过）\n\n");
        for c in &report.audit_checks {
            text.push_str(&format!(
                "- {} / {}：{}；对象={}；依据={}\n  {}\n",
                safe(&c.check_id),
                safe(&c.metric),
                safe(&c.assessment),
                safe(c.object_id.as_deref().unwrap_or("未识别")),
                c.evidence_ids.join(", "),
                safe(&c.summary)
            ));
            for l in &c.limitations {
                text.push_str(&format!("  限制：{}\n", safe(l)));
            }
        }
    }
    text.push_str("\n## 发现与依据\n\n");
    for f in &report.findings {
        text.push_str(&format!(
            "### {}\n\n规则：{}\n\n{}\n\n依据：{}\n\n证据强度：{}\n\n",
            safe(&f.title),
            safe(&f.rule_id),
            safe(&f.observation),
            f.evidence_ids.join(", "),
            safe(&f.strength)
        ));
        for l in &f.limitations {
            text.push_str(&format!("- 限制：{}\n", safe(l)));
        }
        text.push_str(&format!("\n下一步：{}\n\n", safe(&f.next_step)));
    }
    text.push_str("\n## 不能判断什么\n\n");
    for u in &report.unknowns {
        text.push_str(&format!("- {}\n", safe(u)));
    }
    text.push_str("\n## 证据出处\n\n");
    for e in &report.evidence {
        text.push_str(&format!(
            "- {}：{}；RecordID={}；时间={}\n",
            safe(&e.id),
            safe(&e.source),
            e.record_id.map_or("未知".into(), |id| id.to_string()),
            e.observed_at_utc.as_deref().unwrap_or("未知")
        ));
    }
    if let Some(run) = c.diagnostic.as_ref().and_then(|d| d.runs.last()) {
        let mut share =
            serde_json::json!({"explanation":run.explanation,"comparison":run.comparison});
        redact_value(&mut share);
        if let Some(explanation) = share
            .get("explanation")
            .and_then(|e| serde_json::from_value::<crate::diagnostics::Explanation>(e.clone()).ok())
        {
            text.push_str("\n## 按优先级排查\n\n");
            for r in explanation.recommendations {
                text.push_str(&format!(
                    "{}. {}\n\n   预期：{}\n\n   停止条件：{}\n\n",
                    r.priority,
                    safe(&r.instruction),
                    safe(&r.expected_result),
                    safe(&r.stop_condition)
                ));
            }
            text.push_str("\n## 排除说明\n\n");
            for e in explanation.exclusions {
                text.push_str(&format!("- {}\n", safe(&e)));
            }
        }
        if let Some(comparison) = &run.comparison {
            text.push_str(&format!(
                "\n## 复测对比\n\n可比条件满足：{}\n\n新出现的规则：{}\n\n未再出现的规则：{}\n\n",
                comparison.comparable,
                comparison.new_rule_ids.join(", "),
                comparison.absent_rule_ids.join(", ")
            ));
            for l in &comparison.limitations {
                text.push_str(&format!("- {}\n", safe(l)));
            }
        }
    }
    text.push_str("\n默认未附原始文件、问题描述、问诊回答或复测自由文本。分享前请预览核对。\n");
    Ok(ExportResult {
        filename: if c.diagnostic.is_some() {
            "sentinel-diagnostic-report.md"
        } else {
            "sentinel-synthetic-report.md"
        }
        .into(),
        media_type: "text/markdown".into(),
        content: text,
    })
}
