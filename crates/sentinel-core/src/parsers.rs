//! Pure, bounded report parsers. No file, process, network or model access.
//! Format support is a preview until legally sourced real reports are accepted.
use crate::domain::Evidence;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

pub const MAX_REPORT_BYTES: usize = 20 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 64;
const MAX_FIELD_BYTES: usize = 4096;
const MAX_DISKS: usize = 128;
const MAX_REPORT_LINES: usize = 100_000;
const MAX_JSON_TOKENS: usize = 200_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportFormat {
    SmartctlJson,
    CrystalDiskInfoText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParseStatus {
    Parsed,
    Partial,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParseResult {
    pub schema_version: u32,
    pub status: ParseStatus,
    pub parser_version: String,
    pub source_sha256: String,
    pub provenance: String,
    pub format_acceptance: String,
    pub declared_tool_version: Option<String>,
    pub encoding: String,
    pub evidence: Vec<Evidence>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ParseError {
    Empty,
    TooLarge,
    UnsupportedEncoding,
    InvalidText,
    TooDeep,
    InvalidJson,
    InvalidStructure,
    DuplicateField,
    TooManyDisks,
}

pub fn parse_report(format: ReportFormat, bytes: &[u8]) -> Result<ParseResult, ParseError> {
    if bytes.is_empty() {
        return Err(ParseError::Empty);
    }
    if bytes.len() > MAX_REPORT_BYTES {
        return Err(ParseError::TooLarge);
    }
    let (text, encoding) = decode(bytes, matches!(format, ReportFormat::CrystalDiskInfoText))?;
    if text.contains('\0') {
        return Err(ParseError::InvalidText);
    }
    let mut result = ParseResult {
        schema_version: 1,
        status: ParseStatus::Parsed,
        parser_version: "preview-0.2.0".into(),
        source_sha256: format!("{:x}", Sha256::digest(bytes)),
        provenance: "imported_report_declared".into(),
        format_acceptance: "synthetic_only".into(),
        declared_tool_version: None,
        encoding,
        evidence: vec![],
        warnings: vec![],
    };
    match format {
        ReportFormat::SmartctlJson => smartctl(&text, &mut result)?,
        ReportFormat::CrystalDiskInfoText => cdi(&text, &mut result)?,
    }
    Ok(result)
}

fn decode(bytes: &[u8], allow_utf16: bool) -> Result<(String, String), ParseError> {
    if let Some(raw) = bytes
        .strip_prefix(&[0xff, 0xfe])
        .or_else(|| bytes.strip_prefix(&[0xfe, 0xff]))
    {
        if !allow_utf16 || raw.len() % 2 != 0 {
            return Err(ParseError::UnsupportedEncoding);
        }
        let little = bytes.starts_with(&[0xff, 0xfe]);
        let words: Vec<u16> = raw
            .chunks_exact(2)
            .map(|c| {
                if little {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        return Ok((
            String::from_utf16(&words).map_err(|_| ParseError::UnsupportedEncoding)?,
            if little { "utf-16le" } else { "utf-16be" }.into(),
        ));
    }
    let raw = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    Ok((
        std::str::from_utf8(raw)
            .map_err(|_| ParseError::UnsupportedEncoding)?
            .into(),
        "utf-8".into(),
    ))
}

fn evidence(result: &ParseResult, index: usize, locator: &str) -> Evidence {
    let short = &result.source_sha256[..16];
    let mut fields = BTreeMap::new();
    fields.insert("locator".into(), locator.into());
    fields.insert(
        "measurementOrigin".into(),
        "imported_report_declared".into(),
    );
    Evidence {
        id: format!("ev-import-{short}-{index}"),
        kind: "storage.health".into(),
        source: format!("sha256:{}", result.source_sha256),
        observed_at_utc: None,
        provider: None,
        channel: None,
        event_id: None,
        schema_version: None,
        record_id: None,
        entity: Some(format!("report-{short}-disk-{index}")),
        boot_session: None,
        fields,
    }
}
fn unsupported(result: &mut ParseResult, why: &str) {
    result.status = ParseStatus::Unsupported;
    result.warnings.push(why.into());
}
fn partial(result: &mut ParseResult, why: &str) {
    result.status = ParseStatus::Partial;
    result.warnings.push(why.into());
}
fn small_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= MAX_FIELD_BYTES)
        .map(str::to_owned)
}

fn json_depth(text: &str) -> Result<(), ParseError> {
    let (mut quoted, mut escaped, mut depth) = (false, false, 0usize);
    let mut tokens = 0usize;
    for c in text.chars() {
        if quoted {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                quoted = false;
            }
            continue;
        }
        if matches!(c, '{' | '[' | ',') {
            tokens += 1;
            if tokens > MAX_JSON_TOKENS {
                return Err(ParseError::InvalidStructure);
            }
        }
        match c {
            '"' => quoted = true,
            '{' | '[' => {
                depth += 1;
                if depth > MAX_JSON_DEPTH {
                    return Err(ParseError::TooDeep);
                }
            }
            '}' | ']' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
    Ok(())
}

// serde_json::Value normally accepts duplicate keys. Reject them recursively so
// conflicting health statements cannot silently overwrite one another.
struct UniqueJson(Value);
impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueJson;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON without duplicate keys")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Bool(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::from(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::from(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueJson(Value::Number(n)))
                    .ok_or_else(|| E::custom("invalid number"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v.into())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v)))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Null))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element::<UniqueJson>()? {
                    out.push(v.0);
                }
                Ok(UniqueJson(Value::Array(out)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut out = serde_json::Map::new();
                while let Some((key, value)) = map.next_entry::<String, UniqueJson>()? {
                    if out.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate field"));
                    }
                    out.insert(key, value.0);
                }
                Ok(UniqueJson(Value::Object(out)))
            }
        }
        de.deserialize_any(Visitor)
    }
}

