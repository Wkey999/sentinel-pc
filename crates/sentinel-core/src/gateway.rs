//! Provider implementations receive only redacted, bounded data and return typed suggestions.
//! No provider or model output has access to the runner, store or execution policy.
use crate::{diagnostics::*, domain::Report};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub trait ModelProvider: Send + Sync + 'static {
    fn protocol(&self) -> &'static str {
        "custom"
    }
    fn model(&self) -> Option<String> {
        None
    }
    fn target(&self) -> Option<String> {
        None
    }
    fn interview(&self, redacted: InterviewRequest) -> crate::Result<Vec<Question>>;
    fn explain(&self, redacted: Report, allowed_actions: Vec<String>)
    -> crate::Result<Explanation>;
    fn chat(&self, _input: crate::chat::ChatInput) -> crate::Result<String> {
        Err("此模型适配器尚不支持多轮对话，请选择 Chat Completions。".into())
    }
    fn chat_stream(
        &self,
        input: crate::chat::ChatInput,
        on_delta: &mut dyn FnMut(&str),
    ) -> crate::Result<String> {
        let text = self.chat(input)?;
        on_delta(&text);
        Ok(text)
    }
}
#[derive(Clone, Default)]
pub struct ModelGateway {
    provider: Option<Arc<dyn ModelProvider>>,
    busy: Arc<AtomicBool>,
}
impl ModelGateway {
    pub fn protocol(&self) -> &'static str {
        self.provider.as_ref().map_or("disabled", |p| p.protocol())
    }
    pub fn model(&self) -> Option<String> {
        self.provider.as_ref().and_then(|p| p.model())
    }
    pub fn with_provider(provider: Arc<dyn ModelProvider>) -> Self {
        Self {
            provider: Some(provider),
            busy: Arc::default(),
        }
    }
    pub fn enabled(&self) -> bool {
        self.provider.is_some()
    }
    fn run_chat_with<F>(
        &self,
        input: crate::chat::ChatInput,
        allow_model: bool,
        invoke_provider: F,
    ) -> crate::chat::ChatMessage
    where
        F: FnOnce(Arc<dyn ModelProvider>, crate::chat::ChatInput) -> crate::Result<String>
            + Send
            + 'static,
    {
        let unavailable = |text: &str| crate::chat::ChatMessage {
            role: "assistant".into(),
            text: text.into(),
            origin: "unavailable".into(),
        };
        let Some(provider) = self.provider.clone() else {
            return unavailable(
                "尚未配置 AI 模型。请在「设置与关于」填写兼容 Chat Completions 的服务地址、模型和 Key；当前本地体检仍可使用。",
            );
        };
        if !allow_model {
            return unavailable(
                "本轮尚未同意发送给模型，未发起联网请求。你仍可使用本机硬件信息和只读体检。",
            );
        }
        let Ok(slot) = ModelSlot::acquire(self.busy.clone()) else {
            return unavailable("模型正在处理另一个请求，请稍后重试；本轮未发送。");
        };
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let _slot = slot;
            let _ = tx.send(invoke_provider(provider, input));
        });
        match rx.recv_timeout(std::time::Duration::from_secs(45)) {
            Ok(Ok(text))
                if !text.trim().is_empty()
                    && text.chars().count() <= 12000
                    && !text.contains('\0') =>
            {
                crate::chat::ChatMessage {
                    role: "assistant".into(),
                    text,
                    origin: "model".into(),
                }
            }
            Ok(Err(error)) => unavailable(&error),
            Ok(Ok(_)) => unavailable("模型回复为空或超出长度限制，请重试。"),
            Err(_) => {
                unavailable("模型回复超时；未自动重试，也没有用体检摘要代替回答。请稍后再试。")
            }
        }
    }
    pub fn chat(
        &self,
        input: crate::chat::ChatInput,
        allow_model: bool,
    ) -> crate::chat::ChatMessage {
        self.run_chat_with(input, allow_model, |provider, input| provider.chat(input))
    }
    pub fn chat_stream<F>(
        &self,
        input: crate::chat::ChatInput,
        allow_model: bool,
        mut on_delta: F,
    ) -> crate::chat::ChatMessage
    where
        F: FnMut(&str) + Send + 'static,
    {
        self.run_chat_with(input, allow_model, move |provider, input| {
            provider.chat_stream(input, &mut on_delta)
        })
    }
    pub fn target(&self) -> Option<String> {
        self.provider.as_ref().and_then(|p| p.target())
    }
    pub fn assist_interview(&self, r: InterviewRequest) -> crate::Result<InterviewResult> {
        validate_interview(&r.context)?;
        if r.symptom.trim().is_empty() || r.symptom.chars().count() > 1000 {
            return Err("症状需为 1–1000 字。".into());
        }
        let mut questions = vec![];
        let mut add = |id: &str, prompt: &str| {
            if !r.context.answers.iter().any(|a| a.question_id == id) {
                questions.push(Question {
                    id: id.into(),
                    prompt: prompt.into(),
                });
            }
        };
        add("incident_time", "问题大约发生在什么时间？是否能重复出现？");
        if r.context.recent_changes.is_empty() {
            add(
                "recent_changes",
                "出现前是否更新过驱动、软件，或更换/插入了硬件？",
            );
        }
        add(
            "companion_symptom",
            match r.category {
                Category::GamingDisplay => "黑屏时声音是否继续？是恢复显示、退出游戏还是整机重启？",
                Category::RestartBsod => "是否出现蓝屏/停止代码，或有长按电源、断电的情况？",
                Category::StorageIo => "是哪个磁盘出现掉盘或读写异常？是否已经备份重要资料？",
                Category::OfficePeripheral => {
                    "是某个程序无响应，还是 USB 键鼠同时断连？换接口后怎样？"
                }
            },
        );
        let fallback = InterviewResult {
            origin: "local_rules".into(),
            questions,
            fallback_reason: Some("未配置模型或模型返回无效，使用本地追问。".into()),
        };
        if let Some(p) = self.provider.clone().filter(|_| r.allow_model) {
            let Ok(slot) = ModelSlot::acquire(self.busy.clone()) else {
                return Ok(fallback);
            };
            let Ok(redacted) = redacted(r) else {
                return Ok(fallback);
            };
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            std::thread::spawn(move || {
                let _slot = slot;
                let _ = tx.send(p.interview(redacted));
            });
            if let Ok(Ok(q)) = rx.recv_timeout(std::time::Duration::from_secs(30)) {
                let ids: std::collections::BTreeSet<_> = q.iter().map(|v| &v.id).collect();
                if q.len() <= 3
                    && !q.is_empty()
                    && ids.len() == q.len()
                    && q.iter()
                        .all(|x| safe_text(&x.prompt, 500) && safe_text(&x.id, 64))
                {
                    return Ok(InterviewResult {
                        origin: "model".into(),
                        questions: q,
                        fallback_reason: None,
                    });
                }
            }
        }
        Ok(fallback)
    }
    pub fn explain_report(&self, report: &Report, allowed: Vec<String>) -> Explanation {
        let mut fallback = report_explanation(report);
        if self.provider.is_some() {
            fallback.fallback_reason = Some(
                "模型请求失败、超时、摘要超限或输出校验未通过；保留本地规则与手动下一步。".into(),
            );
        }
        if let (Some(p), Ok(clean)) = (self.provider.clone(), redacted(report.clone())) {
            let Ok(slot) = ModelSlot::acquire(self.busy.clone()) else {
                return fallback;
            };
            let allowed_output = allowed.clone();
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            std::thread::spawn(move || {
                let _slot = slot;
                let _ = tx.send(p.explain(clean, allowed));
            });
            if let Ok(Ok(mut e)) = rx.recv_timeout(std::time::Duration::from_secs(30)) {
                if validate_explanation(&e, report).is_ok()
                    && e.suggested_action_ids
                        .iter()
                        .all(|id| allowed_output.contains(id))
                {
                    e.origin = "model".into();
                    e.fallback_reason = None;
                    // Model prose never introduces new manual system operations. Keep the
                    // evidence-backed, cost/risk-ordered instructions and stop conditions.
                    e.recommendations = report_explanation(report).recommendations;
                    return e;
                }
            }
        }
        fallback
    }
}
struct ModelSlot(Arc<AtomicBool>);
impl ModelSlot {
    fn acquire(busy: Arc<AtomicBool>) -> crate::Result<Self> {
        busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "模型繁忙。")?;
        Ok(Self(busy))
    }
}
impl Drop for ModelSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
pub fn validate_interview(c: &InterviewContext) -> crate::Result<()> {
    if [&c.frequency, &c.recent_changes, &c.reproduction]
        .iter()
        .any(|s| s.chars().count() > 1000)
        || c.answers.len() > 12
        || c.answers.iter().any(|a| {
            a.question_id.is_empty() || a.question_id.len() > 64 || a.answer.chars().count() > 1000
        })
        || c.answers
            .iter()
            .map(|a| &a.question_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != c.answers.len()
    {
        return Err("问诊上下文超限或答案重复。".into());
    }
    Ok(())
}
fn redacted<T: serde::Serialize + serde::de::DeserializeOwned>(v: T) -> crate::Result<T> {
    let mut json = serde_json::to_value(v).map_err(|_| "摘要编码失败。")?;
    crate::export::redact_value(&mut json);
    let b = serde_json::to_vec(&json).map_err(|_| "摘要编码失败。")?;
    if b.len() > 32 * 1024 {
        return Err("模型摘要超出预算。".into());
    }
    serde_json::from_slice(&b).map_err(|_| "摘要格式无效。".into())
}
fn safe_text(s: &str, max: usize) -> bool {
    !s.trim().is_empty()
        && s.chars().count() <= max
        && !s.contains(['<', '>', '`', '\0'])
        && ![
            "powershell",
            "cmd.exe",
            "-command",
            "执行命令",
            "确定损坏",
            "已排除所有",
            "curl ",
            "http://",
            "https://",
        ]
        .iter()
        .any(|x| s.to_lowercase().contains(x))
}
pub fn validate_explanation(e: &Explanation, report: &Report) -> crate::Result<()> {
    if !safe_text(&e.summary, 1500)
        || e.exclusions != local_explanation(&report.findings).exclusions
        || e.exclusions.len() > 12
        || e.exclusions.iter().any(|s| !safe_text(s, 500))
        || e.recommendations.len() > 8
        || e.suggested_action_ids.len() > 4
        || e.suggested_action_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != e.suggested_action_ids.len()
    {
        return Err("模型解释无效。".into());
    }
    for (i, r) in e.recommendations.iter().enumerate() {
        if r.priority != i as u32 + 1
            || !safe_text(&r.instruction, 1000)
            || !safe_text(&r.expected_result, 500)
            || !safe_text(&r.stop_condition, 500)
            || r.evidence_ids.is_empty()
            || r.evidence_ids
                .iter()
                .any(|id| !report.evidence.iter().any(|x| &x.id == id))
        {
            return Err("模型引用或建议格式无效。".into());
        }
    }
    Ok(())
}
