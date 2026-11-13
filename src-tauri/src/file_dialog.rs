//! Native explicit file selection; IPC never grants arbitrary path read access.
#[cfg(windows)]
pub fn select_report() -> Result<Option<std::path::PathBuf>, String> {
    use std::ffi::c_void;
    #[repr(C)]
    struct OpenFileName {
        size: u32,
        owner: *mut c_void,
        instance: *mut c_void,
        filter: *const u16,
        custom_filter: *mut u16,
        max_custom: u32,
        filter_index: u32,
        file: *mut u16,
        max_file: u32,
        file_title: *mut u16,
        max_title: u32,
        initial_dir: *const u16,
        title: *const u16,
        flags: u32,
        offset: u16,
        extension: u16,
        default_extension: *const u16,
        custom_data: isize,
        hook: *mut c_void,
        template: *const u16,
        reserved: *mut c_void,
        reserved_value: u32,
        flags_ex: u32,
    }
    #[link(name = "comdlg32")]
    unsafe extern "system" {
        fn GetOpenFileNameW(value: *mut OpenFileName) -> i32;
        fn CommDlgExtendedError() -> u32;
    }
    let filter: Vec<u16> = "Report (*.json;*.txt)\0*.json;*.txt\0\0"
        .encode_utf16()
        .collect();
    let title: Vec<u16> = "Sentinel PC - 选择要导入的报告\0".encode_utf16().collect();
    let mut file = vec![0u16; 32768];
    let mut dialog: OpenFileName = unsafe { std::mem::zeroed() };
    dialog.size = std::mem::size_of::<OpenFileName>() as u32;
    dialog.filter = filter.as_ptr();
    dialog.file = file.as_mut_ptr();
    dialog.max_file = file.len() as u32;
    dialog.title = title.as_ptr();
    dialog.flags = 0x00001000 | 0x00000800 | 0x00080000 | 0x00000008; // file/path exists, explorer, no current-dir mutation
    let success = unsafe { GetOpenFileNameW(&mut dialog) };
    if success == 0 {
        if unsafe { CommDlgExtendedError() } == 0 {
            return Ok(None);
        }
        return Err("文件选择对话框失败。".into());
    }
    let n = file
        .iter()
        .position(|c| *c == 0)
        .ok_or("选择的路径无效。")?;
    Ok(Some(std::path::PathBuf::from(
        String::from_utf16(&file[..n]).map_err(|_| "路径编码无效。")?,
    )))
}
#[cfg(not(windows))]
pub fn select_report() -> Result<Option<std::path::PathBuf>, String> {
    Err("本机报告选择仅支持 Windows。".into())
}
