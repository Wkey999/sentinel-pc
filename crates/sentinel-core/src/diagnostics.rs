//! v0.2 diagnostics and v0.3 setup audit. Legacy responses omit optional extensions.
use crate::domain::{Coverage, Evidence, Finding, Report};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    GamingDisplay,
    RestartBsod,
    StorageIo,
    OfficePeripheral,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseMode {
    #[default]
    Diagnostic,
    SetupAudit,
}
impl CaseMode {
    pub fn is_diagnostic(&self) -> bool {
        *self == Self::Diagnostic
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupAuditRequest {
    pub display_timezone: String,
    pub environment: String,
}
impl Default for SetupAuditRequest {
    fn default() -> Self {
        Self {
            display_timezone: "Asia/Hong_Kong".into(),
            environment: "personal".into(),
        }
    }
}
pub const AUDIT_ACTION_IDS: [&str; 6] = [
    "audit.display_routing",
    "audit.refresh_rate",
    "audit.memory_configuration",
    "audit.power_game_settings",
    "audit.pcie_disk_capacity",
    "audit.thermal_power_limits",
];
pub fn setup_audit_actions() -> Vec<ActionSpec> {
    let descriptions = [
        "读取活动显示路径与集显/独显归属，不修改输出",
        "读取当前刷新率和可识别 EDID/驱动模式",
        "读取内存配置速率与插槽声明；未知档位/通道明确标注",
        "读取系统电源计划与游戏开关配置，不修改设置",
        "读取实际系统卷余量；PCIe 链路当前无可靠实现，明确未知",
        "标明热/功耗传感器来源缺口；不启动外部工具或压力负载",
    ];
    AUDIT_ACTION_IDS
        .iter()
        .zip(descriptions)
        .map(|(id, description)| ActionSpec {
            action_id: (*id).into(),
            description: description.into(),
            risk: "R0".into(),
            estimated_seconds: 30,
            output_limit_bytes: 2 * 1024 * 1024,
            requires_external_confirmation: false,
            tool_token: None,
            device_token: None,
        })
        .collect()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditCheckResult {
    pub check_id: String,
    pub metric: String,
    pub object_id: Option<String>,
    /// opportunity / no_issue_observed / unknown / not_applicable; never a hardware health verdict.
    pub assessment: String,
    pub evidence_ids: Vec<String>,
    pub summary: String,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterviewContext {
    pub frequency: String,
    pub recent_changes: String,
    pub reproduction: String,
    pub answers: Vec<InterviewAnswer>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterviewAnswer {
    pub question_id: String,
    pub answer: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question {
    pub id: String,
    pub prompt: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterviewRequest {
    pub symptom: String,
    pub category: Category,
    #[serde(default)]
    pub context: InterviewContext,
    #[serde(default)]
    pub allow_model: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterviewResult {
    pub origin: String,
    pub questions: Vec<Question>,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionId {
    WindowsSystemSnapshot,
    WindowsEventWindow,
    UsbPnpSnapshot,
    StorageSmartctlRead,
}
impl ActionId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WindowsSystemSnapshot => "windows.system_snapshot",
            Self::WindowsEventWindow => "windows.event_window",
            Self::UsbPnpSnapshot => "usb_pnp.snapshot",
            Self::StorageSmartctlRead => "storage.smartctl_read",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionSpec {
    pub action_id: String,
    pub description: String,
    pub risk: String,
    pub estimated_seconds: u32,
    pub output_limit_bytes: usize,
    pub requires_external_confirmation: bool,
    pub tool_token: Option<String>,
    pub device_token: Option<String>,
}
pub fn native_actions(category: Category) -> Vec<ActionSpec> {
    let mut a = vec![
        ActionSpec {
            action_id: "windows.system_snapshot".into(),
            description: "读取系统、CPU、内存和显示设备概况".into(),
            risk: "R0".into(),
            estimated_seconds: 30,
            output_limit_bytes: 2 * 1024 * 1024,
            requires_external_confirmation: false,
            tool_token: None,
            device_token: None,
        },
        ActionSpec {
            action_id: "windows.event_window".into(),
            description: "读取已确认时间窗口的系统、应用及设备事件；不清除日志".into(),
            risk: "R1".into(),
            estimated_seconds: 60,
            output_limit_bytes: 10 * 1024 * 1024,
            requires_external_confirmation: false,
            tool_token: None,
            device_token: None,
        },
    ];
    if category == Category::OfficePeripheral {
        a.push(ActionSpec {
            action_id: "usb_pnp.snapshot".into(),
            description: "读取当前 PnP 设备状态；不禁用或重启设备".into(),
            risk: "R0".into(),
            estimated_seconds: 30,
            output_limit_bytes: 2 * 1024 * 1024,
            requires_external_confirmation: false,
            tool_token: None,
            device_token: None,
        });
    }
    a
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskResult {
    pub action_id: String,
    pub status: String,
    pub detail: String,
    pub exit_code: Option<i32>,
    pub artifact_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recommendation {
    pub priority: u32,
    pub instruction: String,
    pub expected_result: String,
    pub stop_condition: String,
    pub evidence_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Explanation {
    pub origin: String,
    pub summary: String,
    pub exclusions: Vec<String>,
    pub recommendations: Vec<Recommendation>,
    pub fallback_reason: Option<String>,
    #[serde(default)]
    pub suggested_action_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comparison {
    pub previous_run_id: String,
    pub new_rule_ids: Vec<String>,
    pub absent_rule_ids: Vec<String>,
    pub comparable: bool,
    pub limitations: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticRun {
    pub id: String,
    pub status: String,
    pub changed_variable: Option<String>,
    pub user_feedback: Option<String>,
    pub created_at_utc: String,
    #[serde(default)]
    pub incident_start_utc: String,
    #[serde(default)]
    pub incident_end_utc: String,
    pub tasks: Vec<TaskResult>,
    pub imported_evidence: Vec<Evidence>,
    pub import_coverage: Vec<Coverage>,
    pub warnings: Vec<String>,
    pub report: Option<Report>,
    pub explanation: Option<Explanation>,
    pub comparison: Option<Comparison>,
}
impl DiagnosticRun {
    pub fn new(changed_variable: Option<String>, user_feedback: Option<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            status: "draft".into(),
            changed_variable,
            user_feedback,
            created_at_utc: chrono::Utc::now().to_rfc3339(),
            incident_start_utc: String::new(),
            incident_end_utc: String::new(),
            tasks: vec![],
            imported_evidence: vec![],
            import_coverage: vec![],
            warnings: vec![],
            report: None,
            explanation: None,
            comparison: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticContext {
    #[serde(default, skip_serializing_if = "CaseMode::is_diagnostic")]
    pub mode: CaseMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<Category>,
    pub interview: InterviewContext,
    pub runs: Vec<DiagnosticRun>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetestRequest {
    pub case_id: String,
    pub changed_variable: String,
    pub user_feedback: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRequest {
    pub case_id: String,
    pub run_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplainRequest {
    pub case_id: String,
    #[serde(default)]
    pub allow_model: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRequest {
    pub case_id: String,
    pub format: crate::parsers::ReportFormat,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProbeRequest {
    pub toolbox_directory: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceProbeRequest {
    pub tool_token: String,
    pub confirmed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolPlanRequest {
    pub case_id: String,
    pub tool_token: String,
    pub device_token: String,
}

pub fn compare(previous: &DiagnosticRun, current: &DiagnosticRun) -> Comparison {
    let ids = |r: &DiagnosticRun| -> std::collections::BTreeSet<String> {
        r.report
            .as_ref()
            .map(|p| p.findings.iter().map(|f| f.rule_id.clone()).collect())
            .unwrap_or_default()
    };
    let a = ids(previous);
    let b = ids(current);
    let comparable = match (&previous.report, &current.report) {
        (Some(a), Some(b)) => {
            a.provenance == b.provenance
                && a.rule_version == b.rule_version
                && previous.status == "completed"
                && current.status == "completed"
                && !a.coverage.is_empty()
                && a.coverage
                    .iter()
                    .all(|c| ["available", "empty"].contains(&c.status.as_str()))
                && a.coverage
                    .iter()
                    .map(|c| &c.source)
                    .collect::<std::collections::BTreeSet<_>>()
                    == b.coverage.iter().map(|c| &c.source).collect()
        }
        _ => false,
    };
    Comparison {
        previous_run_id: previous.id.clone(),
        new_rule_ids: b.difference(&a).cloned().collect(),
        absent_rule_ids: a.difference(&b).cloned().collect(),
        comparable,
        limitations: vec![
            "规则出现或未出现不等于硬件改善或故障已排除；需结合采集覆盖、时间窗口与用户反馈。"
                .into(),
            "更换变量由用户声明；系统未核实实际操作，不能据此证明因果。".into(),
        ],
    }
}
pub fn local_explanation(findings: &[Finding]) -> Explanation {
    let mut sorted: Vec<_> = findings.iter().collect();
    sorted.sort_by_key(|f| if f.rule_id == "STORAGE-001" { 0 } else { 1 });
    let mut explanation = Explanation {
        origin: "local_rules".into(),
        summary: "以下是记录中的观察与排查顺序，不是唯一根因诊断。".into(),
        exclusions: vec!["现有证据不足以排除未覆盖的硬件、驱动和软件因素。".into()],
        recommendations: sorted
            .into_iter()
            .take(8)
            .enumerate()
            .map(|(i, f)| Recommendation {
                priority: i as u32 + 1,
                instruction: f.next_step.clone(),
                expected_result: "记录是否复现、发生时间和新提示；只改变一个变量后发起复测。"
                    .into(),
                stop_condition: "出现数据丢失、持续掉盘或系统不稳定时停止复现，先保存资料。".into(),
                evidence_ids: f.evidence_ids.clone(),
            })
            .collect(),
        fallback_reason: Some("模型未配置或不可用，使用本地规则。".into()),
        suggested_action_ids: vec![],
    };
    if explanation.recommendations.is_empty() {
        explanation.recommendations.push(Recommendation {
            priority: 1,
            instruction:
                "补充准确的发生时间、复现步骤和近期变更；核对覆盖缺口，必要时手动导入受支持报告。"
                    .into(),
            expected_result: "得到同一问题的可追溯记录；没有匹配事件不代表故障已排除。".into(),
            stop_condition: "不要为凑证据反复复现严重故障；先保存资料。".into(),
            evidence_ids: vec![],
        });
    }
    explanation
}
pub fn report_explanation(report: &Report) -> Explanation {
    let mut e = local_explanation(&report.findings);
    if !report.audit_checks.is_empty() {
        e.summary = format!(
            "本轮体检有 {} 项设置线索、{} 项无法确认；未观察到问题不等于硬件全部正常。",
            report
                .audit_checks
                .iter()
                .filter(|c| c.assessment == "opportunity")
                .count(),
            report
                .audit_checks
                .iter()
                .filter(|c| c.assessment == "unknown")
                .count()
        );
        if report.findings.is_empty() {
            e.recommendations[0].instruction="查看每组证据和未知项；需要补证时手动核对主板/显示器规格或导入受支持报告，改动一项后再体检。".into();
            e.recommendations[0].expected_result =
                "获得可比较的设置与数值记录；未知项保持可见。".into();
        }
    }
    e
}
