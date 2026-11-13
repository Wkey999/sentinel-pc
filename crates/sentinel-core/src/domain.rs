use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub observed_at_utc: Option<String>,
    pub provider: Option<String>,
    pub channel: Option<String>,
    pub event_id: Option<u32>,
    pub schema_version: Option<u32>,
    pub record_id: Option<u64>,
    pub entity: Option<String>,
    pub boot_session: Option<String>,
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coverage {
    pub source: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub id: String,
    pub title: String,
    pub description: String,
    pub coverage: Vec<Coverage>,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleCatalog {
    pub schema_version: u32,
    pub provenance: String,
    pub scenarios: Vec<Scenario>,
}

pub fn catalog() -> SampleCatalog {
    serde_json::from_str(include_str!("../../../resources/samples.json"))
        .expect("bundled sample contract")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCase {
    #[serde(default)]
    pub scenario_id: String,
    pub symptom: String,
    pub incident_start_utc: String,
    pub incident_end_utc: String,
    pub display_timezone: String,
    pub environment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<crate::diagnostics::Category>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interview: Option<crate::diagnostics::InterviewContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub id: String,
    pub case_id: String,
    pub revision: u32,
    pub hash: String,
    pub action_ids: Vec<String>,
    pub data_scopes: Vec<String>,
    pub policy_version: String,
    pub adapter_version: String,
    pub scenario_id: String,
    pub incident_start_utc: String,
    pub incident_end_utc: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<crate::diagnostics::ActionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_hashes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_identity: Option<crate::tools::ToolCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finding {
    pub id: String,
    pub rule_id: String,
    pub title: String,
    pub observation: String,
    pub evidence_ids: Vec<String>,
    pub strength: String,
    pub limitations: Vec<String>,
    pub next_step: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub schema_version: u32,
    pub provenance: String,
    pub rule_version: String,
    pub generated_at_utc: String,
    pub findings: Vec<Finding>,
    pub evidence: Vec<Evidence>,
    pub coverage: Vec<Coverage>,
    pub unknowns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audit_checks: Vec<crate::diagnostics::AuditCheckResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseRecord {
    pub id: String,
    pub title: String,
    pub symptom: String,
    pub scenario_id: String,
    pub incident_start_utc: String,
    pub incident_end_utc: String,
    pub display_timezone: String,
    pub environment: String,
    pub created_at_utc: String,
    pub status: String,
    pub plan: Option<Plan>,
    pub report: Option<Report>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<crate::diagnostics::DiagnosticContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Consent {
    pub token: String,
    pub expires_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseRequest {
    pub case_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveRequest {
    pub case_id: String,
    pub plan_id: String,
    pub plan_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub case_id: String,
    pub plan_id: String,
    pub plan_hash: String,
    pub consent_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    pub case_id: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportResult {
    pub filename: String,
    pub media_type: String,
    pub content: String,
}
