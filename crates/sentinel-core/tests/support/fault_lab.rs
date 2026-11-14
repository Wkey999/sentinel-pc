//! Synthetic fault replay. Uses real Store/rules/parsers, never collectors or the user's database.
use sentinel_core::{
    Store,
    diagnostics::*,
    domain::*,
    parsers::{self, ReportFormat},
    rules,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

pub const START: &str = "2026-11-14T01:00:00Z";
pub const END: &str = "2026-11-14T02:00:00Z";
pub struct Trial {
    pub id: &'static str,
    pub category: Category,
    pub title: &'static str,
    pub evidence: Vec<Evidence>,
    pub coverage_status: &'static str,
    pub expected: Vec<&'static str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    pub id: String,
    pub category: Category,
    pub title: String,
    pub expected_rule_ids: Vec<String>,
    pub draft: CaseRecord,
    pub planned: CaseRecord,
    pub collecting: CaseRecord,
    pub completed: CaseRecord,
}
pub fn event(id: &str, provider: &str, channel: &str, code: u32) -> Evidence {
    Evidence {
        id: id.into(),
        kind: "windows.event".into(),
        source: "fixture:windows".into(),
        observed_at_utc: Some("2026-11-14T01:30:00Z".into()),
        provider: Some(provider.into()),
        channel: Some(channel.into()),
        event_id: Some(code),
        schema_version: Some(0),
        record_id: Some(1),
        entity: Some("SYNTHETIC.exe".into()),
        boot_session: Some("fixture-boot".into()),
        fields: BTreeMap::from([("measurementOrigin".into(), "native_collected".into())]),
    }
}
fn trial(
    id: &'static str,
    category: Category,
    title: &'static str,
    evidence: Vec<Evidence>,
    expected: Vec<&'static str>,
) -> Trial {
    Trial {
        id,
        category,
        title,
        evidence,
        expected,
        coverage_status: "available",
    }
}
pub fn trials() -> Vec<Trial> {
    use Category::*;
    let mut wer = event("wer", "Windows Error Reporting", "Application", 1001);
    wer.observed_at_utc = Some("2026-11-14T01:30:30Z".into());
    let mut pnp = event("pnp-device", "unused", "unused", 0);
    pnp.kind = "device.snapshot".into();
    pnp.fields
        .insert("configManagerErrorCode".into(), "43".into());
    let ata = parsers::parse_report(
        ReportFormat::SmartctlJson,
        include_bytes!("../../../../tests/fixtures/reports/smartctl-ata-alert.json"),
    )
    .unwrap();
    let healthy = parsers::parse_report(
        ReportFormat::SmartctlJson,
        include_bytes!("../../../../tests/fixtures/reports/smartctl-nvme.json"),
    )
    .unwrap();
    let mut v = vec![
        trial(
            "gaming_display",
            GamingDisplay,
            "游戏黑屏后闪退：TDR + 应用崩溃 + WER",
            vec![
                event("tdr", "Display", "System", 4101),
                event("app", "Application Error", "Application", 1000),
                wer,
            ],
            vec!["WIN-DISPLAY-001", "WIN-APP-001", "TIMELINE-APP-001"],
        ),
        trial(
            "restart_bsod",
            RestartBsod,
            "蓝屏后重启：BugCheck + Kernel-Power 41",
            vec![
                event("kp41", "Microsoft-Windows-Kernel-Power", "System", 41),
                event(
                    "bugcheck",
                    "Microsoft-Windows-WER-SystemErrorReporting",
                    "System",
                    1001,
                ),
            ],
            vec!["WIN-RESTART-001", "WIN-RESTART-001"],
        ),
        trial(
            "storage_io",
            StorageIo,
            "磁盘健康告警：解析 smartctl ATA 样本",
            ata.evidence,
            vec!["STORAGE-001"],
        ),
        trial(
            "office_peripheral",
            OfficePeripheral,
            "办公无响应与设备错误码：不能直接认定物理断连",
            vec![
                event("hang", "Application Hang", "Application", 1002),
                pnp.clone(),
            ],
            vec!["WIN-APP-002", "WIN-USB-001"],
        ),
        trial(
            "fps_without_telemetry",
            GamingDisplay,
            "只有掉帧描述，没有帧时间或传感器证据",
            vec![],
            vec![],
        ),
        trial(
            "restart_41_only",
            RestartBsod,
            "只有 41，不推断电源损坏",
            vec![event(
                "kp41-only",
                "Microsoft-Windows-Kernel-Power",
                "System",
                41,
            )],
            vec!["WIN-RESTART-001"],
        ),
        trial(
            "whea",
            RestartBsod,
            "WHEA 事件，不定位到具体零件",
            vec![event("whea", "Microsoft-Windows-WHEA-Logger", "System", 18)],
            vec!["WIN-HW-001"],
        ),
        trial(
            "storage_healthy_declaration",
            StorageIo,
            "SMART 声明正常，不排除所有磁盘问题",
            healthy.evidence,
            vec![],
        ),
        trial(
            "storage_drop_without_rule",
            StorageIo,
            "Disk 157 掉盘事件：当前没有专用诊断规则",
            vec![event("disk157", "disk", "System", 157)],
            vec![],
        ),
        trial(
            "usb_driver_event",
            OfficePeripheral,
            "用户模式驱动事件 10111",
            vec![event(
                "usb10111",
                "Microsoft-Windows-DriverFrameworks-UserMode",
                "Microsoft-Windows-DriverFrameworks-UserMode/Operational",
                10111,
            )],
            vec!["WIN-USB-001"],
        ),
    ];
    pnp.fields
        .insert("configManagerErrorCode".into(), "0".into());
    v.push(trial(
        "usb_current_normal",
        OfficePeripheral,
        "当前 PnP 正常，不能排除历史断连",
        vec![pnp],
        vec![],
    ));
    let mut old = event("old", "Display", "System", 4101);
    old.observed_at_utc = Some("2026-11-13T01:30:00Z".into());
    v.push(trial(
        "outside_window",
        GamingDisplay,
        "窗口外 TDR 不参与结论",
        vec![old],
        vec![],
    ));
    v.push(trial(
        "wrong_provider",
        GamingDisplay,
        "同事件号但错误 Provider 不匹配",
        vec![event("fake", "Not-Display", "System", 4101)],
        vec![],
    ));
    for (id, category, title, status) in [
        (
            "access_denied",
            RestartBsod,
            "拒绝访问保留缺口",
            "permission_denied",
        ),
        ("timeout", StorageIo, "采集超时保留缺口", "timed_out"),
        (
            "empty_logs",
            OfficePeripheral,
            "空日志不等于没有故障",
            "empty",
        ),
        (
            "cancelled",
            GamingDisplay,
            "取消不显示检查通过",
            "cancelled",
        ),
    ] {
        let mut t = trial(id, category, title, vec![], vec![]);
        t.coverage_status = status;
        v.push(t);
    }
    v
}
pub fn replay(t: Trial) -> Replay {
    let mut store = Store::memory().unwrap();
    let draft = store
        .create(CreateCase {
            scenario_id: String::new(),
            symptom: format!("【合成测试】{}", t.title),
            incident_start_utc: START.into(),
            incident_end_utc: END.into(),
            display_timezone: "Asia/Hong_Kong".into(),
            environment: "personal".into(),
            category: Some(t.category),
            interview: Some(InterviewContext::default()),
        })
        .unwrap();
    assert_eq!(
        draft.diagnostic.as_ref().unwrap().category,
        Some(t.category)
    );
    let planned = store.build_plan(&draft.id).unwrap();
    let plan = planned.plan.as_ref().unwrap();
    assert!(!plan.action_ids.iter().any(|id| id.starts_with("demo.")));
    assert_eq!(
        plan.actions.len(),
        if t.category == Category::OfficePeripheral {
            3
        } else {
            2
        }
    );
    let consent = store
        .approve(ApproveRequest {
            case_id: draft.id.clone(),
            plan_id: plan.id.clone(),
            plan_hash: plan.hash.clone(),
        })
        .unwrap();
    let request = StartRequest {
        case_id: draft.id.clone(),
        plan_id: plan.id.clone(),
        plan_hash: plan.hash.clone(),
        consent_token: consent.token,
    };
    let begin = store.begin_native_run(request.clone()).unwrap();
    assert!(store.begin_native_run(request).unwrap().work.is_none());
    let work = begin.work.unwrap();
    let coverage = work
        .actions
        .iter()
        .map(|a| Coverage {
            source: a.action_id.clone(),
            status: t.coverage_status.into(),
            detail: "合成回放：未运行 Windows 采集器。".into(),
        })
        .collect();
    let mut report = rules::analyze_evidence(
        t.evidence,
        coverage,
        START,
        END,
        vec!["合成故障样本，不是本机诊断。".into()],
    )
    .unwrap();
    let actual: Vec<_> = report.findings.iter().map(|f| f.rule_id.as_str()).collect();
    let mut expected = t.expected.clone();
    expected.sort();
    let mut sorted = actual.clone();
    sorted.sort();
    assert_eq!(sorted, expected, "{}", t.id);
    let ids: BTreeSet<_> = report.evidence.iter().map(|e| &e.id).collect();
    assert!(report.findings.iter().all(|f| !f.evidence_ids.is_empty()
        && !f.limitations.is_empty()
        && f.evidence_ids.iter().all(|id| ids.contains(id))));
    if t.expected.is_empty() {
        assert!(report.unknowns.iter().any(|s| s.contains("不代表电脑正常")));
    }
    // Exercise native-only rule branches above, then label all saved/displayed output synthetic.
    report.provenance = "synthetic".into();
    for e in &mut report.evidence {
        e.source = "fixture:fault-lab".into();
        e.fields
            .insert("measurementOrigin".into(), "synthetic_fixture".into());
    }
    let tasks = work
        .actions
        .iter()
        .map(|a| TaskResult {
            action_id: a.action_id.clone(),
            status: if t.coverage_status == "cancelled" {
                "cancelled"
            } else if ["available", "empty"].contains(&t.coverage_status) {
                "completed"
            } else {
                "completed_partial"
            }
            .into(),
            detail: "合成回放，未启动采集进程。".into(),
            exit_code: None,
            artifact_id: None,
        })
        .collect();
    let completed = store
        .finish_native_run(
            &draft.id,
            &work.run_id,
            report,
            tasks,
            t.coverage_status == "cancelled",
        )
        .unwrap();
    assert_eq!(
        completed.status,
        if t.coverage_status == "cancelled" {
            "cancelled"
        } else if ["available", "empty"].contains(&t.coverage_status) {
            "completed"
        } else {
            "completed_partial"
        }
    );
    assert!(
        completed
            .diagnostic
            .as_ref()
            .unwrap()
            .runs
            .last()
            .unwrap()
            .explanation
            .is_some()
    );
    for format in ["json", "markdown"] {
        let export = store
            .export(ExportRequest {
                case_id: draft.id.clone(),
                format: format.into(),
            })
            .unwrap();
        assert!(!export.content.is_empty());
        assert!(!export.content.contains("SYNTHETIC-ATA-001"));
    }
    store
        .rename_case(&draft.id, "【合成】可重命名案例")
        .unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
    store.delete(&draft.id).unwrap();
    assert!(store.get(&draft.id).is_err());
    assert!(store.list().unwrap().is_empty());
    Replay {
        id: t.id.into(),
        category: t.category,
        title: t.title.into(),
        expected_rule_ids: t.expected.iter().map(|s| (*s).into()).collect(),
        draft,
        planned,
        collecting: begin.record,
        completed,
    }
}
