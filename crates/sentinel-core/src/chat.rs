//! Persisted conversation, bounded factual context, no model-controlled execution.
use crate::{Result, Store, hardware::HardwareSnapshot};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
    pub origin: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conversation {
    pub id: String,
    pub case_id: Option<String>,
    pub title: String,
    pub messages: Vec<ChatMessage>,
    pub updated_at_utc: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRequest {
    pub conversation_id: String,
    pub case_id: Option<String>,
    pub message: String,
    pub hardware: Option<HardwareSnapshot>,
    pub allow_model: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatInput {
    pub messages: Vec<ChatMessage>,
    pub context: serde_json::Value,
}

impl Store {
    pub fn get_chat(&self, id: &str, case_id: Option<&str>) -> Result<Conversation> {
        crate::validate_id(id)?;
        if let Some(case_id) = case_id {
            self.get(case_id)?;
        }
        let body: Option<String> = self
            .conn
            .query_row("SELECT body FROM conversations WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(crate::storage_error)?;
        if let Some(body) = body {
            let c: Conversation = crate::decode(&body)?;
            if c.case_id.as_deref() != case_id {
                return Err("对话与案例不匹配。".into());
            }
            Ok(c)
        } else {
            Ok(Conversation {
                id: id.into(),
                case_id: case_id.map(str::to_string),
                title: String::new(),
                messages: vec![],
                updated_at_utc: String::new(),
            })
        }
    }
    pub fn list_chats(&self) -> Result<Vec<Conversation>> {
        let mut stmt = self.conn.prepare("SELECT body FROM conversations WHERE case_id IS NULL ORDER BY updated_at DESC LIMIT 100").map_err(crate::storage_error)?;
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(crate::storage_error)?
            .map(|r| {
                let mut c: Conversation = crate::decode(&r.map_err(crate::storage_error)?)?;
                c.messages.clear();
                Ok(c)
            })
            .collect()
    }
    pub fn delete_chat(&self, id: &str) -> Result<()> {
        crate::validate_id(id)?;
        self.conn
            .execute("DELETE FROM conversations WHERE id=?1", [id])
            .map_err(crate::storage_error)?;
        Ok(())
    }
    /// Shared machine facts survive new conversations and unfinished retests. Do not
    /// attach unrelated symptoms, free text, imported sensors or demo cases here.
    fn latest_machine_facts(&self) -> Result<Option<serde_json::Value>> {
        use crate::diagnostics::CaseMode;
        let mut latest: Option<(
            chrono::DateTime<chrono::FixedOffset>,
            String,
            crate::domain::Report,
        )> = None;
        for case in self.list()? {
            let Some(diagnostic) = &case.diagnostic else {
                continue;
            };
            if diagnostic.mode != CaseMode::SetupAudit {
                continue;
            }
            let reports = diagnostic
                .runs
                .iter()
                .filter(|r| ["completed", "completed_partial"].contains(&r.status.as_str()))
                .filter_map(|r| r.report.as_ref())
                .chain(case.report.as_ref().filter(|_| {
                    ["completed", "completed_partial"].contains(&case.status.as_str())
                }));
            for report in reports {
                if !["native_collected", "mixed"].contains(&report.provenance.as_str())
                    || !report.evidence.iter().any(native_setup_evidence)
                {
                    continue;
                }
                let Ok(time) = chrono::DateTime::parse_from_rfc3339(&report.generated_at_utc)
                else {
                    continue;
                };
                if latest
                    .as_ref()
                    .is_none_or(|(previous, _, _)| time > *previous)
                {
                    latest = Some((time, case.id.clone(), report.clone()));
                }
            }
        }
        Ok(latest.map(|(time,case_id,report)| {
            let checks: Vec<_> = report.audit_checks.iter().filter(|check| {
                if check.evidence_ids.is_empty() { return check.assessment == "unknown"; }
                check.evidence_ids.iter().all(|id| report.evidence.iter().any(|e| &e.id == id && native_setup_evidence(e)))
            }).take(64).collect();
            let displays: Vec<_> = report.evidence.iter().filter(|e| native_setup_evidence(e) && e.kind == "setup.display").take(16).enumerate().map(|(index,e)| {
                let key = e.fields.get("monitorKey");
                let check = report.audit_checks.iter().find(|c| c.metric == "refresh_rate" && c.object_id.as_ref() == key);
                let current_hz = e.fields.get("currentRefreshHz").and_then(|s| s.parse::<f64>().ok()).filter(|hz| hz.is_finite() && (1.0..=1000.0).contains(hz));
                let highest = check.and_then(|c| match c.assessment.as_str() { "no_issue_observed" => Some(true), "opportunity" => Some(false), _ => None });
                serde_json::json!({"displayIndex":index+1,"observedAtUtc":e.observed_at_utc,"observedAtCst":e.observed_at_utc.as_deref().map(to_china_time),"currentHz":current_hz,"width":e.fields.get("width"),"height":e.fields.get("height"),"atHighestRecognizedSameResolution":highest,"comparison":check.map(|c|&c.summary),"limitations":check.map(|c|&c.limitations)})
            }).collect();
            serde_json::json!({"source":"saved_native_setup_audit","sourceCaseId":case_id,"reportGeneratedAtUtc":report.generated_at_utc,"reportGeneratedAtCst":to_china_time(&report.generated_at_utc),"olderThan24Hours":chrono::Utc::now().signed_duration_since(time).num_hours()>=24,"displays":displays,"auditChecks":checks,"limitations":"上次已保存的本机体检事实，不是实时采样。对已有字段直接回答并标注采集时间（使用北京时间 UTC+8）；除非用户要实时数据或设备/接线/设置已变化，不要要求重复检查。已识别同分辨率模式中的最高，不等于已证明面板所有模式的绝对上限。"})
        }))
    }
    pub fn save_chat_reply(
        &self,
        request: &ChatRequest,
        expected_messages: usize,
        reply: ChatMessage,
    ) -> Result<Conversation> {
        let mut c = self.get_chat(&request.conversation_id, request.case_id.as_deref())?;
        // A deleted/superseded conversation cannot silently be recreated by an old request.
        if c.messages.len() != expected_messages {
            return Err("对话已变化，请重新打开后发送。".into());
        }
        if c.messages.len() >= 200 {
            return Err("此对话已达 100 轮，请新建对话。".into());
        }
        if c.title.is_empty() {
            c.title = request.message.trim().chars().take(32).collect();
        }
        c.messages.push(ChatMessage {
            role: "user".into(),
            text: request.message.trim().into(),
            origin: "user".into(),
        });
        c.messages.push(reply);
        c.updated_at_utc = chrono::Utc::now().to_rfc3339();
        self.conn.execute("INSERT INTO conversations(id,case_id,body,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",params![c.id,c.case_id,crate::encode(&c)?,c.updated_at_utc]).map_err(crate::storage_error)?;
        Ok(c)
    }
    pub fn chat_input(&self, request: &ChatRequest) -> Result<(Conversation, ChatInput)> {
        if request.message.trim().is_empty()
            || request.message.chars().count() > 4000
            || request.message.contains('\0')
        {
            return Err("消息需为 1–4000 字。".into());
        }
        let c = self.get_chat(&request.conversation_id, request.case_id.as_deref())?;
        if c.messages.len() >= 200 {
            return Err("此对话已达 100 轮，请新建对话。".into());
        }
        let hardware = request
            .hardware
            .as_ref()
            .map(hardware_context)
            .transpose()?;
        let machine_facts = self.latest_machine_facts()?;
        let case = request
            .case_id
            .as_ref()
            .map(|id| self.get(id))
            .transpose()?;
        let case_context = case.as_ref().map(|c| serde_json::json!({"symptom":c.symptom,"incidentStartUtc":c.incident_start_utc,"incidentEndUtc":c.incident_end_utc}));
        let report = case.and_then(|c| c.report);
        let report_context = report.map(|r| serde_json::json!({
            "provenance":r.provenance,"generatedAtUtc":r.generated_at_utc,"generatedAtCst":to_china_time(&r.generated_at_utc),"findings":r.findings.into_iter().take(16).collect::<Vec<_>>(),
            "auditChecks":r.audit_checks.into_iter().take(32).collect::<Vec<_>>(),
            "unknowns":r.unknowns.into_iter().take(16).collect::<Vec<_>>()
        }));
        // Keep complete recent pairs only; failed replies aren't conversational evidence.
        let mut messages: Vec<_> = c
            .messages
            .chunks_exact(2)
            .rev()
            .filter(|pair| pair[1].origin == "model")
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .flatten()
            .cloned()
            .collect();
        messages.push(ChatMessage {
            role: "user".into(),
            text: request.message.trim().into(),
            origin: "user".into(),
        });
        let current_time_cst = chrono::Utc::now()
            .with_timezone(&cst_offset())
            .format("%Y-%m-%d %H:%M:%S (北京时间 UTC+8)")
            .to_string();
        let mut context = serde_json::json!({"currentTimeCst":current_time_cst,"hardware":hardware,"machineFacts":machine_facts,"case":case_context,"report":report_context,"historyWindow":"仅携带最近最多6轮成功对话；更早内容未发送。"});
        crate::export::redact_value(&mut context);
        for m in &mut messages {
            let mut value = serde_json::Value::String(m.text.clone());
            crate::export::redact_value(&mut value);
            m.text = value.as_str().unwrap_or("").into();
        }
        // Bounded context/history. Trim oldest complete pairs, never truncate the question.
        while serde_json::to_vec(&messages)
            .map_err(|_| "对话编码失败。")?
            .len()
            > 24 * 1024
            && messages.len() > 1
        {
            messages.drain(..2);
        }
        let input = ChatInput { messages, context };
        if serde_json::to_vec(&input)
            .map_err(|_| "上下文编码失败。")?
            .len()
            > 96 * 1024
        {
            return Err("本轮上下文过大，请新建对话或减少消息长度。".into());
        }
        Ok((c, input))
    }
}
fn native_setup_evidence(e: &crate::domain::Evidence) -> bool {
    e.kind.starts_with("setup.")
        && e.source == "windows:local"
        && e.fields
            .get("measurementOrigin")
            .is_some_and(|s| s == "native_collected")
}
fn hardware_context(h: &HardwareSnapshot) -> Result<serde_json::Value> {
    if h.origin != "windows_native"
        || h.groups.len() > 12
        || h.groups.iter().any(|g| g.items.len() > 64)
        || serde_json::to_vec(h).map_err(|_| "硬件摘要无效。")?.len() > 256 * 1024
    {
        return Err("只允许有界的本机硬件快照作为模型上下文。".into());
    }
    let groups: Vec<_> = h.groups.iter().map(|g| serde_json::json!({
        "id":g.id,"status":g.status,
        "items":g.items.iter().take(16).map(|i| serde_json::json!({
            "name":i.name.chars().take(256).collect::<String>(),
            "details":i.details.iter().take(8).map(|s| s.chars().take(256).collect::<String>()).collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    })).collect();
    Ok(
        serde_json::json!({"origin":h.origin,"collectedAtUtc":h.collected_at_utc,"collectedAtCst":to_china_time(&h.collected_at_utc),"computerModel":h.computer_model,"operatingSystem":h.operating_system,"groups":groups,"limitations":"缓存采集时刻的配置，非实时传感器；每组最多16个设备，细节有长度限制。"}),
    )
}
fn cst_offset() -> chrono::FixedOffset {
    chrono::FixedOffset::east_opt(8 * 3600).expect("valid +08:00 offset")
}
fn to_china_time(rfc3339: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map(|dt| {
            dt.with_timezone(&cst_offset())
                .format("%Y-%m-%d %H:%M:%S (北京时间 UTC+8)")
                .to_string()
        })
        .unwrap_or_else(|_| rfc3339.to_string())
}
