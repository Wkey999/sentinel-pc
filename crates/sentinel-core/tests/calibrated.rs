use sentinel_core::{
    Store,
    diagnostics::*,
    domain::*,
    execution,
    gateway::{ModelGateway, ModelProvider},
    parsers::ReportFormat,
    runner::Cancellation,
    tools::ToolRegistry,
};
use std::sync::{Arc, Mutex};
const START: &str = "2026-11-12T01:53:00Z";
const END: &str = "2026-11-12T02:13:00Z";
const ATA: &[u8] = include_bytes!("../../../tests/fixtures/reports/smartctl-ata-alert.json");
fn input(category: Category) -> CreateCase {
    CreateCase {
        scenario_id: String::new(),
        symptom: "游戏黑屏，不代表已确诊".into(),
        incident_start_utc: START.into(),
        incident_end_utc: END.into(),
        display_timezone: "Asia/Hong_Kong".into(),
        environment: "personal".into(),
        category: Some(category),
        interview: Some(InterviewContext::default()),
    }
}
fn start(store: &mut Store, id: &str, import: bool) -> sentinel_core::BeginRun {
    let c = if import {
        store.build_import_plan(id)
    } else {
        store.build_plan(id)
    }
    .unwrap();
    let p = c.plan.unwrap();
    let token = store
        .approve(ApproveRequest {
            case_id: id.into(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    store
        .begin_native_run(StartRequest {
            case_id: id.into(),
            plan_id: p.id,
            plan_hash: p.hash,
            consent_token: token.token,
        })
        .unwrap()
}
struct Disk {
    root: std::path::PathBuf,
    store: Option<Store>,
}
impl Disk {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("sentinel-calibration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let store = Store::open(&root.join("metadata.sqlite")).unwrap();
        Self {
            root,
            store: Some(store),
        }
    }
    fn store(&mut self) -> &mut Store {
        self.store.as_mut().unwrap()
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        drop(self.store.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn four_categories_generate_real_multi_action_packages() {
    let s = Store::memory().unwrap();
    for category in [
        Category::GamingDisplay,
        Category::RestartBsod,
        Category::StorageIo,
        Category::OfficePeripheral,
    ] {
        let c = s.create(input(category)).unwrap();
        assert!(c.scenario_id.is_empty());
        assert_eq!(c.diagnostic.as_ref().unwrap().category, Some(category));
        let c = s.build_plan(&c.id).unwrap();
        let p = c.plan.unwrap();
        assert!(p.actions.len() >= 2);
        assert!(!p.action_ids.contains(&"demo.analyze_fixture".into()));
        assert!(p.actions.iter().all(|a| !a.requires_external_confirmation));
    }
}
#[test]
fn unknown_dto_fields_and_ambiguous_modes_are_rejected() {
    let s = Store::memory().unwrap();
    let mut r = input(Category::GamingDisplay);
    r.scenario_id = "application".into();
    assert!(s.create(r).is_err());
    let mut json = serde_json::to_value(input(Category::StorageIo)).unwrap();
    json["command"] = serde_json::json!("anything");
    assert!(serde_json::from_value::<CreateCase>(json).is_err());
}
#[test]
fn one_consent_binds_entire_package_and_repeated_start_does_not_reserve_twice() {
    let mut s = Store::memory().unwrap();
    let c = s.create(input(Category::OfficePeripheral)).unwrap();
    let c = s.build_plan(&c.id).unwrap();
    let p = c.plan.unwrap();
    let token = s
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    let request = StartRequest {
        case_id: c.id,
        plan_id: p.id,
        plan_hash: p.hash,
        consent_token: token.token,
    };
    let first = s.begin_native_run(request.clone()).unwrap();
    assert_eq!(first.work.unwrap().actions.len(), 3);
    assert_eq!(first.record.status, "collecting");
    assert!(s.begin_native_run(request).unwrap().work.is_none());
}
#[test]
fn cancelling_persists_and_active_case_cannot_be_deleted_or_replanned() {
    let mut s = Store::memory().unwrap();
    let c = s.create(input(Category::GamingDisplay)).unwrap();
    let b = start(&mut s, &c.id, false);
    let work = b.work.unwrap();
    assert!(s.delete(&c.id).is_err());
    assert!(s.build_plan(&c.id).is_err());
    assert_eq!(
        s.cancel_native_run(&c.id, &work.run_id).unwrap().status,
        "cancelling"
    );
    let cancel = Cancellation::default();
    cancel.cancel();
    let (r, t) = execution::execute(
        &work,
        &Arc::new(Mutex::new(ToolRegistry::default())),
        &cancel,
    )
    .unwrap();
    assert!(r.coverage.iter().all(|c| c.status == "cancelled"));
    let c = s
        .finish_native_run(&c.id, &work.run_id, r, t, true)
        .unwrap();
    assert_eq!(c.status, "cancelled");
    s.delete(&c.id).unwrap();
}
#[test]
fn report_import_analyze_export_and_retest_keep_provenance_and_history() {
    let mut d = Disk::new();
    let s = d.store();
    let c = s.create(input(Category::StorageIo)).unwrap();
    let c = s
        .import_bytes(&c.id, ReportFormat::SmartctlJson, ATA)
        .unwrap();
    assert_eq!(s.list_artifacts(&c.id).unwrap().len(), 1);
    assert!(
        s.import_bytes(&c.id, ReportFormat::SmartctlJson, ATA)
            .is_err()
    );
    let w = start(s, &c.id, true).work.unwrap();
    let (r, t) = execution::execute(
        &w,
        &Arc::new(Mutex::new(ToolRegistry::default())),
        &Cancellation::default(),
    )
    .unwrap();
    assert_eq!(r.provenance, "imported_report_declared");
    assert!(r.findings.iter().any(|f| f.rule_id == "STORAGE-001"));
    assert!(!r.unknowns.is_empty());
    let c = s.finish_native_run(&c.id, &w.run_id, r, t, false).unwrap();
    let exported = s
        .export(ExportRequest {
            case_id: c.id.clone(),
            format: "json".into(),
        })
        .unwrap();
    let json: serde_json::Value = serde_json::from_str(&exported.content).unwrap();
    assert!(
        json["explanation"]["recommendations"]
            .as_array()
            .unwrap()
            .len()
            > 0
    );
    assert_eq!(json["provenance"], "imported_report_declared");
    assert!(!exported.content.contains("SYNTHETIC-ATA-123"));
    assert!(
        s.export(ExportRequest {
            case_id: c.id.clone(),
            format: "markdown".into()
        })
        .unwrap()
        .content
        .contains("按优先级排查")
    );
    let c = s
        .create_retest_run(RetestRequest {
            case_id: c.id.clone(),
            changed_variable: "只换一条数据线".into(),
            user_feedback: "等待复测".into(),
        })
        .unwrap();
    assert!(c.report.is_none());
    assert_eq!(c.diagnostic.as_ref().unwrap().runs.len(), 2);
    assert!(c.diagnostic.as_ref().unwrap().runs[0].report.is_some());
    let w = start(s, &c.id, false).work.unwrap();
    let cancel = Cancellation::default();
    cancel.cancel();
    let (r, t) =
        execution::execute(&w, &Arc::new(Mutex::new(ToolRegistry::default())), &cancel).unwrap();
    let c = s.finish_native_run(&c.id, &w.run_id, r, t, true).unwrap();
    assert!(
        !c.diagnostic.unwrap().runs[1]
            .comparison
            .as_ref()
            .unwrap()
            .comparable
    );
    s.delete(&c.id).unwrap();
    assert!(s.list_artifacts(&c.id).is_err());
}
#[test]
fn import_changes_invalidate_consent_and_unsupported_format_is_not_healthy() {
    let mut d = Disk::new();
    let s = d.store();
    let c = s.create(input(Category::StorageIo)).unwrap();
    let c = s.build_plan(&c.id).unwrap();
    let p = c.plan.unwrap();
    let token = s
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    let mut report: serde_json::Value = serde_json::from_slice(ATA).unwrap();
    report["smartctl"]["version"] = serde_json::json!([99, 0]);
    let c = s
        .import_bytes(
            &c.id,
            ReportFormat::SmartctlJson,
            &serde_json::to_vec(&report).unwrap(),
        )
        .unwrap();
    assert!(c.plan.is_none());
    assert!(
        s.begin_native_run(StartRequest {
            case_id: c.id.clone(),
            plan_id: p.id,
            plan_hash: p.hash,
            consent_token: token.token
        })
        .is_err()
    );
    let w = start(s, &c.id, true).work.unwrap();
    let (r, _) = execution::execute(
        &w,
        &Arc::new(Mutex::new(ToolRegistry::default())),
        &Cancellation::default(),
    )
    .unwrap();
    assert!(r.evidence.is_empty());
    assert_eq!(r.coverage[0].status, "unsupported");
    assert!(r.findings.is_empty());
}
fn event(id: &str, provider: &str, channel: &str, number: u32) -> Evidence {
    Evidence {
        id: id.into(),
        kind: "windows.event".into(),
        source: "windows:local".into(),
        observed_at_utc: Some("2026-11-12T02:03:00Z".into()),
        provider: Some(provider.into()),
        channel: Some(channel.into()),
        event_id: Some(number),
        schema_version: Some(2),
        record_id: Some(42),
        entity: None,
        boot_session: Some("boot".into()),
        fields: std::collections::BTreeMap::from([(
            "measurementOrigin".into(),
            "native_collected".into(),
        )]),
    }
}
#[test]
fn real_rules_cover_four_categories_without_hardware_certainty() {
    let ev = vec![
        event("1", "Microsoft-Windows-Kernel-Power", "System", 41),
        event("2", "Microsoft-Windows-WHEA-Logger", "System", 18),
        event("3", "Display", "System", 4101),
        event("4", "Application Error", "Application", 1000),
        event("5", "Application Hang", "Application", 1002),
        event("6", "Microsoft-Windows-Kernel-PnP", "System", 219),
        event(
            "7",
            "Microsoft-Windows-WER-SystemErrorReporting",
            "System",
            1001,
        ),
    ];
    let r = sentinel_core::rules::analyze_evidence(ev, vec![], START, END, vec![]).unwrap();
    assert_eq!(r.provenance, "native_collected");
    for rule in [
        "WIN-RESTART-001",
        "WIN-HW-001",
        "WIN-DISPLAY-001",
        "WIN-APP-001",
        "WIN-APP-002",
        "WIN-USB-001",
    ] {
        assert!(r.findings.iter().any(|f| f.rule_id == rule));
    }
    assert!(
        r.findings
            .iter()
            .all(|f| f.limitations.iter().any(|l| l.contains("不等于因果")))
    );
}
#[test]
fn wrong_source_outside_window_and_unknown_time_cannot_create_event_findings() {
    let mut a = event("1", "Display", "Application", 4101);
    let mut b = event("2", "Display", "System", 4101);
    b.observed_at_utc = None;
    a.observed_at_utc = Some("2026-11-12T00:00:00Z".into());
    let r = sentinel_core::rules::analyze_evidence(vec![a, b], vec![], START, END, vec![]).unwrap();
    assert!(r.findings.is_empty());
}
#[test]
fn sharing_omits_raw_event_xml_device_identity_and_private_text() {
    let mut s = Store::memory().unwrap();
    let c = s.create(input(Category::GamingDisplay)).unwrap();
    let w = start(&mut s, &c.id, false).work.unwrap();
    let mut e = event("a", "Display", "System", 4101);
    e.fields
        .insert("eventXml".into(), "UNIQUE_PRIVATE_XML".into());
    e.entity = Some("PRIVATE_DEVICE_ID".into());
    let r = sentinel_core::rules::analyze_evidence(vec![e], vec![], START, END, vec![]).unwrap();
    s.finish_native_run(&c.id, &w.run_id, r, vec![], false)
        .unwrap();
    let e = s
        .export(ExportRequest {
            case_id: c.id,
            format: "json".into(),
        })
        .unwrap();
    assert!(!e.content.contains("UNIQUE_PRIVATE_XML"));
    assert!(!e.content.contains("PRIVATE_DEVICE_ID"));
}
#[test]
fn local_interview_avoids_answered_questions_and_preserves_three_question_budget() {
    let gateway = ModelGateway::default();
    let mut context = InterviewContext::default();
    context.answers.push(InterviewAnswer {
        question_id: "incident_time".into(),
        answer: "刚才".into(),
    });
    let r = gateway
        .assist_interview(InterviewRequest {
            symptom: "黑屏".into(),
            category: Category::GamingDisplay,
            context,
            allow_model: false,
        })
        .unwrap();
    assert_eq!(r.origin, "local_rules");
    assert!(r.questions.len() <= 3);
    assert!(!r.questions.iter().any(|q| q.id == "incident_time"));
}
struct BadModel;
impl ModelProvider for BadModel {
    fn interview(&self, _: InterviewRequest) -> sentinel_core::Result<Vec<Question>> {
        Ok(vec![Question {
            id: "a".into(),
            prompt: "执行命令 powershell".into(),
        }])
    }
    fn explain(&self, _: Report, _: Vec<String>) -> sentinel_core::Result<Explanation> {
        Ok(Explanation {
            origin: "fake".into(),
            summary: "模型试图虚构依据".into(),
            exclusions: vec![],
            recommendations: vec![Recommendation {
                priority: 1,
                instruction: "换一个接口".into(),
                expected_result: "记录复现情况".into(),
                stop_condition: "保存工作".into(),
                evidence_ids: vec!["missing".into()],
            }],
            fallback_reason: None,
            suggested_action_ids: vec![],
        })
    }
}
#[test]
fn model_command_injection_and_fabricated_evidence_fall_back() {
    let gateway = ModelGateway::with_provider(Arc::new(BadModel));
    let r = gateway
        .assist_interview(InterviewRequest {
            symptom: "黑屏".into(),
            category: Category::GamingDisplay,
            context: InterviewContext::default(),
            allow_model: true,
        })
        .unwrap();
    assert_eq!(r.origin, "local_rules");
    let r = sentinel_core::rules::analyze_evidence(vec![], vec![], START, END, vec![]).unwrap();
    assert_eq!(gateway.explain_report(&r, vec![]).origin, "local_rules");
}
#[test]
fn rejected_import_leaves_no_attachment_or_reference() {
    let mut d = Disk::new();
    let s = d.store();
    let c = s.create(input(Category::StorageIo)).unwrap();
    assert!(
        s.import_bytes(&c.id, ReportFormat::SmartctlJson, b"not-json")
            .is_err()
    );
    assert!(s.list_artifacts(&c.id).unwrap().is_empty());
}
#[test]
fn restart_invalidates_v2_approval_without_losing_completed_run_history() {
    let mut d = Disk::new();
    let c = d.store().create(input(Category::RestartBsod)).unwrap();
    let c = d.store().build_plan(&c.id).unwrap();
    let p = c.plan.unwrap();
    let consent = d
        .store()
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    drop(d.store.take());
    d.store = Some(Store::open(&d.root.join("metadata.sqlite")).unwrap());
    assert_eq!(d.store().get(&c.id).unwrap().status, "interrupted");
    assert!(
        d.store()
            .begin_native_run(StartRequest {
                case_id: c.id,
                plan_id: p.id,
                plan_hash: p.hash,
                consent_token: consent.token
            })
            .is_err()
    );
}

#[test]
fn real_timeline_requires_same_known_boot_and_entity() {
    let mut a = event("app", "Application Error", "Application", 1000);
    a.entity = Some("same-app".into());
    let mut b = event("wer", "Windows Error Reporting", "Application", 1001);
    b.entity = a.entity.clone();
    b.observed_at_utc = Some("2026-11-12T02:03:30Z".into());
    let analyze = |a: Evidence, b: Evidence| {
        sentinel_core::rules::analyze_evidence(vec![a, b], vec![], START, END, vec![]).unwrap()
    };
    assert!(
        analyze(a.clone(), b.clone())
            .findings
            .iter()
            .any(|f| f.rule_id == "TIMELINE-APP-001")
    );
    b.boot_session = None;
    assert!(
        !analyze(a.clone(), b.clone())
            .findings
            .iter()
            .any(|f| f.rule_id == "TIMELINE-APP-001")
    );
    b.boot_session = a.boot_session.clone();
    b.entity = Some("another-app".into());
    assert!(
        !analyze(a, b)
            .findings
            .iter()
            .any(|f| f.rule_id == "TIMELINE-APP-001")
    );
}
struct CountingModel(std::sync::atomic::AtomicUsize);
impl ModelProvider for CountingModel {
    fn interview(&self, _: InterviewRequest) -> sentinel_core::Result<Vec<Question>> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(vec![Question {
            id: "when".into(),
            prompt: "什么时候发生的？".into(),
        }])
    }
    fn explain(&self, r: Report, _: Vec<String>) -> sentinel_core::Result<Explanation> {
        let mut e = local_explanation(&r.findings);
        e.suggested_action_ids = vec!["unregistered.action".into()];
        Ok(e)
    }
}
#[test]
fn configured_model_still_requires_explicit_interview_consent_and_action_whitelist() {
    let model = Arc::new(CountingModel(std::sync::atomic::AtomicUsize::new(0)));
    let gateway = ModelGateway::with_provider(model.clone());
    let mut request = InterviewRequest {
        symptom: "黑屏".into(),
        category: Category::GamingDisplay,
        context: InterviewContext::default(),
        allow_model: false,
    };
    assert_eq!(
        gateway.assist_interview(request.clone()).unwrap().origin,
        "local_rules"
    );
    assert_eq!(model.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    request.allow_model = true;
    assert_eq!(gateway.assist_interview(request).unwrap().origin, "model");
    let r = sentinel_core::rules::analyze_evidence(vec![], vec![], START, END, vec![]).unwrap();
    assert_eq!(
        gateway
            .explain_report(&r, vec!["windows.event_window".into()])
            .origin,
        "local_rules"
    );
}
#[test]
fn orphan_artifacts_are_cleaned_but_committed_originals_survive_restart() {
    let mut disk = Disk::new();
    let c = disk.store().create(input(Category::StorageIo)).unwrap();
    disk.store()
        .import_bytes(&c.id, ReportFormat::SmartctlJson, ATA)
        .unwrap();
    let artifact = disk.store().list_artifacts(&c.id).unwrap()[0].clone();
    let root = disk.root.join("metadata.artifacts").join(&c.id);
    let orphan = root.join(format!("{}.bin", uuid::Uuid::new_v4()));
    let temp = root.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&orphan, b"synthetic orphan").unwrap();
    std::fs::write(&temp, b"synthetic partial").unwrap();
    drop(disk.store.take());
    disk.store = Some(Store::open(&disk.root.join("metadata.sqlite")).unwrap());
    assert!(!orphan.exists());
    assert!(!temp.exists());
    assert!(root.join(format!("{}.bin", artifact.id)).exists());
    assert_eq!(disk.store().list_artifacts(&c.id).unwrap().len(), 1);
}
#[cfg(windows)]
#[test]
fn concurrent_app_instances_cannot_invalidate_each_others_consents() {
    let disk = Disk::new();
    assert!(Store::open(&disk.root.join("metadata.sqlite")).is_err());
}
#[cfg(windows)]
#[test]
fn import_rejects_network_and_alternate_stream_paths_before_reading() {
    use sentinel_core::artifacts::checked_local_path;
    assert!(checked_local_path(std::path::Path::new(r"\\server\share\report.txt")).is_err());
    assert!(checked_local_path(std::path::Path::new(r"C:\report.txt:secret")).is_err());
}
