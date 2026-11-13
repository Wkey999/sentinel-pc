$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
function Query($class,$namespace='root/cimv2') { @(Get-CimInstance -ClassName $class -Namespace $namespace -OperationTimeoutSec 5 -ErrorAction Stop | Select-Object -First 64) }
function Clean($value) { if($null -eq $value){return ''}; (([string]$value) -replace '[\x00-\x1F]','').Trim() }
function Item($name,$details,$code=0) {
 $problem=($null -ne $code -and [int]$code -ne 0)
 $all=@($details | Where-Object {$_ -and ([string]$_).Trim()})
 if($problem){$all+=('设备状态码 '+[int]$code+'，建议检查驱动或设备管理器')}
 @{name=(Clean $name);details=@($all);problem=$problem}
}
function GiB($n) { if($n -gt 0){'{0:0.#} GiB' -f ([double]$n/1GB)} }
function Decode($numbers) { -join @($numbers | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) }
$groups=New-Object System.Collections.Generic.List[object]
function ReadGroup($id,$label,[scriptblock]$read) {
 try { $items=@(& $read); $groups.Add(@{id=$id;label=$label;status=$(if($items.Count){'available'}else{'empty'});items=@($items)}) }
 catch {$groups.Add(@{id=$id;label=$label;status='unavailable';items=@()})}
}
$model='未读取到电脑型号'; $os='未读取到操作系统信息'
try {$c=Query 'Win32_ComputerSystem' | Select-Object -First 1; $model=(@((Clean $c.Manufacturer),(Clean $c.Model)) | Where-Object {$_}) -join ' '}catch{}
try {$c=Query 'Win32_OperatingSystem' | Select-Object -First 1; $os=('{0} · {1} · Build {2}' -f (Clean $c.Caption),(Clean $c.OSArchitecture),(Clean $c.BuildNumber))}catch{}
ReadGroup 'cpu' '处理器' {
 foreach($c in (Query 'Win32_Processor')) { Item $c.Name @((Clean $c.Manufacturer),('{0} 核 / {1} 线程' -f $c.NumberOfCores,$c.NumberOfLogicalProcessors),$(if($c.MaxClockSpeed){'SMBIOS 标称频率 {0:0.##} GHz（非睿频上限）' -f ($c.MaxClockSpeed/1000)})) }
}
ReadGroup 'baseboard' '主板' {
 foreach($c in (Query 'Win32_BaseBoard')) { Item ((Clean $c.Manufacturer)+' '+(Clean $c.Product)) @($(if($c.Version){'版本 '+(Clean $c.Version)})) }
}
ReadGroup 'memory' '内存' {
 $modules=@(Query 'Win32_PhysicalMemory')
 if($modules.Count){ Item ('总内存 '+((GiB (($modules | Measure-Object Capacity -Sum).Sum)) -replace 'GiB','GB')) @((($modules | ForEach-Object {(GiB $_.Capacity) -replace 'GiB','GB'}) -join ' + ')) }
 foreach($c in $modules) {
  $type=switch([int]$c.SMBIOSMemoryType){24{'DDR3'}26{'DDR4'}30{'LPDDR4'}34{'DDR5'}35{'LPDDR5'}default{'类型未报告'}}
  Item ((Clean $c.Manufacturer)+' '+((GiB $c.Capacity) -replace 'GiB','GB')+' '+$type) @((Clean $c.PartNumber),$(if($c.ConfiguredClockSpeed){'配置速率 '+$c.ConfiguredClockSpeed+' MT/s（SMBIOS 报告）'}),(Clean $c.DeviceLocator))
 }
}
ReadGroup 'graphics' '显卡' {
 foreach($c in (Query 'Win32_VideoController')) { Item $c.Name @((Clean $c.AdapterCompatibility),('驱动 '+(Clean $c.DriverVersion)),'显存容量未读取（不使用可能溢出的 32 位 WMI 值）') $c.ConfigManagerErrorCode }
}
ReadGroup 'monitors' '显示器' {
 $params=@{}; try{foreach($p in (Query 'WmiMonitorBasicDisplayParams' 'root/wmi')){$params[$p.InstanceName]=$p}}catch{}
 foreach($c in (Query 'WmiMonitorID' 'root/wmi' | Where-Object {$_.Active})) {
  $name=Decode $c.UserFriendlyName; $code=Decode $c.ProductCodeID; $maker=Decode $c.ManufacturerName
  if(-not $name){$name='显示器 '+$maker+' '+$code}
  $p=$params[$c.InstanceName]; $diagonal=$null
  if($p -and $p.MaxHorizontalImageSize -gt 0 -and $p.MaxVerticalImageSize -gt 0){$diagonal='{0:0.#} 英寸（EDID 尺寸）' -f ([Math]::Sqrt([Math]::Pow($p.MaxHorizontalImageSize,2)+[Math]::Pow($p.MaxVerticalImageSize,2))/2.54)}
  Item $name @($maker,$code,$diagonal)
 }
}
ReadGroup 'storage' '磁盘' {
 foreach($c in (Query 'Win32_DiskDrive')) { Item $c.Model @((('{0:0} GB（{1}）' -f ($c.Size/1000000000),(GiB $c.Size))),('系统报告接口 '+(Clean $c.InterfaceType))) $c.ConfigManagerErrorCode }
 foreach($c in (Query 'Win32_LogicalDisk' | Where-Object {$_.DriveType -eq 3})) {
  $system=($c.DeviceID -eq [IO.Path]::GetPathRoot($env:SystemRoot).TrimEnd('\'))
  $low=($c.Size -gt 0 -and $c.FreeSpace/$c.Size -lt 0.1)
  $details=@('可用 '+(GiB $c.FreeSpace)+' / 总计 '+(GiB $c.Size))
  if($low){$details+='剩余空间不足 10%，建议清理空间'}
  @{name=($(if($system){'系统分区 '}else{'分区 '})+$c.DeviceID);details=$details;problem=$low}
 }
}
ReadGroup 'npu' 'NPU / AI 加速器' {
 foreach($c in (Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='ComputeAccelerator' OR Name LIKE '%NPU%' OR Name LIKE '%AI Boost%' OR Name LIKE '%Neural%'" -OperationTimeoutSec 5 -ErrorAction Stop | Where-Object {$_.PNPClass -eq 'ComputeAccelerator' -or $_.Name -match '(?i)\b(NPU|AI Boost|Neural)\b'} | Select-Object -First 64)) { Item $c.Name @((Clean $c.Manufacturer),'Windows 枚举的 AI 加速设备') $c.ConfigManagerErrorCode }
}
ReadGroup 'audio' '声卡与音频设备' {
 foreach($c in (Query 'Win32_SoundDevice')) { Item $c.Name @((Clean $c.Manufacturer)) $c.ConfigManagerErrorCode }
}
ReadGroup 'network' '网卡' {
 foreach($c in (Query 'Win32_NetworkAdapter' | Where-Object {$_.PhysicalAdapter -and $_.PNPDeviceID -match '^(PCI|USB|SD)\\'})) { Item $c.Name @((Clean $c.Manufacturer),$(if($c.NetEnabled){'已启用'}else{'未连接或未启用'})) $c.ConfigManagerErrorCode }
}
ReadGroup 'bios' 'BIOS / 固件' {
 foreach($c in (Query 'Win32_BIOS')) { Item $c.SMBIOSBIOSVersion @((Clean $c.Manufacturer),$(if($c.ReleaseDate){'发布日期 '+$c.ReleaseDate.ToString('yyyy-MM-dd')})) }
}
@{origin='windows_native';collectedAtUtc=[DateTime]::UtcNow.ToString('o');computerModel=$model;operatingSystem=$os;groups=@($groups.ToArray())} | ConvertTo-Json -Depth 8 -Compress