fn smartctl(text: &str, result: &mut ParseResult) -> Result<(), ParseError> {
    json_depth(text)?;
    let root = serde_json::from_str::<UniqueJson>(text)
        .map_err(|_| ParseError::InvalidJson)?
        .0;
    if !root.is_object() {
        return Err(ParseError::InvalidStructure);
    }
    if root.get("json_format_version") != Some(&serde_json::json!([1, 0])) {
        unsupported(result, "unsupported_json_format_version");
        return Ok(());
    }
    let versions = root.pointer("/smartctl/version").and_then(Value::as_array);
    let Some(v) =
        versions.filter(|v| (2..=3).contains(&v.len()) && v.iter().all(|n| n.as_u64().is_some()))
    else {
        unsupported(result, "missing_tool_version");
        return Ok(());
    };
    result.declared_tool_version =
        Some(v.iter().map(Value::to_string).collect::<Vec<_>>().join("."));
    if v[0].as_u64() != Some(7) || !v[1].as_u64().is_some_and(|n| (2..=5).contains(&n)) {
        unsupported(result, "unsupported_tool_version");
        return Ok(());
    }
    let mut e = evidence(result, 1, "json:/");
    e.fields.insert("tool".into(), "smartctl".into());
    e.fields.insert(
        "toolVersionDeclared".into(),
        result.declared_tool_version.clone().unwrap(),
    );
    let model = small_string(root.get("model_name"))
        .or_else(|| small_string(root.get("scsi_model_name")))
        .or_else(|| small_string(root.get("scsi_product")));
    if let Some(m) = model {
        e.fields.insert("model".into(), m);
    } else {
        partial(result, "model_missing_or_invalid");
    }
    if let Some(s) = small_string(root.get("serial_number")) {
        e.fields.insert("serialNumber".into(), s);
    }
    let protocol = small_string(root.pointer("/device/protocol"));
    if let Some(p) = &protocol {
        e.fields.insert("protocol".into(), p.clone());
    }
    if !protocol
        .as_deref()
        .is_some_and(|p| ["ATA", "NVMe", "SCSI"].contains(&p))
    {
        partial(result, "protocol_missing_or_unsupported");
    }
    let exit = root
        .pointer("/smartctl/exit_status")
        .and_then(Value::as_u64)
        .filter(|n| *n <= 255);
    if let Some(code) = exit {
        e.fields.insert("toolExitStatus".into(), code.to_string());
        for (bit, name) in [
            (0, "command_line_error"),
            (1, "device_access_or_identify_or_low_power"),
            (2, "command_or_data_error"),
            (3, "health_failing"),
            (4, "prefail_threshold"),
            (5, "past_threshold"),
            (6, "error_log_records"),
            (7, "self_test_records"),
        ] {
            if code & (1 << bit) != 0 {
                result.warnings.push(format!("smartctl_bit_{bit}:{name}"));
            }
        }
        if code & 7 != 0 {
            partial(result, "report_has_collection_errors");
        }
    } else {
        partial(result, "exit_status_missing_or_invalid");
    }
    let passed = root
        .pointer("/smart_status/passed")
        .and_then(Value::as_bool);
    let critical = root
        .pointer("/nvme_smart_health_information_log/critical_warning")
        .and_then(Value::as_u64)
        .filter(|n| *n <= 255);
    if let Some(n) = critical {
        e.fields.insert("nvmeCriticalWarning".into(), n.to_string());
    }
    if root
        .pointer("/nvme_smart_health_information_log/critical_warning")
        .is_some()
        && critical.is_none()
    {
        partial(result, "nvme_warning_invalid");
    }
    let failing = passed == Some(false)
        || exit.is_some_and(|n| n & 8 != 0)
        || critical.is_some_and(|n| n > 0);
    let health = if failing {
        "failed"
    } else if passed == Some(true) && exit.is_some_and(|n| n & 7 == 0) {
        "passed"
    } else {
        "unknown"
    };
    if passed == Some(true) && failing {
        partial(result, "conflicting_health_statements");
    }
    if health == "unknown" {
        partial(result, "health_not_established");
    }
    e.fields.insert("declaredHealth".into(), health.into());
    if let Some(t) = root
        .pointer("/local_time/time_t")
        .and_then(Value::as_i64)
        .filter(|n| (0..=253402300799).contains(n))
    {
        e.observed_at_utc = DateTime::<Utc>::from_timestamp(t, 0).map(|d| d.to_rfc3339());
    }
    if e.observed_at_utc.is_none() {
        result
            .warnings
            .push("report_time_unknown_not_import_time".into());
    }
    result.evidence.push(e);
    Ok(())
}

