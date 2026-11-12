use crate::{Result, domain::*};
use serde_json::Value;
use std::collections::BTreeMap;

fn redact(value: &mut Value, replacements: &mut BTreeMap<String, String>, key: &str) {
    match value {
        Value::Object(map) => {
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
            if ["serial", "token", "password", "username", "computername"]
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
        return Ok(ExportResult {
            filename: "sentinel-synthetic-report.json".into(),
            media_type: "application/json".into(),
            content: serde_json::to_string_pretty(&value).map_err(|_| "导出编码失败。")?,
        });
    }
    let report: Report = serde_json::from_value(value).map_err(|_| "脱敏报告格式无效。")?;
    let mut text = format!(
        "# Sentinel PC · 合成样本报告\n\n本报告不是本机检测结果。模型关闭。\n\n生成时间：{}\n规则版本：{}\n\n## 本轮覆盖\n\n",
        report.generated_at_utc, report.rule_version
    );
    for item in &report.coverage {
        text.push_str(&format!(
            "- {}：{}；{}\n",
            safe(&item.source),
            safe(&item.status),
            safe(&item.detail)
        ));
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
    text.push_str("\n默认未附原始文件，也未包含问题描述。预览版脱敏仍需人工检查。\n");
    Ok(ExportResult {
        filename: "sentinel-synthetic-report.md".into(),
        media_type: "text/markdown".into(),
        content: text,
    })
}
