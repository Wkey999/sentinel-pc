//! Discovery never executes candidate binaries. Tool/device tokens are local capabilities.
use crate::{
    Result,
    artifacts::open_source,
    runner::{self, Cancellation, ProcessOutput},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::PathBuf, process::Command, time::Duration};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCandidate {
    pub token: String,
    pub tool_id: String,
    pub display_path: String,
    pub sha256: String,
    pub version: Option<String>,
    pub status: String,
    pub integration: String,
    pub notice: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceCandidate {
    pub token: String,
    pub tool_token: String,
    pub display_name: String,
    pub protocol: String,
}
#[derive(Default)]
pub struct ToolRegistry {
    tools: HashMap<String, (ToolCandidate, PathBuf)>,
    devices: HashMap<String, (DeviceCandidate, String, String)>,
}
impl ToolRegistry {
    pub fn probe(&mut self, toolbox: Option<&str>) -> Result<Vec<ToolCandidate>> {
        let mut paths = Vec::new();
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(key) {
                let root = PathBuf::from(root);
                paths.push(("smartctl", root.join(r"smartmontools\bin\smartctl.exe")));
                paths.push((
                    "crystal_disk_info",
                    root.join(r"CrystalDiskInfo\DiskInfo64.exe"),
                ));
            }
        }
        if let Some(root) = toolbox {
            let root = crate::artifacts::checked_local_path(&PathBuf::from(root))?;
            if !root.is_dir() {
                return Err("工具箱需要目录。".into());
            }
            for (id, relative) in [
                ("smartctl", "smartctl.exe"),
                ("smartctl", r"smartmontools\bin\smartctl.exe"),
                ("crystal_disk_info", "DiskInfo64.exe"),
                ("crystal_disk_info", r"CrystalDiskInfo\DiskInfo64.exe"),
            ] {
                paths.push((id, root.join(relative)));
            }
        }
        let mut result = Vec::new();
        for (id, path) in paths {
            if !path.exists() {
                continue;
            }
            let Ok((file, bytes)) = open_source(&path, 64 * 1024 * 1024) else {
                continue;
            };
            if !bytes.starts_with(b"MZ") {
                continue;
            }
            let path = crate::artifacts::checked_local_path(&path)?;
            let hash = format!("{:x}", Sha256::digest(&bytes));
            if let Some((existing, _)) = self
                .tools
                .values()
                .find(|(t, p)| p == &path && t.sha256 == hash)
            {
                result.push(existing.clone());
                continue;
            }
            if self.tools.len() >= 64 {
                return Err("工具发现缓存已满，请重启后重试。".into());
            }
            let candidate=ToolCandidate { token:uuid::Uuid::new_v4().to_string(),tool_id:id.into(),display_path:path.to_string_lossy().into(),sha256:hash,version:file_version(&path),
                status:"candidate_unverified".into(),integration:if id=="smartctl" {"local_cli"} else {"import_only"}.into(),
                notice:"仅发现本地文件；未运行、未验证发行来源或版本。请核对来源和哈希；外部只读查询也可能唤醒磁盘，需独立确认。CrystalDiskInfo 目前仅导入报告。".into()};
            self.tools
                .insert(candidate.token.clone(), (candidate.clone(), path));
            drop(file);
            result.push(candidate);
        }
        Ok(result)
    }
    pub fn identity(&self, token: &str) -> Result<ToolCandidate> {
        self.tools
            .get(token)
            .map(|(t, _)| t.clone())
            .ok_or("工具标识无效。".into())
    }
    fn command(&self, token: &str) -> Result<(std::fs::File, Command)> {
        let (candidate, path) = self.tools.get(token).ok_or("工具标识无效或已失效。")?;
        if candidate.tool_id != "smartctl" {
            return Err("该工具仅支持报告导入，不允许启动。".into());
        }
        let (guard, bytes) = open_source(path, 64 * 1024 * 1024)?;
        if format!("{:x}", Sha256::digest(&bytes)) != candidate.sha256 {
            return Err("工具文件已变化，请重新发现并确认。".into());
        }
        let system = crate::collectors::system_directory()?;
        let mut command = Command::new(path);
        command
            .current_dir(&system)
            .env_clear()
            .env("SystemRoot", system.parent().ok_or("系统目录无效。")?)
            .env("PATH", &system);
        Ok((guard, command))
    }
    pub fn probe_devices(
        &mut self,
        token: &str,
        confirmed: bool,
        cancel: &Cancellation,
    ) -> Result<Vec<DeviceCandidate>> {
        if !confirmed {
            return Err("发现设备会运行第三方程序，需确认工具路径与哈希。".into());
        }
        let (_guard, mut command) = self.command(token)?;
        command.args(["--scan", "-j"]);
        let output = runner::execute(
            command,
            vec![],
            Duration::from_secs(30),
            2 * 1024 * 1024,
            cancel,
        )?;
        if output.status != "completed" {
            return Err("设备枚举未完成；未自动提权或重试。".into());
        }
        self.register_devices(token, &output.stdout)
    }
    fn register_devices(&mut self, token: &str, bytes: &[u8]) -> Result<Vec<DeviceCandidate>> {
        let json: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| "设备枚举结构无效。")?;
        let devices = json
            .get("devices")
            .and_then(|v| v.as_array())
            .ok_or("工具未返回设备列表。")?;
        if devices.len() > 128 || self.devices.len() + devices.len() > 256 {
            return Err("设备数量超限。".into());
        }
        let valid=regex::Regex::new(r"^(?:/dev/(?:[sh]d[a-z]{1,3}|pd[0-9]{1,3}|nvme[0-9]{1,3})|\\\\\.\\PhysicalDrive[0-9]{1,3})$").expect("device pattern");
        let mut result = vec![];
        for device in devices {
            let name = device
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or("设备名缺失。")?;
            let protocol = device
                .get("type")
                .and_then(|v| v.as_str())
                .ok_or("设备类型缺失。")?;
            if !valid.is_match(name) || !["ata", "scsi", "nvme", "sat"].contains(&protocol) {
                continue;
            }
            let candidate = DeviceCandidate {
                token: uuid::Uuid::new_v4().to_string(),
                tool_token: token.into(),
                display_name: name.into(),
                protocol: protocol.into(),
            };
            self.devices.insert(
                candidate.token.clone(),
                (candidate.clone(), name.into(), protocol.into()),
            );
            result.push(candidate);
        }
        Ok(result)
    }
    pub fn validate_device(&self, tool: &str, device: &str) -> Result<()> {
        let (d, _, _) = self
            .devices
            .get(device)
            .ok_or("设备标识无效或需重新枚举。")?;
        if d.tool_token != tool || !self.tools.contains_key(tool) {
            return Err("设备与工具不匹配。".into());
        }
        Ok(())
    }
    pub fn read(&self, tool: &str, device: &str, cancel: &Cancellation) -> Result<ProcessOutput> {
        self.validate_device(tool, device)?;
        let (_, name, protocol) = self.devices.get(device).ok_or("设备标识失效。")?;
        let (_guard, mut command) = self.command(tool)?;
        command.args(["-a", "-j", "-d", protocol, name]);
        runner::execute(
            command,
            vec![],
            Duration::from_secs(60),
            20 * 1024 * 1024,
            cancel,
        )
    }
}

