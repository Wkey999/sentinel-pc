use sentinel_core::parsers::{MAX_REPORT_BYTES, ReportFormat, parse_report};
use std::io::{self, Read};
fn main() {
    let format = match std::env::args().nth(1).as_deref() {
        Some("smartctl") => ReportFormat::SmartctlJson,
        Some("cdi") => ReportFormat::CrystalDiskInfoText,
        _ => {
            eprintln!("Usage: parse_report smartctl|cdi < report on stdin");
            std::process::exit(2)
        }
    };
    let mut bytes = Vec::new();
    if io::stdin()
        .take((MAX_REPORT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        eprintln!("stdin_read_failed");
        std::process::exit(2)
    }
    match parse_report(format, &bytes) {
        Ok(result) => println!("{}", serde_json::to_string_pretty(&result).unwrap()),
        Err(error) => {
            eprintln!("parse_error:{error:?}");
            std::process::exit(1)
        }
    }
}
