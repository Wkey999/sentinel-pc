use sentinel_core::{
    Store, diagnostics::*, domain::*, execution, rules, runner::Cancellation, tools::ToolRegistry,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
const START: &str = "2026-11-13T01:00:00Z";
const END: &str = "2026-11-13T02:00:00Z";
fn evidence(id: &str, kind: &str, fields: &[(&str, &str)]) -> Evidence {
    let mut fields: BTreeMap<String, String> = fields
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    fields.insert("measurementOrigin".into(), "native_collected".into());
    Evidence {
        id: id.into(),
        kind: kind.into(),
        source: "windows:local".into(),
        observed_at_utc: Some(START.into()),
        provider: None,
        channel: None,
        event_id: None,
        schema_version: None,
        record_id: None,
        entity: Some(id.into()),
        boot_session: None,
        fields,
    }
}
fn analyze(e: Vec<Evidence>) -> Report {
    rules::analyze_evidence(
        e,
        vec![Coverage {
            source: "audit.test".into(),
            status: "available".into(),
            detail: "synthetic fixture; not this PC".into(),
        }],
        START,
        END,
        vec![],
    )
    .unwrap()
}
fn state<'a>(r: &'a Report, metric: &str) -> &'a str {
    &r.audit_checks
        .iter()
        .find(|c| c.metric == metric)
        .unwrap()
        .assessment
}
fn display(role: &str, session: &str, tech: &str) -> Evidence {
    evidence(
        "display",
        "setup.display",
        &[
            ("adapterRole", role),
            ("hasDiscreteAdapter", "true"),
            ("sessionKind", session),
            ("outputTechnology", tech),
            ("monitorKey", "screen-A"),
            ("width", "1920"),
            ("height", "1080"),
            ("currentRefreshHz", "59.94"),
        ],
    )
}
fn modes(key: &str, width: &str) -> Evidence {
    let mut e = evidence("modes", "setup.monitor_modes", &[("monitorKey", key)]);
    e.fields.insert(
        "edidModesJson".into(),
        format!(r#"[{{"width":{width},"height":1080,"hz":144.0}}]"#),
    );
    e
}

#[test]
fn external_integrated_output_is_a_conditional_hint_not_a_physical_misplug_diagnosis() {
    let r = analyze(vec![display("integrated", "local", "5")]);
    assert_eq!(state(&r, "output_adapter"), "opportunity");
    assert!(r.findings[0].observation.contains("若为台式机"));
    assert!(!r.findings[0].limitations.is_empty());
    assert_eq!(
        state(
            &analyze(vec![display("discrete", "local", "5")]),
            "output_adapter"
        ),
        "no_issue_observed"
    );
    for (role, session, tech) in [
        ("integrated", "local", "11"),
        ("integrated", "local", "16"),
        ("integrated", "remote", "5"),
        ("unknown", "local", "5"),
    ] {
        let r = analyze(vec![display(role, session, tech)]);
        assert_eq!(state(&r, "output_adapter"), "unknown");
        assert!(!r.findings.iter().any(|f| f.rule_id == "SETUP-DISPLAY-001"));
    }
}
#[test]
fn refresh_matches_screen_and_resolution_and_handles_5994_without_claiming_link_support() {
    let r = analyze(vec![
        display("discrete", "local", "5"),
        modes("screen-A", "1920"),
    ]);
    assert_eq!(state(&r, "refresh_rate"), "opportunity");
    let f = r
        .findings
        .iter()
        .find(|f| f.rule_id == "SETUP-REFRESH-001")
        .unwrap();
    assert_eq!(f.evidence_ids.len(), 2);
    for e in [modes("screen-B", "1920"), modes("screen-A", "3840")] {
        assert_eq!(
            state(
                &analyze(vec![display("discrete", "local", "5"), e]),
                "refresh_rate"
            ),
            "unknown"
        );
    }
    let mut m = modes("screen-A", "1920");
    m.fields.insert(
        "edidModesJson".into(),
        r#"[{"width":1920,"height":1080,"hz":60.0}]"#.into(),
    );
    assert_eq!(
        state(
            &analyze(vec![display("discrete", "local", "5"), m]),
            "refresh_rate"
        ),
        "no_issue_observed"
    );
    assert_eq!(
        state(
            &analyze(vec![
                display("discrete", "remote", "5"),
                modes("screen-A", "1920")
            ]),
            "refresh_rate"
        ),
        "unknown"
    );
}
#[test]
fn memory_does_not_infer_profile_or_channels_from_rate_rank_or_slot_count() {
    for (configured, reported, kind, expected) in [
        ("0", "3200", "26", "unknown"),
        ("2400", "2400", "26", "unknown"),
        ("4800", "4800", "34", "unknown"),
        ("2400", "3200", "26", "opportunity"),
        ("6000", "6000", "34", "no_issue_observed"),
    ] {
        let m = evidence(
            "module",
            "setup.memory",
            &[
                ("configuredClockSpeed", configured),
                ("reportedSpeed", reported),
                ("memoryType", kind),
                ("Rank", "2"),
                ("deviceLocator", "DIMM_A1"),
            ],
        );
        let r = analyze(vec![m.clone(), {
            let mut second = m;
            second.id = "module2".into();
            second
                .fields
                .insert("deviceLocator".into(), "DIMM_A2".into());
            second
        }]);
        assert_eq!(state(&r, "memory_speed"), expected);
        assert_eq!(state(&r, "xmp_expo_profile"), "unknown");
        assert_eq!(state(&r, "memory_channels"), "unknown");
    }
}
#[test]
fn power_classifies_only_known_guids_and_does_not_treat_balanced_as_failure() {
    for (guid, expected) in [
        ("a1841308-3541-4fab-bc81-f71556f20b4a", "opportunity"),
        ("381b4222-f694-41f0-9685-ff5bb260df2e", "no_issue_observed"),
        ("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "no_issue_observed"),
        ("custom", "unknown"),
    ] {
        let r = analyze(vec![evidence(
            "power",
            "setup.power",
            &[("schemeGuid", guid), ("hagsConfigured", "enabled")],
        )]);
        assert_eq!(state(&r, "power_scheme"), expected);
        assert_eq!(state(&r, "hags"), "unknown");
        assert_eq!(state(&r, "game_mode"), "unknown");
        assert!(
            r.audit_checks
                .iter()
                .find(|c| c.metric == "power_scheme")
                .unwrap()
                .summary
                .contains("不证明被策略锁定")
        );
    }
}
#[test]
fn system_disk_threshold_is_strictly_below_ten_percent_without_c_drive_assumption() {
    for (total, free, expected) in [
        ("1000", "99", "opportunity"),
        ("1000", "100", "no_issue_observed"),
        ("0", "0", "unknown"),
        ("100", "101", "unknown"),
        ("18446744073709551615", "1844674407370955161", "opportunity"),
    ] {
        let r = analyze(vec![evidence(
            "system-volume",
            "setup.disk_capacity",
            &[
                ("volumeRole", "system"),
                ("volume", "Z:"),
                ("totalBytes", total),
                ("freeBytes", free),
            ],
        )]);
        assert_eq!(state(&r, "system_disk_free"), expected);
    }
}
#[test]
fn missing_or_imported_measurements_cannot_produce_passes_or_thermal_diagnoses() {
    let mut fake = display("integrated", "local", "5");
    fake.source = "artifact:fixture".into();
    fake.fields.insert(
        "measurementOrigin".into(),
        "imported_report_declared".into(),
    );
    let r = analyze(vec![fake]);
    assert!(r.findings.is_empty());
    assert!(r.audit_checks.iter().all(|c| c.assessment == "unknown"));
    for id in AUDIT_ACTION_IDS {
        assert!(r.audit_checks.iter().any(|c| c.check_id == id));
    }
    assert_eq!(state(&r, "pcie_link"), "unknown");
    assert_eq!(state(&r, "thermal_power_limits"), "unknown");
}
#[test]
fn setup_has_no_interview_uses_one_consent_and_exports_cancelled_unknowns_and_retests() {
    let mut s = Store::memory().unwrap();
    let r: SetupAuditRequest = serde_json::from_str("{}").unwrap();
    let c = s.create_setup_audit(r).unwrap();
    assert!(c.symptom.is_empty());
    let d = c.diagnostic.as_ref().unwrap();
    assert_eq!(d.mode, CaseMode::SetupAudit);
    assert!(d.category.is_none());
    assert!(
        s.update_interview(&c.id, InterviewContext::default())
            .is_err()
    );
    assert!(s.set_run_window(&c.id, START.into(), END.into()).is_err());
    assert!(s.build_import_plan(&c.id).is_err());
    let p = s.build_plan(&c.id).unwrap().plan.unwrap();
    assert_eq!(p.action_ids, AUDIT_ACTION_IDS);
    assert!(
        p.actions
            .iter()
            .all(|a| a.risk == "R0" && a.tool_token.is_none() && !a.requires_external_confirmation)
    );
    let token = s
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    let req = StartRequest {
        case_id: c.id.clone(),
        plan_id: p.id,
        plan_hash: p.hash,
        consent_token: token.token,
    };
    let begin = s.begin_native_run(req.clone()).unwrap();
    assert!(s.begin_native_run(req).unwrap().work.is_none());
    let work = begin.work.unwrap();
    let cancel = Cancellation::default();
    cancel.cancel();
    let (report, tasks) = execution::execute(
        &work,
        &Arc::new(Mutex::new(ToolRegistry::default())),
        &cancel,
    )
    .unwrap();
    assert_eq!(tasks.len(), 6);
    assert!(tasks.iter().all(|t| t.status == "cancelled"));
    let c = s
        .finish_native_run(&c.id, &work.run_id, report, tasks, true)
        .unwrap();
    assert_eq!(c.status, "cancelled");
    assert!(
        c.report
            .as_ref()
            .unwrap()
            .audit_checks
            .iter()
            .all(|c| c.assessment == "unknown")
    );
    for format in ["json", "markdown"] {
        let output = s
            .export(ExportRequest {
                case_id: c.id.clone(),
                format: format.into(),
            })
            .unwrap();
        assert!(output.content.contains("audit.display_routing"));
        assert!(output.content.contains("unknown"));
    }
    let c = s
        .create_retest_run(RetestRequest {
            case_id: c.id.clone(),
            changed_variable: "仅改一个显示连接".into(),
            user_feedback: "待测".into(),
        })
        .unwrap();
    assert_eq!(c.diagnostic.as_ref().unwrap().runs.len(), 2);
    assert!(c.report.is_none());
    assert_eq!(s.build_plan(&c.id).unwrap().plan.unwrap().actions.len(), 6);
}
