use sentinel_core::{
    parsers::{ParseStatus, ReportFormat, parse_report},
    rules,
};
fn parse(csv: &str) -> sentinel_core::parsers::ParseResult {
    parse_report(ReportFormat::HwinfoCsv, csv.as_bytes()).unwrap()
}
fn analyze(csv: &str) -> sentinel_core::domain::Report {
    let r = parse(csv);
    rules::analyze_evidence(
        r.evidence,
        vec![],
        "2026-11-14T00:00:00Z",
        "2026-11-14T01:00:00Z",
        r.warnings,
    )
    .unwrap()
}
#[test]
fn explicit_limit_flags_generate_imported_observations_and_keep_unknowns() {
    let report = analyze(
        "Date,Time,CPU Package [°C],Core Thermal Throttling [Yes/No]\n14.11.2026,08:00:00,75,No\n14.11.2026,08:00:01,90,Yes",
    );
    assert_eq!(report.provenance, "imported_report_declared");
    assert!(
        report
            .findings
            .iter()
            .any(|f| f.rule_id == "SENSOR-LIMIT-001")
    );
    assert!(
        report
            .audit_checks
            .iter()
            .any(|c| c.assessment == "opportunity" && c.summary.contains("1 次"))
    );
    assert!(
        report
            .audit_checks
            .iter()
            .any(|c| c.metric == "memory_channels" && c.assessment == "unknown")
    );
    assert!(report.evidence.iter().all(|e| e.observed_at_utc.is_none()));
}
#[test]
fn temperature_and_no_flags_never_prove_healthy_or_overheated() {
    for csv in [
        "Date,Time,CPU Package [°C]\n14.11.2026,08:00:00,110",
        "Date,Time,Core Thermal Throttling [Yes/No]\n14.11.2026,08:00:00,No",
    ] {
        let report = analyze(csv);
        assert!(report.findings.is_empty());
        assert!(
            report
                .audit_checks
                .iter()
                .all(|c| c.assessment == "unknown")
        );
    }
}
#[test]
fn quoted_decimal_comma_and_duplicate_columns_preserve_identity() {
    let r = parse(
        "\"Date\";\"Time\";\"GPU Temperature [°C]\";\"GPU Temperature [°C]\"\n14.11.2026;08:00:00;\"60,5\";\"75,2\"",
    );
    assert_eq!(r.evidence.len(), 2);
    assert_ne!(r.evidence[0].id, r.evidence[1].id);
    assert_eq!(r.evidence[0].fields["maximum"], "60.5");
    assert_eq!(r.evidence[1].fields["maximum"], "75.2");
}
#[test]
fn invalid_and_unsupported_values_are_not_successes() {
    let r = parse("Date,Time,Core Thermal Throttling [Yes/No]\n14.11.2026,08:00:00,N/A");
    assert!(matches!(r.status, ParseStatus::Unsupported));
    assert!(r.evidence.is_empty());
    let r = parse("Date,Time,Unknown Sensor\n14.11.2026,08:00:00,1");
    assert!(matches!(r.status, ParseStatus::Unsupported));
    assert!(
        parse_report(
            ReportFormat::HwinfoCsv,
            b"Date,Time,CPU Package [C]\n\"unclosed"
        )
        .is_ok()
    ); // Unsupported header is reported explicitly.
    assert!(parse_report(ReportFormat::HwinfoCsv, b"not-a-csv").is_err());
    let r = parse("Date,Time,CPU Package [°C]\n14.11.2026,08:00:00,NaN\n14.11.2026,08:00:01,70");
    assert!(matches!(r.status, ParseStatus::Partial));
    assert_eq!(r.evidence[0].fields["sampleCount"], "1");
}

#[test]
fn sensor_import_uses_only_selected_report_and_enters_saved_case_and_chat_context() {
    use sentinel_core::{
        Store, chat::ChatRequest, diagnostics::*, domain::*, execution, runner::Cancellation,
        tools::ToolRegistry,
    };
    use std::sync::{Arc, Mutex};
    let root = std::env::temp_dir().join(format!("sentinel-sensors-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    {
        let mut store = Store::open(&root.join("metadata.sqlite")).unwrap();
        let case = store
            .create(CreateCase {
                scenario_id: String::new(),
                symptom: "合成传感器导入".into(),
                category: Some(Category::GamingDisplay),
                interview: None,
                environment: "personal".into(),
                display_timezone: "UTC".into(),
                incident_start_utc: "2026-11-14T00:00:00Z".into(),
                incident_end_utc: "2026-11-14T01:00:00Z".into(),
            })
            .unwrap();
        let csv = "Date,Time,Core Thermal Throttling [Yes/No]\n14.11.2026,08:00:00,Yes";
        store
            .import_bytes(&case.id, ReportFormat::HwinfoCsv, csv.as_bytes())
            .unwrap();
        let planned = store.build_import_plan(&case.id).unwrap();
        let p = planned.plan.unwrap();
        assert_eq!(p.action_ids, vec!["report.import"]);
        let consent = store
            .approve(ApproveRequest {
                case_id: case.id.clone(),
                plan_id: p.id.clone(),
                plan_hash: p.hash.clone(),
            })
            .unwrap();
        let work = store
            .begin_native_run(StartRequest {
                case_id: case.id.clone(),
                plan_id: p.id,
                plan_hash: p.hash,
                consent_token: consent.token,
            })
            .unwrap()
            .work
            .unwrap();
        let (report, tasks) = execution::execute(
            &work,
            &Arc::new(Mutex::new(ToolRegistry::default())),
            &Cancellation::default(),
        )
        .unwrap();
        let saved = store
            .finish_native_run(&case.id, &work.run_id, report, tasks, false)
            .unwrap();
        assert!(
            saved
                .report
                .unwrap()
                .findings
                .iter()
                .any(|f| f.rule_id == "SENSOR-LIMIT-001")
        );
        assert!(
            store
                .export(ExportRequest {
                    case_id: case.id.clone(),
                    format: "json".into()
                })
                .unwrap()
                .content
                .contains("sensorLabel")
        );
        let r = ChatRequest {
            conversation_id: case.id.clone(),
            case_id: Some(case.id.clone()),
            message: "这条限制标志说明什么？".into(),
            hardware: None,
            allow_model: false,
        };
        let (_, input) = store.chat_input(&r).unwrap();
        assert!(input.context.to_string().contains("SENSOR-LIMIT-001"));
        store
            .save_chat_reply(
                &r,
                0,
                sentinel_core::chat::ChatMessage {
                    role: "assistant".into(),
                    origin: "unavailable".into(),
                    text: "未联网测试".into(),
                },
            )
            .unwrap();
        store.delete(&case.id).unwrap();
        assert!(store.get_chat(&case.id, Some(&case.id)).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}
