use sentinel_core::{
    Store,
    chat::*,
    gateway::ModelGateway,
    provider::{Endpoint, HttpTransport, HttpsJsonProvider, ModelConfig},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Transport(Mutex<Vec<Value>>);
impl HttpTransport for Transport {
    fn post(&self, endpoint: &Endpoint, key: &str, body: &[u8]) -> sentinel_core::Result<Vec<u8>> {
        assert_eq!(endpoint.path, "/chat/completions");
        assert_eq!(key, "test-key-only");
        let body: Value = serde_json::from_slice(body).unwrap();
        let last = body["messages"].as_array().unwrap().last().unwrap()["content"]
            .as_str()
            .unwrap();
        let answer = if last.contains("你是谁") {
            "我是哨兵的 AI 助手。"
        } else {
            "根据本机快照，你的系统是 Windows 11。"
        };
        self.0.lock().unwrap().push(body);
        Ok(serde_json::to_vec(&json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":answer}}]})).unwrap())
    }
}
fn request(id: &str, message: &str) -> ChatRequest {
    ChatRequest {
        conversation_id: id.into(),
        case_id: None,
        message: message.into(),
        hardware: None,
        allow_model: true,
    }
}
#[test]
fn actual_chat_provider_receives_question_inventory_and_previous_turns() {
    let store = Store::memory().unwrap();
    let transport = Arc::new(Transport::default());
    let config: ModelConfig = serde_json::from_value(json!({"apiKey":"test-key-only"})).unwrap();
    let gateway = ModelGateway::with_provider(Arc::new(
        HttpsJsonProvider::with_transport(config, transport.clone()).unwrap(),
    ));
    let id = uuid::Uuid::new_v4().to_string();
    let r = request(&id, "你是谁？");
    let (c, input) = store.chat_input(&r).unwrap();
    let reply = gateway.chat(input, true);
    assert_eq!(reply.origin, "model");
    assert!(reply.text.contains("哨兵"));
    store.save_chat_reply(&r, c.messages.len(), reply).unwrap();
    let mut r = request(&id, "我的电脑系统是什么？邮箱 user@example.com");
    r.hardware=Some(serde_json::from_value(json!({"origin":"windows_native","collectedAtUtc":"2026-11-14T00:00:00Z","computerModel":"Test laptop","operatingSystem":"Windows 11","groups":[{"id":"cpu","label":"处理器","status":"available","items":[{"name":"Test CPU","details":[],"problem":false}]}]})).unwrap());
    let (c, input) = store.chat_input(&r).unwrap();
    assert_eq!(input.messages.len(), 3);
    assert!(
        !serde_json::to_string(&input)
            .unwrap()
            .contains("user@example.com")
    );
    let reply = gateway.chat(input, true);
    assert!(reply.text.contains("Windows 11"));
    let saved = store.save_chat_reply(&r, c.messages.len(), reply).unwrap();
    assert_eq!(saved.messages.len(), 4);
    assert!(saved.messages[2].text.contains("user@example.com")); // Local original, redacted for model only.
    let captured = transport.0.lock().unwrap();
    assert_eq!(captured.len(), 2);
    assert!(captured[1]["messages"].to_string().contains("Windows 11"));
    assert!(captured[1]["messages"].to_string().contains("我是哨兵"));
    assert!(captured[1].get("response_format").is_none());
    assert!(captured[1].get("tools").is_none());
    assert_eq!(captured[1]["stream"], false);
    assert_eq!(store.list_chats().unwrap().len(), 1);
}
#[test]
fn consent_and_configuration_failures_are_explicit_and_not_model_history() {
    let store = Store::memory().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let r = request(&id, "问题");
    let (_, input) = store.chat_input(&r).unwrap();
    let transport = Arc::new(Transport::default());
    let config: ModelConfig = serde_json::from_value(json!({"apiKey":"test-key-only"})).unwrap();
    let gateway = ModelGateway::with_provider(Arc::new(
        HttpsJsonProvider::with_transport(config, transport.clone()).unwrap(),
    ));
    let no_consent = gateway.chat(input.clone(), false);
    assert_eq!(no_consent.origin, "unavailable");
    assert!(no_consent.text.contains("未发起"));
    assert!(transport.0.lock().unwrap().is_empty());
    let no_config = ModelGateway::default().chat(input, true);
    assert!(no_config.text.contains("尚未配置"));
    store.save_chat_reply(&r, 0, no_config).unwrap();
    let (_, input) = store.chat_input(&request(&id, "再问一次")).unwrap();
    assert_eq!(input.messages.len(), 1);
    assert!(store.save_chat_reply(&r, 0, no_consent).is_err());
}
#[test]
fn contexts_are_bounded_and_demo_inventory_is_never_sent_as_native() {
    let store = Store::memory().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    assert!(store.chat_input(&request(&id, &"字".repeat(4001))).is_err());
    assert!(store.chat_input(&request("not-an-id", "hello")).is_err());
    let mut r = request(&id, "配置");
    r.hardware=Some(serde_json::from_value(json!({"origin":"browser_demo","collectedAtUtc":"","computerModel":"","operatingSystem":"","groups":[]})).unwrap());
    assert!(store.chat_input(&r).is_err());
}
#[test]
fn local_conversation_survives_restart_and_delete_removes_it() {
    let root = std::env::temp_dir().join(format!("sentinel-chat-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("metadata.sqlite");
    let id = uuid::Uuid::new_v4().to_string();
    let r = request(&id, "我的系统");
    {
        let store = Store::open(&path).unwrap();
        store
            .save_chat_reply(
                &r,
                0,
                ChatMessage {
                    role: "assistant".into(),
                    text: "这是测试回复".into(),
                    origin: "model".into(),
                },
            )
            .unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get_chat(&id, None).unwrap().messages.len(), 2);
        assert_eq!(store.list_chats().unwrap()[0].title, "我的系统");
        store.delete_chat(&id).unwrap();
        assert!(store.list_chats().unwrap().is_empty());
    }
    std::fs::remove_dir_all(root).unwrap();
}

// Synthetic evidence goes through the same rules, approval and stored-run path,
// without collecting hardware or contacting any service.
fn save_audit(store: &mut Store, hz: f64, time: &str, native: bool) -> String {
    use sentinel_core::{diagnostics::*, domain::*};
    let c = store
        .create_setup_audit(SetupAuditRequest::default())
        .unwrap();
    let c = store.build_plan(&c.id).unwrap();
    let p = c.plan.unwrap();
    let consent = store
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    let work = store
        .begin_native_run(StartRequest {
            case_id: c.id.clone(),
            plan_id: p.id,
            plan_hash: p.hash,
            consent_token: consent.token,
        })
        .unwrap()
        .work
        .unwrap();
    let fields = |pairs: Vec<(&str, String)>| {
        pairs
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .chain([(
                "measurementOrigin".into(),
                if native {
                    "native_collected"
                } else {
                    "imported_report_declared"
                }
                .into(),
            )])
            .collect()
    };
    let display = Evidence {
        id: "display".into(),
        kind: "setup.display".into(),
        source: if native {
            "windows:local"
        } else {
            "sha256:synthetic"
        }
        .into(),
        observed_at_utc: Some(time.into()),
        provider: None,
        channel: None,
        event_id: None,
        schema_version: None,
        record_id: None,
        entity: None,
        boot_session: None,
        fields: fields(vec![
            ("monitorKey", "screen-A".into()),
            ("sessionKind", "local".into()),
            ("width", "2560".into()),
            ("height", "1440".into()),
            ("currentRefreshHz", hz.to_string()),
        ]),
    };
    let modes = Evidence {
        id: "modes".into(),
        kind: "setup.monitor_modes".into(),
        fields: fields(vec![
            ("monitorKey", "screen-A".into()),
            (
                "edidModesJson",
                format!("[{{\"width\":2560,\"height\":1440,\"hz\":{hz}}}]"),
            ),
            ("sourceModesJson", "[]".into()),
        ]),
        ..display.clone()
    };
    let mut report = sentinel_core::rules::analyze_evidence(
        vec![display, modes],
        vec![Coverage {
            source: "audit.refresh_rate".into(),
            status: "available".into(),
            detail: "synthetic fixture".into(),
        }],
        "2026-11-14T00:00:00Z",
        "2026-11-14T01:00:00Z",
        vec![],
    )
    .unwrap();
    report.generated_at_utc = time.into();
    report.unknowns.push("PRIVATE_OTHER_CASE_SYMPTOM".into());
    store
        .finish_native_run(&c.id, &work.run_id, report, vec![], false)
        .unwrap();
    store
        .rename_case(&c.id, "PRIVATE_OTHER_CASE_TITLE")
        .unwrap();
    c.id
}

#[test]
fn new_chat_reuses_saved_280hz_audit_in_actual_provider_request_after_restart() {
    let root = std::env::temp_dir().join(format!("sentinel-chat-facts-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("metadata.sqlite");
    let time = chrono::Utc::now().to_rfc3339();
    {
        let mut store = Store::open(&path).unwrap();
        save_audit(&mut store, 280.0, &time, true);
    }
    {
        let store = Store::open(&path).unwrap();
        let (_, input) = store
            .chat_input(&request(
                &uuid::Uuid::new_v4().to_string(),
                "我的显示器刷新率是最高的吗？",
            ))
            .unwrap();
        assert!(input.context["report"].is_null());
        let facts = &input.context["machineFacts"];
        assert_eq!(facts["displays"][0]["currentHz"], 280.0);
        assert_eq!(
            facts["displays"][0]["atHighestRecognizedSameResolution"],
            true
        );
        assert_eq!(facts["reportGeneratedAtUtc"], time);
        assert!(!input.context.to_string().contains("PRIVATE_OTHER_CASE"));
        let transport = Arc::new(Transport::default());
        let config: ModelConfig =
            serde_json::from_value(json!({"apiKey":"test-key-only"})).unwrap();
        let gateway = ModelGateway::with_provider(Arc::new(
            HttpsJsonProvider::with_transport(config, transport.clone()).unwrap(),
        ));
        assert_eq!(gateway.chat(input, true).origin, "model");
        let body = transport.0.lock().unwrap()[0].to_string();
        assert!(body.contains("280"));
        assert!(body.contains("saved_native_setup_audit"));
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn latest_native_report_wins_and_imports_do_not_poison_machine_facts() {
    let mut store = Store::memory().unwrap();
    save_audit(&mut store, 280.0, "2026-11-14T02:00:00Z", true);
    save_audit(&mut store, 60.0, "2026-11-14T01:00:00Z", true); // Newer case row, older measurement.
    save_audit(&mut store, 999.0, "2026-11-14T03:00:00Z", false);
    let id = uuid::Uuid::new_v4().to_string();
    let (_, input) = store.chat_input(&request(&id, "刷新率")).unwrap();
    assert_eq!(
        input.context["machineFacts"]["displays"][0]["currentHz"],
        280.0
    );
    let latest = save_audit(&mut store, 144.0, "2026-11-14T04:00:00Z", true);
    let (_, input) = store.chat_input(&request(&id, "现在呢")).unwrap();
    assert_eq!(
        input.context["machineFacts"]["displays"][0]["currentHz"],
        144.0
    );
    store
        .create_retest_run(sentinel_core::diagnostics::RetestRequest {
            case_id: latest.clone(),
            changed_variable: "尚未执行".into(),
            user_feedback: "等待".into(),
        })
        .unwrap();
    let (_, input) = store.chat_input(&request(&id, "已有数据")).unwrap();
    assert_eq!(
        input.context["machineFacts"]["displays"][0]["currentHz"],
        144.0
    );
    store.delete(&latest).unwrap();
    let (_, input) = store.chat_input(&request(&id, "删除之后")).unwrap();
    assert_eq!(
        input.context["machineFacts"]["displays"][0]["currentHz"],
        280.0
    );
}
