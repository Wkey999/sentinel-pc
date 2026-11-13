//! Windows active paths + DXCore IsIntegrated. No vendor-name or VRAM-size heuristics.
//! ABI references: QueryDisplayConfig, DISPLAYCONFIG_* and dxcore_interface.h.
use super::{Collection, monitor_key};
use crate::{
    Result,
    domain::{Coverage, Evidence},
    runner::Cancellation,
};
use std::{collections::BTreeMap, ffi::c_void};
type Handle = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Luid {
    low: u32,
    high: i32,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rational {
    num: u32,
    den: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Source {
    adapter: Luid,
    id: u32,
    mode: u32,
    status: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Target {
    adapter: Luid,
    id: u32,
    mode: u32,
    technology: i32,
    rotation: u32,
    scaling: u32,
    refresh: Rational,
    scan: u32,
    available: i32,
    status: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DisplayPath {
    source: Source,
    target: Target,
    flags: u32,
}
#[repr(C, align(8))]
#[derive(Clone, Copy, Default)]
struct ModeData {
    words: [u32; 12],
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Mode {
    kind: u32,
    id: u32,
    adapter: Luid,
    data: ModeData,
}
#[repr(C)]
struct Header {
    kind: u32,
    size: u32,
    adapter: Luid,
    id: u32,
}
#[repr(C)]
struct TargetName {
    header: Header,
    flags: u32,
    technology: i32,
    manufacturer: u16,
    product: u16,
    connector: u32,
    friendly: [u16; 64],
    path: [u16; 128],
}
#[repr(C)]
struct Guid {
    a: u32,
    b: u16,
    c: u16,
    d: [u8; 8],
}
const FACTORY: Guid = Guid {
    a: 0x78ee5945,
    b: 0xc36e,
    c: 0x4b13,
    d: [0xa6, 0x69, 0, 0x5d, 0xd1, 0x1c, 0x0f, 0x06],
};
const ADAPTER: Guid = Guid {
    a: 0xf0db4c7f,
    b: 0xfe5a,
    c: 0x42a2,
    d: [0xbd, 0x62, 0xf2, 0xa6, 0xcf, 0x6f, 0xc8, 0x3e],
};
const LIST: Guid = Guid {
    a: 0x526c7776,
    b: 0x40e9,
    c: 0x459b,
    d: [0xb7, 0x11, 0xf3, 0x2a, 0xd7, 0x6d, 0xfc, 0x28],
};
const GRAPHICS: Guid = Guid {
    a: 0x8c47866b,
    b: 0x7583,
    c: 0x450d,
    d: [0xf0, 0xf0, 0x6b, 0xad, 0xa8, 0x95, 0xaf, 0x4b],
};
#[link(name = "user32")]
unsafe extern "system" {
    fn GetDisplayConfigBufferSizes(flags: u32, paths: *mut u32, modes: *mut u32) -> i32;
    fn QueryDisplayConfig(
        flags: u32,
        paths: *mut u32,
        path: *mut DisplayPath,
        modes: *mut u32,
        mode: *mut Mode,
        topology: *mut u32,
    ) -> i32;
    fn DisplayConfigGetDeviceInfo(header: *mut Header) -> i32;
    fn GetSystemMetrics(index: i32) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryExW(name: *const u16, file: Handle, flags: u32) -> Handle;
    fn GetProcAddress(module: Handle, name: *const u8) -> *mut c_void;
    fn FreeLibrary(module: Handle) -> i32;
}
struct Library(Handle);
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            FreeLibrary(self.0);
        }
    }
}
struct Com(Handle);
impl Com {
    fn property(&self, key: u32) -> Option<Vec<u8>> {
        unsafe {
            let supported: unsafe extern "system" fn(Handle, u32) -> bool = self.function(5);
            if !supported(self.0, key) {
                return None;
            }
            let size: unsafe extern "system" fn(Handle, u32, *mut usize) -> i32 = self.function(7);
            let mut n = 0usize;
            if size(self.0, key, &mut n) < 0 || n == 0 || n > 4096 {
                return None;
            }
            let mut bytes = vec![0u8; n];
            let get: unsafe extern "system" fn(Handle, u32, usize, *mut c_void) -> i32 =
                self.function(6);
            if get(self.0, key, n, bytes.as_mut_ptr() as *mut c_void) < 0 {
                None
            } else {
                Some(bytes)
            }
        }
    }
    unsafe fn function<T: Copy>(&self, index: usize) -> T {
        unsafe {
            let table = *(self.0 as *const *const *const c_void);
            std::mem::transmute_copy(&*table.add(index))
        }
    }
    fn role(&self) -> Option<&'static str> {
        match (self.bool_property(11), self.bool_property(12)) {
            (Some(false), _) => Some("software"),
            (Some(true), Some(true)) => Some("integrated"),
            (Some(true), Some(false)) => Some("discrete"),
            _ => None,
        }
    }
    fn bool_property(&self, key: u32) -> Option<bool> {
        unsafe {
            let supported: unsafe extern "system" fn(Handle, u32) -> bool = self.function(5);
            if !supported(self.0, key) {
                return None;
            }
            let get: unsafe extern "system" fn(Handle, u32, usize, *mut c_void) -> i32 =
                self.function(6);
            let mut value = 0u8;
            if get(self.0, key, 1, &mut value as *mut _ as *mut c_void) < 0 || value > 1 {
                None
            } else {
                Some(value == 1)
            }
        }
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            let release: unsafe extern "system" fn(Handle) -> u32 = self.function(2);
            release(self.0);
        }
    }
}
struct Dxcore {
    factory: Com,
    _library: Library,
}
impl Dxcore {
    fn new() -> Option<Self> {
        unsafe {
            let name: Vec<u16> = "dxcore.dll".encode_utf16().chain(Some(0)).collect();
            let handle = LoadLibraryExW(name.as_ptr(), std::ptr::null_mut(), 0x800);
            if handle.is_null() {
                return None;
            }
            let library = Library(handle);
            let function =
                GetProcAddress(handle, c"DXCoreCreateAdapterFactory".as_ptr() as *const u8);
            if function.is_null() {
                return None;
            }
            let create: unsafe extern "system" fn(*const Guid, *mut Handle) -> i32 =
                std::mem::transmute(function);
            let mut factory = std::ptr::null_mut();
            if create(&FACTORY, &mut factory) < 0 || factory.is_null() {
                return None;
            }
            Some(Self {
                factory: Com(factory),
                _library: library,
            })
        }
    }
    fn adapter(&self, luid: &Luid) -> Option<Com> {
        unsafe {
            let get: unsafe extern "system" fn(
                Handle,
                *const Luid,
                *const Guid,
                *mut Handle,
            ) -> i32 = self.factory.function(4);
            let mut adapter = std::ptr::null_mut();
            if get(self.factory.0, luid, &ADAPTER, &mut adapter) < 0 || adapter.is_null() {
                None
            } else {
                Some(Com(adapter))
            }
        }
    }
    fn has_discrete(&self) -> Option<bool> {
        unsafe {
            let create: unsafe extern "system" fn(
                Handle,
                u32,
                *const Guid,
                *const Guid,
                *mut Handle,
            ) -> i32 = self.factory.function(3);
            let mut list = std::ptr::null_mut();
            if create(self.factory.0, 1, &GRAPHICS, &LIST, &mut list) < 0 || list.is_null() {
                return None;
            }
            let list = Com(list);
            let count: unsafe extern "system" fn(Handle) -> u32 = list.function(4);
            let count = count(list.0);
            if count == 0 || count > 128 {
                return None;
            }
            let get: unsafe extern "system" fn(Handle, u32, *const Guid, *mut Handle) -> i32 =
                list.function(3);
            let mut complete = true;
            for i in 0..count {
                let mut adapter = std::ptr::null_mut();
                if get(list.0, i, &ADAPTER, &mut adapter) < 0 || adapter.is_null() {
                    complete = false;
                    continue;
                }
                match Com(adapter).role() {
                    Some("discrete") => return Some(true),
                    Some(_) => {}
                    None => complete = false,
                }
            }
            if complete { Some(false) } else { None }
        }
    }
}
/// DXCore reports 64-bit dedicated memory; WMI AdapterRAM is only uint32.
pub(super) fn hardware_graphics() -> Option<Vec<crate::hardware::HardwareItem>> {
    let dx = Dxcore::new()?;
    unsafe {
        let create: unsafe extern "system" fn(
            Handle,
            u32,
            *const Guid,
            *const Guid,
            *mut Handle,
        ) -> i32 = dx.factory.function(3);
        let mut list = std::ptr::null_mut();
        if create(dx.factory.0, 1, &GRAPHICS, &LIST, &mut list) < 0 || list.is_null() {
            return None;
        }
        let list = Com(list);
        let count: unsafe extern "system" fn(Handle) -> u32 = list.function(4);
        let n = count(list.0);
        if n == 0 || n > 64 {
            return None;
        }
        let get: unsafe extern "system" fn(Handle, u32, *const Guid, *mut Handle) -> i32 =
            list.function(3);
        let mut items = vec![];
        for i in 0..n {
            let mut handle = std::ptr::null_mut();
            if get(list.0, i, &ADAPTER, &mut handle) < 0 || handle.is_null() {
                return None;
            }
            let adapter = Com(handle);
            if adapter.bool_property(11) == Some(false) {
                continue;
            }
            let raw = adapter.property(2)?;
            let name = String::from_utf8_lossy(raw.split(|b| *b == 0).next()?)
                .trim()
                .to_string();
            let role = adapter.role();
            let mut details = vec![
                match role {
                    Some("integrated") => "集成显卡",
                    Some("discrete") => "独立显卡",
                    _ => "显卡类型未报告",
                }
                .into(),
            ];
            let memory = adapter
                .property(7)
                .and_then(|v| v.try_into().ok())
                .map(u64::from_ne_bytes);
            match (role, memory) {
                (Some("integrated"), _) => details.push("使用共享系统内存".into()),
                (_, Some(n)) if n > 0 => details.push(format!(
                    "驱动可见专用显存 {:.1} GiB（DXCore）",
                    n as f64 / 1073741824.0
                )),
                _ => details.push("专用显存容量未报告".into()),
            }
            items.push(crate::hardware::HardwareItem {
                name,
                details,
                problem: false,
            });
        }
        if items.is_empty() { None } else { Some(items) }
    }
}
pub(super) fn collect(cancel: &Cancellation) -> Result<Collection> {
    let mut output = Collection {
        evidence: vec![],
        coverage: vec![],
    };
    if cancel.is_cancelled() {
        return Ok(output);
    }
    let dx = Dxcore::new();
    let has_discrete = dx.as_ref().and_then(|d| d.has_discrete());
    let mut success = None;
    let mut code = 0;
    for _ in 0..3 {
        let (mut paths, mut modes) = (0, 0);
        code = unsafe { GetDisplayConfigBufferSizes(2, &mut paths, &mut modes) };
        if code != 0 {
            break;
        }
        if paths > 128 || modes > 4096 {
            return Err("显示路径数量超限。".into());
        }
        let mut p = vec![DisplayPath::default(); paths as usize];
        let mut m = vec![Mode::default(); modes as usize];
        code = unsafe {
            QueryDisplayConfig(
                2,
                &mut paths,
                p.as_mut_ptr(),
                &mut modes,
                m.as_mut_ptr(),
                std::ptr::null_mut(),
            )
        };
        if code == 122 {
            continue;
        }
        if code == 0 && paths as usize <= p.len() && modes as usize <= m.len() {
            p.truncate(paths as usize);
            m.truncate(modes as usize);
            success = Some((p, m));
        }
        break;
    }
    let Some((paths, modes)) = success else {
        output.coverage.push(Coverage {
            source: "audit.display_routing".into(),
            status: if code == 5 {
                "permission_denied"
            } else {
                "unsupported"
            }
            .into(),
            detail: format!("活动显示路径不可读，Windows 状态码 {code}；未扩大权限。"),
        });
        return Ok(output);
    };
    for (index, path) in paths.iter().enumerate() {
        if cancel.is_cancelled() {
            break;
        }
        let mut name: TargetName = unsafe { std::mem::zeroed() };
        name.header = Header {
            kind: 2,
            size: std::mem::size_of::<TargetName>() as u32,
            adapter: path.target.adapter,
            id: path.target.id,
        };
        let named = unsafe { DisplayConfigGetDeviceInfo(&mut name.header) } == 0;
        let monitor = if named {
            let n = name
                .path
                .iter()
                .position(|v| *v == 0)
                .unwrap_or(name.path.len());
            monitor_key(&String::from_utf16_lossy(&name.path[..n]))
        } else {
            format!("unmapped-target-{index}")
        };
        let role = dx
            .as_ref()
            .and_then(|d| d.adapter(&path.target.adapter))
            .and_then(|a| a.role())
            .unwrap_or("unknown");
        let mut fields = BTreeMap::from([
            ("monitorKey".into(), monitor.clone()),
            ("adapterRole".into(), role.into()),
            (
                "hasDiscreteAdapter".into(),
                has_discrete
                    .map(|v| v.to_string())
                    .unwrap_or("unknown".into()),
            ),
            (
                "sessionKind".into(),
                if unsafe { GetSystemMetrics(0x1000) } != 0 {
                    "remote"
                } else {
                    "local"
                }
                .into(),
            ),
            (
                "outputTechnology".into(),
                path.target.technology.to_string(),
            ),
            ("physicalPortVerified".into(), "false".into()),
            ("measurementOrigin".into(), "native_collected".into()),
            (
                "sourceApi".into(),
                "QueryDisplayConfig+DXCore.IsIntegrated".into(),
            ),
        ]);
        if path.target.refresh.den > 0 {
            fields.insert(
                "currentRefreshHz".into(),
                (path.target.refresh.num as f64 / path.target.refresh.den as f64).to_string(),
            );
        }
        if let Some(mode) = modes
            .get(path.target.mode as usize)
            .filter(|m| m.kind == 2 && m.id == path.target.id && m.adapter == path.target.adapter)
        {
            fields.insert("width".into(), mode.data.words[6].to_string());
            fields.insert("height".into(), mode.data.words[7].to_string());
        }
        output.evidence.push(Evidence {
            id: format!("display-{index}"),
            kind: "setup.display".into(),
            source: "windows:local".into(),
            observed_at_utc: Some(chrono::Utc::now().to_rfc3339()),
            provider: None,
            channel: None,
            event_id: None,
            schema_version: None,
            record_id: None,
            entity: Some(monitor),
            boot_session: None,
            fields,
        });
    }
    output.coverage.push(Coverage {
        source: "audit.display_routing".into(),
        status: if paths.is_empty() {
            "empty"
        } else if output.evidence.len() < paths.len() {
            "truncated"
        } else {
            "available"
        }
        .into(),
        detail: "活动路径与 DXCore 硬件分类；没有物理主板插线证明，未知分类不得按品牌推断。".into(),
    });
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_abi_layout_sizes_match_sdk() {
        assert_eq!(std::mem::size_of::<DisplayPath>(), 72);
        assert_eq!(std::mem::size_of::<Mode>(), 64);
        assert_eq!(std::mem::size_of::<TargetName>(), 420);
    }
}