fn dashed(s: &str) -> bool {
    let s = s.trim();
    s.len() >= 10 && s.bytes().all(|b| b == b'-')
}
fn cdi(text: &str, result: &mut ParseResult) -> Result<(), ParseError> {
    let lines: Vec<&str> = text.lines().take(MAX_REPORT_LINES + 1).collect();
    if lines.len() > MAX_REPORT_LINES {
        return Err(ParseError::InvalidStructure);
    }
    let version =
        regex::Regex::new(r"^CrystalDiskInfo\s+(\d+)\.(\d+)(?:\.(\d+))?(?:\s|$)").unwrap();
    let Some(capture) = lines.iter().find_map(|l| version.captures(l.trim())) else {
        unsupported(result, "missing_cdi_header");
        return Ok(());
    };
    let major = capture[1].parse::<u32>().ok();
    let minor = capture[2].parse::<u32>().ok();
    result.declared_tool_version = Some(format!(
        "{}.{}.{}",
        &capture[1],
        &capture[2],
        capture.get(3).map_or("0", |c| c.as_str())
    ));
    if major != Some(9) || !minor.is_some_and(|n| n <= 6) {
        unsupported(result, "unsupported_tool_version");
        return Ok(());
    }
    let header = regex::Regex::new(r"^\((\d{1,3})\)\s+(.+)$").unwrap();
    let sections: Vec<(usize, String)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            if i == 0 || i + 1 >= lines.len() || !dashed(lines[i - 1]) || !dashed(lines[i + 1]) {
                return None;
            }
            header.captures(line.trim()).map(|c| (i, c[1].to_string()))
        })
        .collect();
    if sections.is_empty() {
        unsupported(result, "no_disk_sections");
        return Ok(());
    }
    if sections.len() > MAX_DISKS {
        return Err(ParseError::TooManyDisks);
    }
    let mut seen = HashSet::new();
    for (index, (start, number)) in sections.iter().enumerate() {
        if !seen.insert(number) {
            return Err(ParseError::DuplicateField);
        }
        let stop = sections
            .get(index + 1)
            .map_or(lines.len(), |s| s.0.saturating_sub(1));
        let mut e = evidence(
            result,
            index + 1,
            &format!("text:lines:{}-{}", start + 1, stop),
        );
        e.fields.insert("tool".into(), "CrystalDiskInfo".into());
        e.fields.insert("diskSection".into(), number.clone());
        e.fields.insert(
            "toolVersionDeclared".into(),
            result.declared_tool_version.clone().unwrap(),
        );
        for line in &lines[start + 2..stop] {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let target = match key.trim() {
                "Model" => "model",
                "Serial Number" => "serialNumber",
                "Firmware" => "firmware",
                "Interface" => "protocol",
                "Health Status" => "healthStatusDeclared",
                "Temperature" => "temperatureDeclared",
                _ => continue,
            };
            let value = value.trim();
            if value.len() > MAX_FIELD_BYTES {
                return Err(ParseError::InvalidStructure);
            }
            if e.fields.insert(target.into(), value.into()).is_some() {
                return Err(ParseError::DuplicateField);
            }
        }
        let raw = e
            .fields
            .get("healthStatusDeclared")
            .cloned()
            .unwrap_or_default();
        let status = raw.split('(').next().unwrap_or("").trim();
        let health = match status {
            "Good" | "良好" => "passed",
            "Caution" | "警告" => "caution",
            "Bad" | "不良" => "failed",
            _ => "unknown",
        };
        e.fields.insert("declaredHealth".into(), health.into());
        if health == "unknown" {
            partial(result, "disk_health_missing_or_unknown");
        }
        if !e.fields.get("model").is_some_and(|s| !s.is_empty()) {
            partial(result, "disk_model_missing");
        }
        // CDI's Date field is local time without an offset. Never invent UTC or use import time.
        result.evidence.push(e);
    }
    result
        .warnings
        .push("cdi_local_time_has_no_timezone_not_correlated".into());
    Ok(())
}
