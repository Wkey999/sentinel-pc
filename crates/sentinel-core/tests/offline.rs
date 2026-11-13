use chrono::Utc;
use sentinel_core::{Store, authorize_window, domain::*, plan_hash, rules::analyze};

const START: &str = "2026-11-12T01:53:00Z";
const END: &str = "2026-11-12T02:13:00Z";
fn input(id: &str) -> CreateCase {
    CreateCase {
        scenario_id: id.into(),
        symptom: "合成问题，不读取私人报告".into(),
        incident_start_utc: START.into(),
        incident_end_utc: END.into(),
        display_timezone: "Asia/Hong_Kong".into(),
        environment: "personal".into(),
        category: None,
        interview: None,
    }
}
fn scenario(id: &str) -> Scenario {
    catalog()
        .scenarios
        .into_iter()
        .find(|s| s.id == id)
        .unwrap()
}
fn ready(store: &Store, id: &str) -> (CaseRecord, StartRequest) {
    let c = store.create(input(id)).unwrap();
    let c = store.build_plan(&c.id).unwrap();
    let p = c.plan.as_ref().unwrap();
    let consent = store
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    let request = StartRequest {
        case_id: c.id.clone(),
        plan_id: p.id.clone(),
        plan_hash: p.hash.clone(),
        consent_token: consent.token,
    };
    (c, request)
}

