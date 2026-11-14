use crate::{
    Result,
    parsers::{self, ParseResult, ReportFormat},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub id: String,
    pub case_id: String,
    pub run_id: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub imported_at_utc: String,
    pub format: String,
    pub parser_version: String,
}

/// Reject network, device, ADS and reparse paths. Paths never come from model output.
pub fn checked_local_path(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("需要绝对本地路径。".into());
    }
    #[cfg(windows)]
    {
        let path_text = path.to_string_lossy();
        let s = path_text.strip_prefix(r"\\?\").unwrap_or(&path_text);
        if s.starts_with(r"\\")
            || s.starts_with("UNC\\")
            || s.as_bytes().get(1) != Some(&b':')
            || s.chars().skip(2).any(|c| c == ':')
        {
            return Err("不允许网络、设备或备用数据流路径。".into());
        }
        use std::os::windows::fs::MetadataExt;
        for ancestor in path.ancestors() {
            let metadata = std::fs::symlink_metadata(ancestor).map_err(|_| "路径不可访问。")?;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("不接受重解析点或符号链接。".into());
            }
        }
    }
    #[cfg(not(windows))]
    for ancestor in path.ancestors() {
        if std::fs::symlink_metadata(ancestor)
            .map_err(|_| "路径不可访问。")?
            .file_type()
            .is_symlink()
        {
            return Err("不接受符号链接。".into());
        }
    }
    std::fs::canonicalize(path).map_err(|_| "路径不可访问。".into())
}
pub fn open_source(path: &Path, limit: usize) -> Result<(File, Vec<u8>)> {
    let expected = checked_local_path(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x00200000);
    }
    let mut file = options.open(path).map_err(|_| "无法打开选择的文件。")?;
    let metadata = file.metadata().map_err(|_| "无法读取文件信息。")?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err("文件不是常规文件或大小超限。".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("不接受重解析文件。".into());
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetFinalPathNameByHandleW(
                handle: *mut std::ffi::c_void,
                out: *mut u16,
                size: u32,
                flags: u32,
            ) -> u32;
        }
        let mut buffer = vec![0u16; 32768];
        let n = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
        if n == 0
            || n as usize >= buffer.len()
            || PathBuf::from(String::from_utf16_lossy(&buffer[..n as usize])) != expected
        {
            return Err("选择的文件身份已变化。".into());
        }
    }
    #[cfg(not(windows))]
    let _ = expected;
    let mut bytes = Vec::new();
    (&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文件失败。")?;
    if bytes.len() > limit {
        return Err("文件大小超限。".into());
    }
    Ok((file, bytes))
}

pub struct ArtifactStore {
    root: PathBuf,
}
impl ArtifactStore {
    pub fn new(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root).map_err(|_| "无法创建附件目录。")?;
        Ok(Self {
            root: checked_local_path(root)?,
        })
    }
    pub fn recover(&self, referenced: &std::collections::BTreeSet<String>) -> Result<()> {
        for entry in std::fs::read_dir(&self.root).map_err(|_| "附件恢复失败。")? {
            let entry = entry.map_err(|_| "附件恢复失败。")?;
            if uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
                continue;
            }
            let dir = checked_local_path(&entry.path())?;
            if !dir.starts_with(&self.root)
                || !entry.file_type().map_err(|_| "附件恢复失败。")?.is_dir()
            {
                return Err("附件目录身份无效。".into());
            }
            for file in std::fs::read_dir(&dir).map_err(|_| "附件恢复失败。")? {
                let file = file.map_err(|_| "附件恢复失败。")?;
                let path = file.path();
                let stem = path.file_stem().and_then(|v| v.to_str()).unwrap_or("");
                if uuid::Uuid::parse_str(stem).is_err() {
                    continue;
                }
                let ext = path.extension().and_then(|v| v.to_str());
                if ext == Some("tmp") || (ext == Some("bin") && !referenced.contains(stem)) {
                    checked_local_path(&path)?;
                    if !file.file_type().map_err(|_| "附件恢复失败。")?.is_file() {
                        return Err("附件恢复遇到未知目录。".into());
                    }
                    std::fs::remove_file(path).map_err(|_| "附件恢复清理失败。")?;
                }
            }
        }
        Ok(())
    }
    fn directory(&self, case_id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(case_id).map_err(|_| "案例 ID 无效。")?;
        let dir = self.root.join(case_id);
        std::fs::create_dir_all(&dir).map_err(|_| "无法创建案例附件目录。")?;
        let resolved = checked_local_path(&dir)?;
        if !resolved.starts_with(&self.root) {
            return Err("附件目录越界。".into());
        }
        Ok(resolved)
    }
    pub fn prepare(
        &self,
        case_id: &str,
        run_id: &str,
        format: ReportFormat,
        bytes: &[u8],
    ) -> Result<(Artifact, ParseResult)> {
        uuid::Uuid::parse_str(run_id).map_err(|_| "运行 ID 无效。")?;
        let parsed =
            parsers::parse_report(format, bytes).map_err(|e| format!("报告解析失败：{e:?}"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let dir = self.directory(case_id)?;
        let tmp = dir.join(format!("{id}.tmp"));
        let final_path = dir.join(format!("{id}.bin"));
        let result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)
                .map_err(|_| "无法写入附件。")?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "附件写入失败。")?;
            drop(file);
            std::fs::rename(&tmp, &final_path).map_err(|_| "附件提交失败。")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
            result?;
        }
        let artifact = Artifact {
            id,
            case_id: case_id.into(),
            run_id: run_id.into(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: bytes.len() as u64,
            imported_at_utc: chrono::Utc::now().to_rfc3339(),
            format: match format {
                ReportFormat::SmartctlJson => "smartctl_json",
                ReportFormat::CrystalDiskInfoText => "crystal_disk_info_text",
                ReportFormat::HwinfoCsv => "hwinfo_csv",
            }
            .into(),
            parser_version: parsed.parser_version.clone(),
        };
        Ok((artifact, parsed))
    }
    pub fn remove(&self, case_id: &str, id: &str) -> Result<()> {
        uuid::Uuid::parse_str(id).map_err(|_| "附件 ID 无效。")?;
        let p = self.directory(case_id)?.join(format!("{id}.bin"));
        if p.exists() {
            checked_local_path(&p)?;
            std::fs::remove_file(p).map_err(|_| "附件删除失败。")?;
        }
        Ok(())
    }
    pub fn delete_case(&self, case_id: &str) -> Result<()> {
        let p = self.directory(case_id)?;
        // Only application-owned UUID .bin/.tmp files, no recursive traversal through unknown entries.
        for item in std::fs::read_dir(&p).map_err(|_| "附件清理失败。")? {
            let item = item.map_err(|_| "附件清理失败。")?;
            let path = item.path();
            checked_local_path(&path)?;
            if !item.file_type().map_err(|_| "附件清理失败。")?.is_file() {
                return Err("附件目录含未知内容，停止清理。".into());
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("附件名称无效。")?;
            uuid::Uuid::parse_str(stem).map_err(|_| "附件目录含未知内容，停止清理。")?;
            if ![Some("bin"), Some("tmp")].contains(&path.extension().and_then(|s| s.to_str())) {
                return Err("附件类型无效。".into());
            }
            std::fs::remove_file(path).map_err(|_| "附件删除失败。")?;
        }
        std::fs::remove_dir(p).map_err(|_| "案例附件目录删除失败。".into())
    }
}
