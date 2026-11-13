param([switch]$Live, [switch]$Full, [switch]$OpenReport)
$ErrorActionPreference='Stop'
function Invoke-Logged([string]$Program,[string[]]$Arguments,[string]$Log) {
    # Windows PowerShell 5.1 wraps redirected native stderr in ErrorRecord.
    # Cargo uses stderr for ordinary progress; judge it by exit code instead.
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try { & $Program @Arguments *> $Log; return $LASTEXITCODE }
    finally {$ErrorActionPreference=$previous}
}
$projectRoot=Split-Path -Parent $PSScriptRoot
$localCargo=Join-Path $projectRoot '.tools\cargo'
$localRustup=Join-Path $projectRoot '.tools\rustup'
if(Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:CARGO_HOME=$localCargo
    $env:RUSTUP_HOME=$localRustup
    $env:PATH=(Join-Path $localCargo 'bin')+';'+$env:PATH
}
Push-Location $projectRoot
try {
    if(-not(Get-Command cargo -ErrorAction SilentlyContinue)){throw 'Rust toolchain not available.'}
    if(-not(Get-Command node -ErrorAction SilentlyContinue)){throw 'Node.js 24 is required.'}
    # Timestamped outputs never mix last run's real data into a simulation-only run.
    $stamp=[DateTimeOffset]::Now.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)
    $output=Join-Path $projectRoot ('private-reports\test-lab\'+$stamp)
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $regression='Not run; add -Full to run Rust workspace and TypeScript regression.'
    $regressionFailed=$false
    if($Full) {
        Write-Host 'Running Rust workspace regression...'
        $rustExit=Invoke-Logged -Program cargo -Arguments @('test','--workspace','--locked') -Log (Join-Path $output 'rust-tests.txt')
        Write-Host 'Running TypeScript regression...'
        $tsExit=Invoke-Logged -Program npm.cmd -Arguments @('run','check') -Log (Join-Path $output 'typescript-tests.txt')
        $regression="Rust exit=$rustExit; TypeScript check exit=$tsExit. See rust-tests.txt / typescript-tests.txt."
        $regressionFailed=($rustExit -ne 0 -or $tsExit -ne 0)
    }
    $metadata=@{regression=$regression;releaseSha256='not found';windowsBuild='unknown';isAdmin=$false}
    $release=Join-Path $projectRoot 'target\release\sentinel-pc.exe'
    if(Test-Path -LiteralPath $release){$metadata.releaseSha256=(Get-FileHash -LiteralPath $release -Algorithm SHA256).Hash}
    $version=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name CurrentBuildNumber,UBR
    $metadata.windowsBuild=$version.CurrentBuildNumber+'.'+$version.UBR
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=New-Object Security.Principal.WindowsPrincipal($identity)
    $metadata.isAdmin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $metadata|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $output 'run-metadata.json') -Encoding UTF8
    $labArgs=@('run','-p','sentinel-core','--example','test_lab','--locked','--',$output)
    if($Live){$labArgs+='--live'}
    Write-Host 'Running isolated scenarios...'
    $rulesExit=Invoke-Logged -Program cargo -Arguments $labArgs -Log (Join-Path $output 'lab-execution.txt')
    if($rulesExit -ne 0 -and -not(Test-Path -LiteralPath (Join-Path $output 'scenarios.json'))){throw 'Lab did not generate results.'}
    $contractExit=Invoke-Logged -Program node -Arguments @((Join-Path $PSScriptRoot 'check-test-lab.mjs'),$output) -Log (Join-Path $output 'contract-check.txt')
    $report=Join-Path $output 'TEST_REPORT.md'
    if(-not(Test-Path -LiteralPath $report)){throw "Contract checker did not generate a report; see $output\contract-check.txt"}
    [IO.File]::WriteAllText((Join-Path $projectRoot 'private-reports\test-lab\LATEST.txt'),$report)
    Write-Host "Report: $report"
    if($OpenReport -and (Test-Path -LiteralPath $report)){Start-Process -FilePath $report -WindowStyle Hidden}
    if($rulesExit -ne 0 -or $contractExit -ne 0 -or $regressionFailed){exit 1}
} finally {Pop-Location}
