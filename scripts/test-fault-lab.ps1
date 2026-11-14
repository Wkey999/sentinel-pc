param([switch]$Full)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME=Join-Path $projectRoot '.tools\cargo'
$env:RUSTUP_HOME=Join-Path $projectRoot '.tools\rustup'
$env:PATH=(Join-Path $env:CARGO_HOME 'bin')+';'+$env:PATH
function Invoke-Logged([string]$Program,[string[]]$Arguments,[string]$Log) {
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try { & $Program @Arguments *> $Log; return $LASTEXITCODE }
    finally {$ErrorActionPreference=$previous}
}
Push-Location $projectRoot
try {
    $stamp=[DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)
    $output=Join-Path $projectRoot ('private-reports\fault-lab\'+$stamp)
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $jsonPath=Join-Path $output 'results.json'
    $labExit=Invoke-Logged cargo @('run','-p','sentinel-core','--example','fault_lab','--locked','--',$jsonPath) (Join-Path $output 'replay.txt')
    if($labExit -ne 0){throw "Fault replay failed; see $output\replay.txt"}
    $rows=Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $lines=@('# 四类故障合成回放报告','','全部数据来自合成样本；没有运行 Windows 采集器、压力测试或模型，也没有打开真实案例数据库。','',"回放场景：$($rows.Count) / $($rows.Count) 通过（Rust 中执行预期断言）。",'','| 场景 | 预期观察数 | 状态 |','| --- | ---: | --- |')
    foreach($row in $rows){$lines+='| '+$row.title+' | '+$row.completed.report.findings.Count+' | '+$row.completed.status+' |'}
    $lines+=@('','测试覆盖真实 Rust 规则、smartctl 样本解析、内存数据库案例/计划/授权/报告/导出/重命名/删除。浏览器界面传输由开发页单独模拟。','','边界：没有 FPS/帧时间采集；没有 Disk 157 专用规则；没有 dump 根因分析；当前 PnP 快照不等于历史断连追踪。')
    if($Full) {
        $rustExit=Invoke-Logged cargo @('test','--workspace','--locked') (Join-Path $output 'rust-tests.txt')
        $tsExit=Invoke-Logged npm.cmd @('run','check') (Join-Path $output 'frontend-tests.txt')
        $lines+="`n全量回归退出码：Rust=$rustExit；前端=$tsExit。"
    }
    $report=Join-Path $output 'REPORT.md'
    $lines | Set-Content -LiteralPath $report -Encoding UTF8
    Write-Host "Report: $report"
    if($Full -and ($rustExit -ne 0 -or $tsExit -ne 0)){exit 1}
} finally {Pop-Location}
