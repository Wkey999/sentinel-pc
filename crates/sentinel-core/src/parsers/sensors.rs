//! Preview HWiNFO English CSV sensor log. Preserve column identity; no inferred hardware health.
use super::*;

fn row(line: &str, separator: char) -> Result<Vec<String>, ParseError> {
    let mut values = vec![];
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    let mut closed = false;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field.push(c);
            }
        } else if c == separator {
            values.push(std::mem::take(&mut field));
            closed = false;
        } else if c == '"' && field.is_empty() && !closed {
            quoted = true;
        } else if c == '"' || closed {
            return Err(ParseError::InvalidStructure);
        } else {
            field.push(c);
        }
        if field.len() > MAX_FIELD_BYTES || values.len() > 512 {
            return Err(ParseError::InvalidStructure);
        }
    }
    if quoted {
        return Err(ParseError::InvalidStructure);
    }
    values.push(field);
    Ok(values)
}
pub(super) fn hwinfo(text: &str, result: &mut ParseResult) -> Result<(), ParseError> {
    result.parser_version = "hwinfo-csv-preview-0.1.0".into();
    let mut lines = text.lines().filter(|s| !s.trim().is_empty());
    let first = lines.next().ok_or(ParseError::Empty)?;
    let separator = if first.contains(';') { ';' } else { ',' };
    let headers = row(first, separator)?;
    if headers.len() < 3 || headers[0].trim() != "Date" || headers[1].trim() != "Time" {
        return Err(ParseError::InvalidStructure);
    }
    let specs = [
        ("CPU Package [°C]", "temperature", "°C", -50.0, 150.0),
        ("GPU Temperature [°C]", "temperature", "°C", -50.0, 150.0),
        ("CPU Package Power [W]", "power", "W", 0.0, 3000.0),
        ("GPU Power [W]", "power", "W", 0.0, 3000.0),
        (
            "Core Thermal Throttling [Yes/No]",
            "thermal_flag",
            "boolean",
            0.0,
            1.0,
        ),
        (
            "Core Power Limit Exceeded [Yes/No]",
            "power_flag",
            "boolean",
            0.0,
            1.0,
        ),
        (
            "GPU Thermal Limit [Yes/No]",
            "thermal_flag",
            "boolean",
            0.0,
            1.0,
        ),
    ];
    let columns: Vec<_> = headers
        .iter()
        .enumerate()
        .filter_map(|(i, h)| specs.iter().find(|s| h.trim() == s.0).map(|s| (i, *s)))
        .collect();
    if columns.is_empty() {
        unsupported(
            result,
            "未识别支持的英文传感器列；不是正常结论。请导出 UTF-8/带 BOM 的 UTF-16 英文 HWiNFO CSV。",
        );
        return Ok(());
    }
    if columns.len() > 128 {
        return Err(ParseError::InvalidStructure);
    }
    struct Samples {
        count: usize,
        max: f64,
        last: f64,
        yes: usize,
        first: String,
        end: String,
        invalid: usize,
    }
    let mut stats: Vec<_> = columns
        .iter()
        .map(|_| Samples {
            count: 0,
            max: f64::NEG_INFINITY,
            last: 0.0,
            yes: 0,
            first: String::new(),
            end: String::new(),
            invalid: 0,
        })
        .collect();
    let mut malformed = 0;
    let mut rows = 0;
    for (index, line) in lines.enumerate() {
        if index >= MAX_REPORT_LINES {
            return Err(ParseError::InvalidStructure);
        }
        let Ok(values) = row(line, separator) else {
            malformed += 1;
            continue;
        };
        if values == headers {
            continue;
        } // Some log exports repeat the same header.
        if values.len() != headers.len() {
            malformed += 1;
            continue;
        }
        rows += 1;
        for ((col, (_, kind, _, min, max)), stat) in columns.iter().zip(stats.iter_mut()) {
            let raw = values[*col].trim();
            let number = if kind.ends_with("flag") {
                match raw.to_ascii_lowercase().as_str() {
                    "yes" => Some(1.0),
                    "no" => Some(0.0),
                    _ => None,
                }
            } else {
                raw.replace(',', ".").parse::<f64>().ok()
            };
            let Some(number) = number.filter(|n| n.is_finite() && n >= min && n <= max) else {
                stat.invalid += 1;
                continue;
            };
            stat.count += 1;
            stat.max = stat.max.max(number);
            stat.last = number;
            if number == 1.0 && kind.ends_with("flag") {
                stat.yes += 1;
            }
            let time = format!("{} {}", values[0], values[1]);
            if stat.first.is_empty() {
                stat.first = time.clone();
            }
            stat.end = time;
        }
    }
    if rows == 0 {
        return Err(ParseError::InvalidStructure);
    }
    for ((col, (label, kind, unit, _, _)), stat) in columns.into_iter().zip(stats) {
        if stat.invalid > 0 {
            malformed += stat.invalid;
        }
        if stat.count == 0 {
            continue;
        }
        let mut e = evidence(result, col, &format!("csv:column:{}", col + 1));
        e.kind = "setup.sensor_log".into();
        e.entity = Some(format!("hwinfo-column-{}", col + 1));
        for (key, value) in [
            ("tool", "HWiNFO".into()),
            ("sensorLabel", label.into()),
            ("sensorKind", kind.into()),
            ("unit", unit.into()),
            ("sampleCount", stat.count.to_string()),
            ("maximum", stat.max.to_string()),
            ("last", stat.last.to_string()),
            ("yesCount", stat.yes.to_string()),
            ("firstDeclaredTime", stat.first),
            ("lastDeclaredTime", stat.end),
        ] {
            e.fields.insert(key.into(), value);
        }
        result.evidence.push(e);
    }
    if result.evidence.is_empty() {
        unsupported(result, "支持的传感器列没有有效值；不判断正常。");
    } else if malformed > 0 {
        partial(
            result,
            "部分 CSV 行或传感器值无效，已忽略；未将空值/未知标志当作正常。",
        );
    }
    result.warnings.push("HWiNFO 英文 CSV 预览：仅解析列名白名单，其他传感器未覆盖；时间按文件原文保留，时区/设备/负载未经核验，不与本轮实时检测强行关联。温度或功耗数值本身不证明降频。".into());
    Ok(())
}