#[cfg(windows)]
fn file_version(path: &std::path::Path) -> Option<String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};
    #[link(name = "version")]
    unsafe extern "system" {
        fn GetFileVersionInfoSizeW(path: *const u16, unused: *mut u32) -> u32;
        fn GetFileVersionInfoW(path: *const u16, handle: u32, size: u32, data: *mut c_void) -> i32;
        fn VerQueryValueW(
            data: *const c_void,
            key: *const u16,
            value: *mut *mut c_void,
            len: *mut u32,
        ) -> i32;
    }
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut unused = 0;
    let size = unsafe { GetFileVersionInfoSizeW(name.as_ptr(), &mut unused) };
    if size == 0 || size > 1024 * 1024 {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    let mut value = std::ptr::null_mut();
    let mut len = 0;
    if unsafe { GetFileVersionInfoW(name.as_ptr(), 0, size, buffer.as_mut_ptr() as *mut c_void) }
        == 0
        || unsafe {
            VerQueryValueW(
                buffer.as_ptr() as *const c_void,
                [b'\\' as u16, 0].as_ptr(),
                &mut value,
                &mut len,
            )
        } == 0
        || len < 52
        || value.is_null()
    {
        return None;
    }
    if (value as usize) < buffer.as_ptr() as usize
        || (value as usize).checked_add(52)? > buffer.as_ptr() as usize + buffer.len()
    {
        return None;
    }
    let words = unsafe { std::slice::from_raw_parts(value as *const u32, 13) };
    if words[0] != 0xfeef04bd {
        return None;
    }
    Some(format!(
        "{}.{}.{}.{}",
        words[2] >> 16,
        words[2] & 65535,
        words[3] >> 16,
        words[3] & 65535
    ))
}
#[cfg(not(windows))]
fn file_version(_: &std::path::Path) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_enumerated_devices_get_capability_tokens() {
        let mut r = ToolRegistry::default();
        let devices=r.register_devices("synthetic-tool",br#"{"devices":[{"name":"/dev/sda","type":"ata"},{"name":"-t long","type":"ata"},{"name":"/dev/nvme0","type":"nvme"},{"name":"/dev/sdb;calc","type":"sat"}]}"#).unwrap();
        assert_eq!(devices.len(), 2);
        assert!(r.validate_device("other-tool", &devices[0].token).is_err());
        assert!(r.validate_device("synthetic-tool", "/dev/sda").is_err());
    }
    #[test]
    fn unconfirmed_or_unknown_tools_never_start() {
        let mut r = ToolRegistry::default();
        assert!(
            r.probe_devices("unregistered", false, &Cancellation::default())
                .is_err()
        );
        assert!(
            r.read("unregistered", "unregistered", &Cancellation::default())
                .is_err()
        );
    }
}
