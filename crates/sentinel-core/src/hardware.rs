//! Startup inventory: fixed local reads, no diagnostic consent/case/model side effects.
use crate::{
    Result,
    collectors::system_directory,
    runner::{self, Cancellation},
};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, process::Command, time::Duration};

const SCRIPT: &str = include_str!("hardware.ps1");
const MAX_OUTPUT: usize = 512 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HardwareItem {
    pub name: String,
    pub details: Vec<String>,
    pub problem: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HardwareGroup {
    pub id: String,
    pub label: String,
    pub status: String,
    pub items: Vec<HardwareItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HardwareSnapshot {
    pub origin: String,
    pub collected_at_utc: String,
    pub computer_model: String,
    pub operating_system: String,
    pub groups: Vec<HardwareGroup>,
}
fn parse(bytes: &[u8]) -> Result<HardwareSnapshot> {
    if bytes.len() > MAX_OUTPUT {
        return Err("硬件信息超过读取上限。".into());
    }
    let snapshot: HardwareSnapshot =
        serde_json::from_slice(bytes).map_err(|_| "硬件信息格式无效。")?;
    let ids = [
        "cpu",
        "baseboard",
        "memory",
        "graphics",
        "monitors",
        "storage",
        "npu",
        "audio",
        "network",
        "bios",
    ];
    if snapshot.origin != "windows_native"
        || snapshot.groups.len() != ids.len()
        || snapshot.groups.iter().zip(ids).any(|(g, id)| {
            g.id != id
                || !["available", "empty", "unavailable"].contains(&g.status.as_str())
                || g.items.len() > 64
        })
    {
        return Err("硬件信息分组不完整。".into());
    }
    Ok(snapshot)
}
pub fn collect() -> Result<HardwareSnapshot> {
    let system = system_directory()?;
    let work = std::env::temp_dir().join(format!("sentinel-hardware-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&work).map_err(|_| "无法创建硬件信息工作目录。")?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0.join("hardware.ps1"));
            let _ = std::fs::remove_dir(&self.0);
        }
    }
    let _cleanup = Cleanup(work.clone());
    let script_path = work.join("hardware.ps1");
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&script_path)
        .map_err(|_| "无法准备硬件读取脚本。")?;
    file.write_all(b"\xEF\xBB\xBF")
        .and_then(|_| file.write_all(SCRIPT.as_bytes()))
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法写入硬件读取脚本。")?;
    drop(file);
    let (_guard, _) = crate::artifacts::open_source(&script_path, MAX_OUTPUT)?;
    let mut command = Command::new(system.join(r"WindowsPowerShell\v1.0\powershell.exe"));
    command
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-File"])
        .arg(script_path)
        .current_dir(&system)
        .env_clear()
        .env("SystemRoot", system.parent().ok_or("系统目录无效。")?)
        .env("PATH", &system)
        .env("PATHEXT", ".EXE;.COM")
        .env("TEMP", &work)
        .env("TMP", &work);
    let output = runner::execute(
        command,
        vec![],
        Duration::from_secs(45),
        MAX_OUTPUT,
        &Cancellation::default(),
    )?;
    if output.status != "completed" {
        return Err(if output.status == "timed_out" {
            "硬件读取超时，请稍后刷新。"
        } else {
            "硬件读取未完成，请稍后刷新。"
        }
        .into());
    }
    let mut snapshot = parse(&output.stdout)?;
    #[cfg(windows)]
    if let Some(items) = crate::collectors::hardware_graphics() {
        if let Some(group) = snapshot.groups.iter_mut().find(|g| g.id == "graphics") {
            for native in items {
                if let Some(existing) = group
                    .items
                    .iter_mut()
                    .find(|item| item.name.eq_ignore_ascii_case(&native.name))
                {
                    existing
                        .details
                        .retain(|detail| !detail.starts_with("显存容量未读取"));
                    existing.details.extend(native.details);
                } else {
                    group.items.push(native);
                }
            }
            group.status = "available".into();
        }
    }
    // Timestamp records this read only; it is not machine uptime.
    snapshot.collected_at_utc = chrono::Utc::now().to_rfc3339();
    Ok(snapshot)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_rejects_extra_fields_and_incomplete_groups() {
        let sample = serde_json::json!({"origin":"windows_native","collectedAtUtc":"now","computerModel":"PC","operatingSystem":"Windows","groups":[]});
        assert!(parse(sample.to_string().as_bytes()).is_err());
        let mut value = sample;
        value["uptime"] = 1.into();
        assert!(serde_json::from_value::<HardwareSnapshot>(value).is_err());
    }
    #[test]
    #[ignore = "explicit opt-in local read, no network/model or database writes"]
    fn live_hardware_inventory() {
        let result = collect().expect("Windows hardware inventory");
        assert_eq!(result.groups.len(), 10);
        assert!(
            result
                .groups
                .iter()
                .any(|g| g.id == "cpu" && !g.items.is_empty())
        );
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("SerialNumber")
        );
        println!("{}", serde_json::to_string(&result).unwrap());
    }
}
