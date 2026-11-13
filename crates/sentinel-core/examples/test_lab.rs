//! Development-only lab: synthetic evidence exercises real rules without changing Windows.
//! Run through scripts/test-lab.ps1. This example is not an IPC command or production switch.
use sentinel_core::{
    Store, diagnostics::*, domain::*, execution, rules, runner::Cancellation, tools::ToolRegistry,
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
};
const START: &str = "2026-11-13T01:00:00Z";
const END: &str = "2026-11-13T02:00:00Z";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Expectation {
    metric: String,
    assessment: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LabResult {
    id: String,
    title: String,
    data_origin: String,
    expectations: Vec<Expectation>,
    rules_passed: bool,
    failures: Vec<String>,
    record: CaseRecord,
}
struct Scenario {
    id: &'static str,
    title: &'static str,
    evidence: Vec<Evidence>,
    coverage_status: &'static str,
    expected: Vec<(&'static str, &'static str)>,
    cancelled: bool,
}
fn e(id: &str, kind: &str, fields: &[(&str, &str)]) -> Evidence {
    let mut fields: BTreeMap<String, String> = fields
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    // The native rule boundary is exercised with test input, then all output is relabelled synthetic.
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
fn display(role: &str, session: &str, tech: &str, hz: &str) -> Evidence {
    e(
        "screen-A",
        "setup.display",
        &[
            ("monitorKey", "fixture-screen-A"),
            ("adapterRole", role),
            ("hasDiscreteAdapter", "true"),
            ("sessionKind", session),
            ("outputTechnology", tech),
            ("width", "1920"),
            ("height", "1080"),
            ("currentRefreshHz", hz),
        ],
    )
}
fn modes(width: u32, hz: f64) -> Evidence {
    let mut m = e(
        "modes-A",
        "setup.monitor_modes",
        &[
            ("monitorKey", "fixture-screen-A"),
            ("edidParseState", "partial_detailed_timings_only"),
        ],
    );
    m.fields.insert(
        "edidModesJson".into(),
        serde_json::json!([{"width":width,"height":1080,"hz":hz}]).to_string(),
    );
    m
}
fn memory(configured: &str, reported: &str, kind: &str) -> Evidence {
    e(
        "memory-A",
        "setup.memory",
        &[
            ("configuredClockSpeed", configured),
            ("reportedSpeed", reported),
            ("memoryType", kind),
            ("speedUnit", "SMBIOS_reported_MHz"),
            ("deviceLocator", "DIMM_A1"),
            ("bankLabel", "BANK0"),
            ("Rank", "2"),
        ],
    )
}
fn power(guid: &str) -> Evidence {
    e(
        "power",
        "setup.power",
        &[
            ("schemeGuid", guid),
            ("hagsConfigured", "unknown"),
            ("gameModeConfigured", "unknown"),
        ],
    )
}
fn disk(free: &str, total: &str) -> Evidence {
    e(
        "system-volume-Z",
        "setup.disk_capacity",
        &[
            ("volumeRole", "system"),
            ("volume", "Z:"),
            ("totalBytes", total),
            ("freeBytes", free),
        ],
    )
}
fn scenario(
    id: &'static str,
    title: &'static str,
    evidence: Vec<Evidence>,
    metric: &'static str,
    expected: &'static str,
) -> Scenario {
    Scenario {
        id,
        title,
        evidence,
        coverage_status: "available",
        expected: vec![(metric, expected)],
        cancelled: false,
    }
}
fn scenarios() -> Vec<Scenario> {
    let mut v = vec![
        scenario(
            "desktop_igpu",
            "模拟台式机：有独显但屏幕走核显",
            vec![display("integrated", "local", "5", "60")],
            "output_adapter",
            "opportunity",
        ),
        scenario(
            "laptop_hybrid",
            "模拟笔记本混合显卡：内屏走核显",
            vec![display("integrated", "local", "11", "60")],
            "output_adapter",
            "unknown",
        ),
        scenario(
            "usb_dock",
            "模拟 USB/间接显示：不当成接错主板",
            vec![display("integrated", "local", "16", "60")],
            "output_adapter",
            "unknown",
        ),
        scenario(
            "remote_session",
            "模拟远程会话：不判断物理插线",
            vec![display("integrated", "remote", "5", "60")],
            "output_adapter",
            "unknown",
        ),
        scenario(
            "refresh_60_144",
            "模拟同分辨率：当前 60Hz / 声明 144Hz",
            vec![display("discrete", "local", "5", "60"), modes(1920, 144.0)],
            "refresh_rate",
            "opportunity",
        ),
        scenario(
            "refresh_5994_144",
            "模拟 59.94Hz：应能识别高刷核对场景",
            vec![
                display("discrete", "local", "5", "59.94"),
                modes(1920, 144.0),
            ],
            "refresh_rate",
            "opportunity",
        ),
        scenario(
            "refresh_144_144",
            "模拟当前已 144Hz：不重复提醒",
            vec![display("discrete", "local", "5", "144"), modes(1920, 144.0)],
            "refresh_rate",
            "no_issue_observed",
        ),
        scenario(
            "refresh_other_resolution",
            "模拟仅另一分辨率有高刷：不可直接比较",
            vec![display("discrete", "local", "5", "60"), modes(3840, 144.0)],
            "refresh_rate",
            "unknown",
        ),
        scenario(
            "refresh_missing_edid",
            "模拟 EDID/模式缺失：保持未知",
            vec![display("discrete", "local", "5", "60")],
            "refresh_rate",
            "unknown",
        ),
        scenario(
            "memory_slow",
            "模拟内存配置 2400 / 模块所报 3200",
            vec![memory("2400", "3200", "26")],
            "memory_speed",
            "opportunity",
        ),
        scenario(
            "memory_zero",
            "模拟内存速率为 0：不能当成正常",
            vec![memory("0", "3200", "26")],
            "memory_speed",
            "unknown",
        ),
        scenario(
            "ddr5_base",
            "模拟 DDR5 4800：不据此断定未开 EXPO",
            vec![memory("4800", "4800", "34")],
            "memory_speed",
            "unknown",
        ),
        scenario(
            "power_saver",
            "模拟节能计划：提醒但不说被策略锁定",
            vec![power("a1841308-3541-4fab-bc81-f71556f20b4a")],
            "power_scheme",
            "opportunity",
        ),
        scenario(
            "power_balanced",
            "模拟平衡计划：不当作性能故障",
            vec![power("381b4222-f694-41f0-9685-ff5bb260df2e")],
            "power_scheme",
            "no_issue_observed",
        ),
        scenario(
            "power_high",
            "模拟高性能计划",
            vec![power("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")],
            "power_scheme",
            "no_issue_observed",
        ),
        scenario(
            "power_custom",
            "模拟自定义计划：不按名称猜分类",
            vec![power("11111111-2222-3333-4444-555555555555")],
            "power_scheme",
            "unknown",
        ),
        scenario(
            "disk_9_percent",
            "模拟 Z 系统卷剩 9%：提醒空间",
            vec![disk("9000000000", "100000000000")],
            "system_disk_free",
            "opportunity",
        ),
        scenario(
            "disk_10_percent",
            "模拟系统卷恰好剩 10%：不命中低于阈值",
            vec![disk("10000000000", "100000000000")],
            "system_disk_free",
            "no_issue_observed",
        ),
        scenario(
            "disk_invalid",
            "模拟容量不可读：不当成磁盘满",
            vec![disk("0", "0")],
            "system_disk_free",
            "unknown",
        ),
    ];
    for (id, title, status) in [
        (
            "permission_denied",
            "模拟拒绝访问：不要求自动提权",
            "permission_denied",
        ),
        ("timed_out", "模拟采集超时：未知不等于通过", "timed_out"),
        ("collection_failed", "模拟采集失败：仍保留报告", "failed"),
        ("cancelled", "模拟取消：六组均显示未完成", "cancelled"),
    ] {
        v.push(Scenario {
            id,
            title,
            evidence: vec![],
            coverage_status: status,
            expected: vec![("thermal_power_limits", "unknown")],
            cancelled: status == "cancelled",
        });
    }
    // Multi-monitor correlation is tested in one report; evidence IDs and object keys remain distinct.
    let mut b = display("discrete", "local", "5", "144");
    b.id = "screen-B".into();
    b.entity = Some("screen-B".into());
    b.fields
        .insert("monitorKey".into(), "fixture-screen-B".into());
    let mut mb = modes(1920, 144.0);
    mb.id = "modes-B".into();
    mb.fields
        .insert("monitorKey".into(), "fixture-screen-B".into());
    v.push(scenario(
        "multi_monitor",
        "模拟双屏：只有 A 屏 60Hz，B 屏 144Hz",
        vec![
            display("discrete", "local", "5", "60"),
            modes(1920, 144.0),
            b,
            mb,
        ],
        "refresh_rate",
        "opportunity",
    ));
    v
}
fn start(store: &mut Store) -> sentinel_core::BeginRun {
    let c = store
        .create_setup_audit(SetupAuditRequest::default())
        .unwrap();
    let c = store.build_plan(&c.id).unwrap();
    let p = c.plan.unwrap();
    let token = store
        .approve(ApproveRequest {
            case_id: c.id.clone(),
            plan_id: p.id.clone(),
            plan_hash: p.hash.clone(),
        })
        .unwrap();
    store
        .begin_native_run(StartRequest {
            case_id: c.id,
            plan_id: p.id,
            plan_hash: p.hash,
            consent_token: token.token,
        })
        .unwrap()
}
fn write(path: &Path, value: impl Serialize) {
    std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}
fn main() {
    let mut args = std::env::args().skip(1);
    let directory = args.next().expect("output directory required");
    let live = args.any(|a| a == "--live");
    let root = Path::new(&directory);
    std::fs::create_dir_all(root).unwrap();
    let mut results = vec![];
    for s in scenarios() {
        let mut store = Store::memory().unwrap();
        let work = start(&mut store).work.unwrap();
        let mut report = if s.cancelled {
            let cancel = Cancellation::default();
            cancel.cancel();
            execution::execute(
                &work,
                &Arc::new(Mutex::new(ToolRegistry::default())),
                &cancel,
            )
            .unwrap()
            .0
        } else {
            rules::analyze_evidence(
                s.evidence,
                AUDIT_ACTION_IDS
                    .iter()
                    .map(|id| Coverage {
                        source: (*id).into(),
                        status: s.coverage_status.into(),
                        detail: "模拟覆盖状态；未查询或修改真实硬件".into(),
                    })
                    .collect(),
                START,
                END,
                vec!["合成场景：不是当前电脑的检测结果。".into()],
            )
            .unwrap()
        };
        let mut failures = vec![];
        for (metric, assessment) in &s.expected {
            if !report
                .audit_checks
                .iter()
                .any(|c| c.metric == *metric && c.assessment == *assessment)
            {
                failures.push(format!("{metric} should be {assessment}"));
            }
        }
        for metric in [
            "memory_channels",
            "xmp_expo_profile",
            "pcie_link",
            "thermal_power_limits",
        ] {
            if !report
                .audit_checks
                .iter()
                .any(|c| c.metric == metric && c.assessment == "unknown")
            {
                failures.push(format!("{metric}: must remain unknown"));
            }
        }
        if s.id == "multi_monitor" {
            let rates: Vec<_> = report
                .audit_checks
                .iter()
                .filter(|c| c.metric == "refresh_rate")
                .collect();
            if rates.len() != 2
                || rates
                    .iter()
                    .filter(|c| c.assessment == "opportunity")
                    .count()
                    != 1
            {
                failures.push("double monitor correlation failed".into());
            }
        }
        if !report.findings.iter().all(|f| {
            f.evidence_ids
                .iter()
                .all(|id| report.evidence.iter().any(|e| &e.id == id))
        }) {
            failures.push("invalid evidence references".into());
        }
        report.provenance = "synthetic".into();
        for e in &mut report.evidence {
            e.source = "fixture:windows:local".into();
            e.fields
                .insert("measurementOrigin".into(), "synthetic_fixture".into());
        }
        let tasks = AUDIT_ACTION_IDS
            .iter()
            .map(|id| TaskResult {
                action_id: (*id).into(),
                status: if s.cancelled {
                    "cancelled"
                } else if s.coverage_status == "available" {
                    "completed"
                } else {
                    "completed_partial"
                }
                .into(),
                detail: "仅回放合成输入，没有运行采集器。".into(),
                exit_code: None,
                artifact_id: None,
            })
            .collect();
        let mut record = store
            .finish_native_run(&work.record.id, &work.run_id, report, tasks, s.cancelled)
            .unwrap();
        let md = store
            .export(ExportRequest {
                case_id: record.id.clone(),
                format: "markdown".into(),
            })
            .unwrap();
        std::fs::write(root.join(format!("{}.md", s.id)), md.content).unwrap();
        record.title = format!("【模拟】{}", s.title);
        results.push(LabResult {
            id: s.id.into(),
            title: s.title.into(),
            data_origin: "synthetic_fixture".into(),
            expectations: s
                .expected
                .into_iter()
                .map(|(m, a)| Expectation {
                    metric: m.into(),
                    assessment: a.into(),
                })
                .collect(),
            rules_passed: failures.is_empty(),
            failures,
            record,
        });
    }
    write(&root.join("scenarios.json"), &results);
    println!(
        "Synthetic scenarios: {}/{} passed",
        results.iter().filter(|r| r.rules_passed).count(),
        results.len()
    );
    if live {
        let mut store = Store::memory().unwrap();
        let work = start(&mut store).work.unwrap();
        let (report, tasks) = execution::execute(
            &work,
            &Arc::new(Mutex::new(ToolRegistry::default())),
            &Cancellation::default(),
        )
        .unwrap();
        let record = store
            .finish_native_run(&work.record.id, &work.run_id, report, tasks, false)
            .unwrap();
        let json = store
            .export(ExportRequest {
                case_id: record.id.clone(),
                format: "json".into(),
            })
            .unwrap();
        let md = store
            .export(ExportRequest {
                case_id: record.id.clone(),
                format: "markdown".into(),
            })
            .unwrap();
        std::fs::write(root.join("live-report.json"), json.content).unwrap();
        std::fs::write(root.join("live-report.md"), md.content).unwrap();
        println!("Local read-only run: {}", record.status);
        // Store only the normal redacted export; no private raw report or production database is read.
    }
    if results.iter().any(|r| !r.rules_passed) {
        std::process::exit(1)
    }
}
