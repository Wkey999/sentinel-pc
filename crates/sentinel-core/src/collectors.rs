//! Fixed PowerShell 5.1 collectors. JSON arguments arrive on stdin, never in script text.
use crate::{
    Result,
    domain::{Coverage, Evidence},
    runner::{self, Cancellation, ProcessOutput},
};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, process::Command, time::Duration};
#[cfg(windows)]
mod display;
mod edid;
pub use edid::{DisplayMode, parse_edid_modes};

const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$evidence=New-Object System.Collections.Generic.List[object]
$coverage=New-Object System.Collections.Generic.List[object]
function Cover($source,$status,$detail) { $coverage.Add(@{source=$source;status=$status;detail=$detail}) }
function ErrorStatus($e) {
 if($e.Exception -is [System.UnauthorizedAccessException] -or $e.CategoryInfo.Category -eq 'PermissionDenied') {return 'permission_denied'}
 if($e.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') {return 'empty'}
 if($e.FullyQualifiedErrorId -like 'NoMatchingLogsFound*') {return 'unsupported'}
 return 'failed'
}
function AddEvidence($kind,$id,$time,$provider,$channel,$eventId,$version,$recordId,$entity,$fields,$boot) {
 $evidence.Add(@{id=$id;kind=$kind;source='windows:local';observedAtUtc=$time;provider=$provider;channel=$channel;eventId=$eventId;schemaVersion=$version;recordId=$recordId;entity=$entity;bootSession=$boot;fields=$fields})
}
$boot=$null
try { $boot=(Get-CimInstance -ClassName Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime.ToUniversalTime().ToString('o') } catch {}
if($request.action -eq 'windows.system_snapshot') {
 $queries=@(
  @{class='Win32_OperatingSystem';properties=@('Caption','Version','BuildNumber','TotalVisibleMemorySize')},
  @{class='Win32_Processor';properties=@('Name','NumberOfCores','NumberOfLogicalProcessors')},
  @{class='Win32_VideoController';properties=@('Name','DriverVersion','DriverDate')}
 )
 foreach($q in $queries) {
  try {
   $rows=@(Get-CimInstance -ClassName $q.class -Property $q.properties)
   $i=0
   foreach($row in $rows) { $fields=@{};foreach($p in $q.properties){$fields[$p]=[string]$row.$p}; AddEvidence 'system.snapshot' ($q.class+'-'+$i) ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null $q.class $fields $boot;$i++ }
   Cover $q.class $(if($rows.Count){'available'}else{'empty'}) '固定属性概况查询'
  } catch {Cover $q.class (ErrorStatus $_) '系统概况查询未完整完成'}
 }
} elseif($request.action -eq 'usb_pnp.snapshot') {
 try {
  $rows=@(Get-CimInstance -ClassName Win32_PnPEntity -Property Name,PNPClass,ConfigManagerErrorCode,DeviceID | Select-Object -First 513)
  $truncated=$rows.Count -gt 512; $i=0
  foreach($row in ($rows | Select-Object -First 512)) {
   AddEvidence 'device.snapshot' ('pnp-'+$i) ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null ([string]$row.DeviceID) @{name=[string]$row.Name;pnpClass=[string]$row.PNPClass;configManagerErrorCode=[string]$row.ConfigManagerErrorCode;pnpDeviceId=[string]$row.DeviceID} $boot;$i++
  }
  Cover 'usb_pnp.snapshot' $(if($truncated){'truncated'}elseif($rows.Count){'available'}else{'empty'}) '当前设备枚举不是断连历史或设备已损坏证明'
 } catch {Cover 'usb_pnp.snapshot' (ErrorStatus $_) '设备概况查询未完成'}
} elseif($request.action -eq 'windows.event_window') {
 $start=[DateTimeOffset]::Parse($request.start).UtcDateTime
 $end=[DateTimeOffset]::Parse($request.end).UtcDateTime
 $logs=@('System','Application','HardwareEvents','Microsoft-Windows-DriverFrameworks-UserMode/Operational')
 $remaining=2000
 foreach($log in $logs) {
  if($remaining -le 0){Cover $log 'truncated' '达到本轮 2000 条事件上限';continue}
  try {
   $events=@(Get-WinEvent -FilterHashtable @{LogName=$log;StartTime=$start;EndTime=$end} -MaxEvents ($remaining+1) -ErrorAction Stop)
   $truncated=$events.Count -gt $remaining
   foreach($event in ($events | Select-Object -First $remaining)) {
    $xml=[xml]$event.ToXml();$fields=@{};$index=0
    foreach($data in $xml.Event.EventData.Data) {
     if($index -ge 128){break}
     $key=[string]$data.Name;if(!$key){$key='data'+$index}
     if($key.Length -gt 128){$key=$key.Substring(0,128)}
     $v=[string]$data.'#text';if($v.Length -gt 4096){$v=$v.Substring(0,4096)}
     $fields[$key]=$v;$index++
    }
    $fields['eventXml']=$event.ToXml()
    $entity=$null;foreach($key in @('AppName','FaultingApplicationName','DeviceInstanceId','DeviceName')) {if($fields.ContainsKey($key)){$entity=$fields[$key];break}}
    $eventBoot=$null
    if($boot -and $event.TimeCreated.ToUniversalTime() -ge [DateTime]::Parse($boot).ToUniversalTime()){$eventBoot=$boot}
    AddEvidence 'windows.event' ('event-'+$log.Replace('/','_')+'-'+$event.RecordId) ($event.TimeCreated.ToUniversalTime().ToString('o')) ([string]$event.ProviderName) $log ([int]$event.Id) ([int]$event.Version) ([long]$event.RecordId) $entity $fields $eventBoot
   }
   $remaining-=[Math]::Min($events.Count,$remaining)
   Cover $log $(if($truncated){'truncated'}elseif($events.Count){'available'}else{'empty'}) '按时间窗口读取；空结果不代表没有故障'
  } catch {Cover $log (ErrorStatus $_) '事件窗口查询状态；未修改系统策略或日志设置'}
 }
} elseif($request.action -eq 'audit.memory_configuration') {
 try {
  foreach($q in @(
   @{class='Win32_ComputerSystem';properties=@('Manufacturer','Model')},
   @{class='Win32_BaseBoard';properties=@('Manufacturer','Product')},
   @{class='Win32_Processor';properties=@('Name','NumberOfCores','NumberOfLogicalProcessors')},
   @{class='Win32_VideoController';properties=@('Name','DriverVersion','DriverDate','AdapterRAM')},
   @{class='Win32_OperatingSystem';properties=@('Caption','Version','BuildNumber','OSArchitecture','TotalVisibleMemorySize')},
   @{class='Win32_DiskDrive';properties=@('Model','Size','InterfaceType')},
   @{class='Win32_SoundDevice';properties=@('Name')},
   @{class='Win32_NetworkAdapter';properties=@('Name','PhysicalAdapter')}
  )) {
   try {
    $srows=@(Get-CimInstance -ClassName $q.class -Property $q.properties)
    $si=0;foreach($srow in $srows){$sfields=@{};foreach($p in $q.properties){$sfields[$p]=[string]$srow.$p};AddEvidence 'system.snapshot' ($q.class+'-'+$si) ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null $q.class $sfields $boot;$si++}
   } catch {}
  }
  $rows=@(Get-CimInstance -ClassName Win32_PhysicalMemory -Property ConfiguredClockSpeed,Speed,DeviceLocator,BankLabel,Capacity,SMBIOSMemoryType,Manufacturer | Select-Object -First 129)
  $i=0;foreach($row in ($rows|Select-Object -First 128)) {
   AddEvidence 'setup.memory' ('memory-'+$i) ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null ('memory-module-'+$i) @{configuredClockSpeed=[string]$row.ConfiguredClockSpeed;reportedSpeed=[string]$row.Speed;speedUnit='SMBIOS_reported_MHz';memoryType=[string]$row.SMBIOSMemoryType;capacityBytes=[string]$row.Capacity;deviceLocator=[string]$row.DeviceLocator;bankLabel=[string]$row.BankLabel;manufacturer=[string]$row.Manufacturer;profileState='unknown';channelState='unknown'} $null;$i++
  }
  Cover 'audit.memory_configuration' $(if($rows.Count -gt 128){'truncated'}elseif($rows.Count){'available'}else{'empty'}) 'SMBIOS 配置速率与位置声明；XMP/EXPO 开关与实际通道未由此接口验证'
 } catch {Cover 'audit.memory_configuration' (ErrorStatus $_) '内存配置查询未完整完成'}
} elseif($request.action -eq 'audit.power_game_settings') {
 try {
  $output=& (Join-Path $env:SystemRoot 'System32\powercfg.exe') /getactivescheme
  if($LASTEXITCODE -ne 0){throw 'Power query failed'}
  $guid=[regex]::Match(($output -join ' '),'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value.ToLowerInvariant()
  if(!$guid){throw 'Power scheme GUID missing'}
  $game='unknown';$hags='unknown'
  try {$v=Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\GameBar' -Name AutoGameModeEnabled -ErrorAction Stop;if($v -eq 1){$game='enabled'}elseif($v -eq 0){$game='disabled'}}catch{}
  try {$v=Get-ItemPropertyValue -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name HwSchMode -ErrorAction Stop;if($v -eq 2){$hags='enabled'}elseif($v -eq 1){$hags='disabled'}}catch{}
  AddEvidence 'setup.power' 'active-power' ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null 'current-system' @{schemeGuid=$guid;gameModeConfigured=$game;hagsConfigured=$hags;effectiveGameState='unknown';policyLocked='unknown'} $null
  Cover 'audit.power_game_settings' 'available' '活动计划 GUID；游戏/HAGS 配置值不证明支持或已生效，也不证明被策略锁定'
 } catch {Cover 'audit.power_game_settings' (ErrorStatus $_) '电源查询未完整完成'}
} elseif($request.action -eq 'audit.pcie_disk_capacity') {
 try {
  $windows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  $drive=[System.IO.Path]::GetPathRoot($windows).TrimEnd('\')
  if($drive -notmatch '^[A-Za-z]:$'){throw 'System volume unknown'}
  $disk=Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='"+$drive+"'") -Property Size,FreeSpace,DeviceID
  if(!$disk){throw 'System volume missing'}
  AddEvidence 'setup.disk_capacity' 'system-volume' ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null 'system-volume' @{volumeRole='system';volume=[string]$disk.DeviceID;totalBytes=[string]$disk.Size;freeBytes=[string]$disk.FreeSpace} $null
  Cover 'audit.system_disk_capacity' 'available' '实际 Windows 系统卷空间；10% 仅为提醒阈值'
 }catch{Cover 'audit.system_disk_capacity' (ErrorStatus $_) '系统卷容量不可读'}
 Cover 'audit.pcie_link' 'unsupported' '本轮未实现可靠的设备/插槽上限与链路采样，不据空闲低速判断瓶颈'
} elseif($request.action -eq 'audit.refresh_rate') {
 try {
  $rows=@(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorListedSupportedSourceModes | Where-Object {$_.Active} | Select-Object -First 33)
  $methods=@();try{$methods=@(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorDescriptorMethods)}catch{}
  $i=0;foreach($row in ($rows|Select-Object -First 32)) {
   $modes=@($row.MonitorSourceModes|Select-Object -First 256|ForEach-Object {@{width=[int]$_.HorizontalActivePixels;height=[int]$_.VerticalActivePixels;numerator=[int]$_.VerticalRefreshRateNumerator;denominator=[int]$_.VerticalRefreshRateDenominator;interlaced=[bool]$_.IsInterlaced}})
   $hex='';$edidState='unavailable'
   $method=$methods|Where-Object {$_.InstanceName -eq $row.InstanceName}|Select-Object -First 1
   if($method){try{
    $base=Invoke-CimMethod -InputObject $method -MethodName WmiGetMonitorRawEEdidV1Block -Arguments @{BlockId=[byte]0}
    $bytes=New-Object System.Collections.Generic.List[byte]
    if($base.BlockContent.Count -eq 128){$bytes.AddRange([byte[]]$base.BlockContent);$blocks=[Math]::Min([int]$base.BlockContent[126],8)
     for($block=1;$block -le $blocks;$block++){$part=Invoke-CimMethod -InputObject $method -MethodName WmiGetMonitorRawEEdidV1Block -Arguments @{BlockId=[byte]$block};if($part.BlockContent.Count -ne 128){throw 'Incomplete EDID'};$bytes.AddRange([byte[]]$part.BlockContent)}
     $hex=-join ($bytes.ToArray()|ForEach-Object{$_.ToString('X2')});$edidState='read'
    }
   }catch{$edidState='unavailable';$hex=''}}
   AddEvidence 'setup.monitor_modes' ('monitor-modes-'+$i) ([DateTime]::UtcNow.ToString('o')) $null $null $null $null $null $null @{monitorInstance=[string]$row.InstanceName;sourceModesJson=(ConvertTo-Json -InputObject $modes -Depth 4 -Compress);edidHex=$hex;edidState=$edidState;modesTruncated=[string]($row.MonitorSourceModes.Count -gt 256)} $null;$i++
  }
  Cover 'audit.refresh_rate' $(if($rows.Count -gt 32){'truncated'}elseif($rows.Count){'available'}else{'empty'}) 'WMI 描述模式和可读取 EDID，需与同屏当前活动路径关联；未承诺所有连接均支持高刷'
 }catch{Cover 'audit.refresh_rate' (ErrorStatus $_) '监视器模式不可读'}
} else {throw 'Unsupported fixed action'}
@{evidence=@($evidence.ToArray());coverage=@($coverage.ToArray())} | ConvertTo-Json -Depth 12 -Compress
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collection {
    pub evidence: Vec<Evidence>,
    pub coverage: Vec<Coverage>,
}
pub fn system_directory() -> Result<PathBuf> {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
        }
        let mut buffer = vec![0u16; 32768];
        let n = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if n == 0 || n as usize >= buffer.len() {
            return Err("无法解析可信系统目录。".into());
        }
        Ok(PathBuf::from(String::from_utf16_lossy(
            &buffer[..n as usize],
        )))
    }
    #[cfg(not(windows))]
    {
        Err("本机采集仅支持 Windows。".into())
    }
}
#[cfg(windows)]
pub(crate) fn hardware_graphics() -> Option<Vec<crate::hardware::HardwareItem>> {
    display::hardware_graphics()
}
pub fn collect(
    action: &crate::diagnostics::ActionSpec,
    start: &str,
    end: &str,
    cancel: &Cancellation,
) -> Result<(ProcessOutput, Option<Collection>)> {
    if action.action_id == "audit.display_routing" {
        #[cfg(windows)]
        {
            let collection = display::collect(cancel)?;
            return Ok((
                ProcessOutput {
                    status: if cancel.is_cancelled() {
                        "cancelled"
                    } else {
                        "completed"
                    }
                    .into(),
                    exit_code: None,
                    stdout: vec![],
                    stderr: vec![],
                },
                if cancel.is_cancelled() {
                    None
                } else {
                    Some(collection)
                },
            ));
        }
        #[cfg(not(windows))]
        {
            return Err("显示路径采集仅支持 Windows。".into());
        }
    }
    if action.action_id == "audit.thermal_power_limits" {
        return Ok((
            ProcessOutput {
                status: "completed".into(),
                exit_code: None,
                stdout: vec![],
                stderr: vec![],
            },
            Some(Collection {
                evidence: vec![],
                coverage: vec![Coverage {
                    source: action.action_id.clone(),
                    status: "unsupported".into(),
                    detail: "没有已验证的只读 CPU/GPU 节流传感器；未安装驱动、启动外部工具或烤机。"
                        .into(),
                }],
            }),
        ));
    }
    if ![
        "windows.system_snapshot",
        "windows.event_window",
        "usb_pnp.snapshot",
        "audit.refresh_rate",
        "audit.memory_configuration",
        "audit.power_game_settings",
        "audit.pcie_disk_capacity",
    ]
    .contains(&action.action_id.as_str())
    {
        return Err("采集动作未注册。".into());
    }
    let system = system_directory()?;
    let executable = system.join(r"WindowsPowerShell\v1.0\powershell.exe");
    let script_dir = std::env::temp_dir().join(format!("sentinel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&script_dir).map_err(|_| "无法创建采集工作目录。")?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0.join("collector.ps1"));
            let _ = std::fs::remove_dir(&self.0);
        }
    }
    let _cleanup = Cleanup(script_dir.clone());
    let script_path = script_dir.join("collector.ps1");
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&script_path)
        .map_err(|_| "无法写入固定采集脚本。")?;
    file.write_all(b"\xEF\xBB\xBF")
        .and_then(|_| file.write_all(SCRIPT.as_bytes()))
        .and_then(|_| file.sync_all())
        .map_err(|_| "固定脚本写入失败。")?;
    drop(file);
    // Deny writes/deletion while PowerShell reads the immutable, embedded script.
    let (_script_guard, _) = crate::artifacts::open_source(&script_path, 1024 * 1024)?;
    let mut command = Command::new(&executable);
    command
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-File"])
        .arg(&script_path)
        .current_dir(&system);
    command
        .env_clear()
        .env("SystemRoot", system.parent().ok_or("系统目录无效。")?)
        .env("PATH", &system)
        // PowerShell 5.1 needs PATHEXT even for a fixed absolute .exe path.
        // Keep native executable recognition without inheriting script extensions or user PATH.
        .env("PATHEXT", ".EXE;.COM")
        .env("TEMP", &script_dir)
        .env("TMP", &script_dir);
    let input =
        serde_json::to_vec(&serde_json::json!({"action":action.action_id,"start":start,"end":end}))
            .map_err(|_| "采集参数无效。")?;
    let output = runner::execute(
        command,
        input,
        Duration::from_secs(action.estimated_seconds as u64),
        action.output_limit_bytes,
        cancel,
    )?;
    let collection = if output.status == "completed" {
        Some(normalize(&output.stdout)?)
    } else {
        None
    };
    Ok((output, collection))
}
pub fn normalize(bytes: &[u8]) -> Result<Collection> {
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("采集结果超限。".into());
    }
    let mut collection: Collection =
        serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
            .map_err(|_| "采集结果不是预期结构。")?;
    if collection.evidence.len() > 2512 || collection.coverage.len() > 16 {
        return Err("采集条目超限。".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for e in &mut collection.evidence {
        if !ids.insert(e.id.clone())
            || ![
                "windows.event",
                "system.snapshot",
                "device.snapshot",
                "setup.memory",
                "setup.power",
                "setup.disk_capacity",
                "setup.monitor_modes",
            ]
            .contains(&e.kind.as_str())
            || e.source != "windows:local"
            || e.fields.len() > 130
            || e.fields
                .iter()
                .any(|(k, v)| k.len() > 256 || v.len() > 128 * 1024)
        {
            return Err("采集证据不符合契约。".into());
        }
        e.fields
            .insert("measurementOrigin".into(), "native_collected".into());
        if e.kind == "setup.monitor_modes" {
            if let Some(raw) = e.fields.remove("monitorInstance") {
                e.fields.insert("monitorKey".into(), monitor_key(&raw));
            }
            if let Some(hex) = e.fields.remove("edidHex") {
                let parsed = decode_edid_hex(&hex).and_then(|bytes| parse_edid_modes(&bytes).ok());
                match parsed {
                    Some(modes) => {
                        e.fields.insert(
                            "edidModesJson".into(),
                            serde_json::to_string(&modes).map_err(|_| "EDID 时序编码失败。")?,
                        );
                        e.fields.insert(
                            "edidParseState".into(),
                            "partial_detailed_timings_only".into(),
                        );
                    }
                    None => {
                        e.fields
                            .insert("edidParseState".into(), "unavailable_or_invalid".into());
                    }
                }
            }
        }
    }
    if collection.coverage.iter().any(|c| {
        ![
            "available",
            "empty",
            "permission_denied",
            "failed",
            "unsupported",
            "truncated",
        ]
        .contains(&c.status.as_str())
    }) {
        return Err("采集覆盖状态无效。".into());
    }
    Ok(collection)
}
pub fn monitor_key(raw: &str) -> String {
    use sha2::{Digest, Sha256};
    let upper = raw.to_uppercase();
    let s = upper.strip_prefix(r"\\?\").unwrap_or(&upper);
    let s = if s.contains('#') {
        s.split('#').take(3).collect::<Vec<_>>().join("\\")
    } else {
        match s.rsplit_once('_') {
            Some((base, index))
                if !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()) =>
            {
                base.to_string()
            }
            _ => s.to_string(),
        }
    };
    format!("monitor:{:x}", Sha256::digest(s.as_bytes()))
}
fn decode_edid_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.is_empty() || hex.len() > 9 * 128 * 2 || hex.len() % 2 != 0 || !hex.is_ascii() {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    #[ignore = "explicit opt-in: reads local Windows hardware/settings, never contacts a model"]
    fn windows_setup_audit_read_only_smoke() {
        let mut evidence = vec![];
        let mut coverage = vec![];
        for action in crate::diagnostics::setup_audit_actions() {
            let now = chrono::Utc::now().to_rfc3339();
            let (process, collection) =
                collect(&action, &now, &now, &Cancellation::default()).unwrap();
            let c = collection.unwrap_or_else(|| {
                panic!(
                    "{}: {} {:?}",
                    action.action_id, process.status, process.exit_code
                )
            });
            assert!(!c.coverage.is_empty());
            assert!(c.evidence.iter().all(|e| {
                e.source == "windows:local"
                    && e.fields
                        .get("measurementOrigin")
                        .is_some_and(|v| v == "native_collected")
            }));
            assert!(
                c.evidence.iter().all(|e| !e.fields.contains_key("edidHex")
                    && !e.fields.contains_key("monitorInstance"))
            );
            println!(
                "{}: {:?}, evidence_count={}",
                action.action_id,
                c.coverage
                    .iter()
                    .map(|v| (&v.source, &v.status))
                    .collect::<Vec<_>>(),
                c.evidence.len()
            );
            evidence.extend(c.evidence);
            coverage.extend(c.coverage);
        }
        let now = chrono::Utc::now().to_rfc3339();
        let report =
            crate::rules::analyze_evidence(evidence, coverage, &now, &now, vec![]).unwrap();
        assert!(
            crate::diagnostics::AUDIT_ACTION_IDS
                .iter()
                .all(|id| report.audit_checks.iter().any(|c| &c.check_id == id))
        );
        println!(
            "audit assessments: {:?}",
            report
                .audit_checks
                .iter()
                .map(|c| (&c.metric, &c.assessment))
                .collect::<Vec<_>>()
        );
        assert!(report.findings.iter().all(|f| {
            f.evidence_ids
                .iter()
                .all(|id| report.evidence.iter().any(|e| &e.id == id))
        }));
    }
    #[test]
    fn monitor_matching_is_case_insensitive_and_keeps_distinct_instance_suffixes() {
        assert_eq!(
            monitor_key(r"DISPLAY\ABC123\4&1&0&UID12_0"),
            monitor_key(r"\\?\display#abc123#4&1&0&uid12#{guid}")
        );
        assert_ne!(
            monitor_key(r"\\?\display#abc123#UID_0#{guid}"),
            monitor_key(r"\\?\display#abc123#UID_1#{guid}")
        );
        assert!(!monitor_key(r"DISPLAY\ABC123\private_serial_0").contains("private_serial"));
    }
    #[test]
    fn normalized_empty_and_denied_are_distinct() {
        let c=normalize(br#"{"evidence":[],"coverage":[{"source":"System","status":"empty","detail":"none"},{"source":"Application","status":"permission_denied","detail":"denied"}]}"#).unwrap();
        assert_ne!(c.coverage[0].status, c.coverage[1].status);
        assert!(normalize(br#"{"evidence":[],"coverage":[{"source":"x","status":"passed","detail":"invented"}]}"#).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn fixed_powershell_script_has_no_syntax_errors_and_is_not_executed() {
        let system = system_directory().unwrap();
        let mut c = Command::new(system.join(r"WindowsPowerShell\v1.0\powershell.exe"));
        c.args(["-NoProfile","-NonInteractive","-Command", "[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false);$text=[Console]::In.ReadToEnd();$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){$errors|ForEach-Object{$_.Message}|Write-Output;exit 7};exit 0"]);
        let r = runner::execute(
            c,
            SCRIPT.as_bytes().to_vec(),
            Duration::from_secs(10),
            4096,
            &Cancellation::default(),
        )
        .unwrap();
        assert_eq!(r.exit_code, Some(0), "{:?}", r);
    }
}