#[test]
fn event_41_observes_without_hardware_diagnosis() {
    let r = analyze(&scenario("restart"), START, END);
    assert_eq!(r.findings.len(), 1);
    assert_eq!(r.findings[0].rule_id, "WIN-RESTART-001");
    assert!(
        r.findings[0]
            .limitations
            .iter()
            .any(|l| l.contains("不能仅凭"))
    );
    assert_eq!(r.findings[0].evidence_ids, ["ev-restart-41"]);
}
#[test]
fn wrong_provider_channel_or_schema_does_not_match() {
    for field in ["provider", "channel", "schema"] {
        let mut s = scenario("restart");
        match field {
            "provider" => s.evidence[0].provider = Some("Fake Kernel-Power".into()),
            "channel" => s.evidence[0].channel = Some("Application".into()),
            _ => s.evidence[0].schema_version = Some(99),
        }
        assert!(analyze(&s, START, END).findings.is_empty());
    }
}
#[test]
fn association_requires_same_entity_source_boot_and_order() {
    assert_eq!(
        analyze(&scenario("application"), START, END).findings.len(),
        2
    );
    for field in ["entity", "boot", "source", "order", "missing"] {
        let mut s = scenario("application");
        match field {
            "entity" => s.evidence[1].entity = Some("different.exe".into()),
            "boot" => s.evidence[1].boot_session = Some("boot-2".into()),
            "source" => s.evidence[1].source = "other-machine.json".into(),
            "order" => s.evidence[1].observed_at_utc = Some("2026-11-12T02:02:00Z".into()),
            _ => s.evidence[1].entity = None,
        }
        assert_eq!(analyze(&s, START, END).findings.len(), 1, "{field}");
    }
}
#[test]
fn out_of_window_events_not_used() {
    let r = analyze(
        &scenario("restart"),
        "2026-11-13T01:53:00Z",
        "2026-11-13T02:13:00Z",
    );
    assert!(r.findings.is_empty());
    assert_eq!(r.evidence.len(), 1);
    assert!(r.unknowns.iter().any(|u| u.contains("时间窗口")));
}
#[test]
fn empty_and_denied_are_distinct_without_false_pass() {
    let empty = analyze(&scenario("empty"), START, END);
    let denied = analyze(&scenario("insufficient"), START, END);
    assert_eq!(empty.coverage[0].status, "empty");
    assert_eq!(denied.coverage[0].status, "permission_denied");
    assert!(empty.unknowns.iter().any(|s| s.contains("不代表没有故障")));
    assert!(denied.findings.is_empty());
}
#[test]
fn all_findings_reference_existing_evidence() {
    for s in catalog().scenarios {
        let r = analyze(&s, START, END);
        for f in r.findings {
            for id in f.evidence_ids {
                assert!(r.evidence.iter().any(|e| e.id == id));
            }
        }
    }
}
#[test]
fn unknown_command_fields_and_nested_fields_rejected() {
    let mut v = serde_json::to_value(input("restart")).unwrap();
    v["command"] = "powershell".into();
    assert!(serde_json::from_value::<CreateCase>(v).is_err());
    let mut s = serde_json::to_value(scenario("restart")).unwrap();
    s["evidence"][0]["execute"] = "cmd".into();
    assert!(serde_json::from_value::<Scenario>(s).is_err());
}
#[test]
fn invalid_scope_time_environment_and_paths_rejected() {
    let store = Store::memory().unwrap();
    let mut r = input("restart");
    r.incident_end_utc = "2026-12-01T00:00:00Z".into();
    assert!(store.create(r).is_err());
    let mut r = input("restart");
    r.environment = "admin".into();
    assert!(store.create(r).is_err());
    assert!(store.create(input("windows.event_window")).is_err());
    assert!(store.get("../../private").is_err());
}
#[test]
fn unauthorized_window_rejected() {
    assert!(authorize_window("main").is_ok());
    assert!(authorize_window("other").is_err());
    assert!(authorize_window("main-evil").is_err());
}
#[test]
fn plan_hash_covers_actual_parameters_and_version() {
    let store = Store::memory().unwrap();
    let (c, _) = ready(&store, "restart");
    let p = c.plan.unwrap();
    let mut changed = p.clone();
    changed.incident_end_utc = END.replace("02:13", "03:13");
    assert_ne!(plan_hash(&changed).unwrap(), p.hash);
    changed = p.clone();
    changed.adapter_version = "changed".into();
    assert_ne!(plan_hash(&changed).unwrap(), p.hash);
}
#[test]
fn changed_plan_invalidates_old_consent() {
    let mut store = Store::memory().unwrap();
    let (c, r) = ready(&store, "restart");
    store.build_plan(&c.id).unwrap();
    assert!(store.start(r).is_err());
}
#[test]
fn tampered_hash_and_token_never_start() {
    let mut store = Store::memory().unwrap();
    let (_, mut r) = ready(&store, "restart");
    let original = r.clone();
    r.plan_hash = "0".repeat(64);
    assert!(store.start(r).is_err());
    r = original;
    r.consent_token = uuid::Uuid::new_v4().to_string();
    assert!(store.start(r).is_err());
}
#[test]
fn repeated_start_returns_same_report() {
    let mut store = Store::memory().unwrap();
    let (_, r) = ready(&store, "restart");
    let first = store.start(r.clone()).unwrap();
    let second = store.start(r).unwrap();
    assert_eq!(
        first.report.unwrap().generated_at_utc,
        second.report.unwrap().generated_at_utc
    );
    assert_eq!(store.list().unwrap().len(), 1);
}
#[test]
fn renaming_preserves_case_plan_consent_report_and_does_not_duplicate() {
    let mut store = Store::memory().unwrap();
    let (original, request) = ready(&store, "restart");
    let renamed = store.rename_case(&original.id, "  游戏重启排查  ").unwrap();
    assert_eq!(renamed.id, original.id);
    assert_eq!(renamed.title, "游戏重启排查");
    assert_eq!(
        renamed.plan.as_ref().unwrap().hash,
        original.plan.as_ref().unwrap().hash
    );
    let done = store.start(request).unwrap();
    assert_eq!(done.title, "游戏重启排查");
    let report = serde_json::to_value(&done.report).unwrap();
    store.rename_case(&done.id, "复查记录").unwrap();
    assert_eq!(
        serde_json::to_value(store.get(&done.id).unwrap().report).unwrap(),
        report
    );
    assert_eq!(store.list().unwrap().len(), 1);
    store.delete(&done.id).unwrap();
    assert!(store.list().unwrap().is_empty());
}
#[test]
fn case_names_are_validated_and_survive_reopening() {
    let root = std::env::temp_dir().join(format!("sentinel-case-name-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("metadata.sqlite");
    let id;
    {
        let store = Store::open(&path).unwrap();
        let record = store.create(input("restart")).unwrap();
        id = record.id;
        for name in [
            String::new(),
            "x\ny".into(),
            "x\u{0}y".into(),
            "字".repeat(81),
        ] {
            assert!(store.rename_case(&id, &name).is_err());
        }
        store.rename_case(&id, "我的笔记本").unwrap();
    }
    {
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.get(&id).unwrap().title, "我的笔记本");
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn export_does_not_leak_symptom_serial_or_consent() {
    let mut store = Store::memory().unwrap();
    let (_, r) = ready(&store, "storage");
    let token = r.consent_token.clone();
    let c = store.start(r).unwrap();
    for format in ["json", "markdown"] {
        let result = store
            .export(ExportRequest {
                case_id: c.id.clone(),
                format: format.into(),
            })
            .unwrap();
        assert!(!result.content.contains("SN-DEMO-001"));
        assert!(!result.content.contains(&token));
        assert!(!result.content.contains(&c.symptom));
        assert!(result.content.contains("合成") || result.content.contains("synthetic"));
    }
}
#[test]
fn deletion_cascades_and_invalidates_consent() {
    let mut store = Store::memory().unwrap();
    let (c, r) = ready(&store, "restart");
    store.delete(&c.id).unwrap();
    assert!(store.get(&c.id).is_err());
    assert!(store.start(r).is_err());
    assert!(store.list().unwrap().is_empty());
}
#[test]
fn restart_invalidates_unused_consent_and_marks_interrupted() {
    let path = std::env::temp_dir().join(format!("sentinel-test-{}.sqlite", uuid::Uuid::new_v4()));
    let (id, r) = {
        let store = Store::open(&path).unwrap();
        let (c, r) = ready(&store, "restart");
        (c.id, r)
    };
    {
        let mut reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.get(&id).unwrap().status, "interrupted");
        assert!(reopened.start(r).is_err());
    }
    std::fs::remove_file(path).unwrap();
}
#[test]
fn expired_consent_rejected() {
    let path = std::env::temp_dir().join(format!("sentinel-test-{}.sqlite", uuid::Uuid::new_v4()));
    {
        let mut store = Store::open(&path).unwrap();
        let (_, r) = ready(&store, "restart");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE consents SET expires_at=?1",
            [Utc::now()
                .checked_sub_signed(chrono::Duration::minutes(20))
                .unwrap()
                .to_rfc3339()],
        )
        .unwrap();
        assert!(store.start(r).is_err());
    }
    std::fs::remove_file(path).unwrap();
}
#[test]
fn newer_database_schema_not_overwritten() {
    let path = std::env::temp_dir().join(format!("sentinel-test-{}.sqlite", uuid::Uuid::new_v4()));
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
    }
    assert!(Store::open(&path).is_err());
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 99);
    }
    std::fs::remove_file(path).unwrap();
}
