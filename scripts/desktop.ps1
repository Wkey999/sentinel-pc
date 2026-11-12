param(
    [Parameter(Position=0)][ValidateSet('dev','build','test','check')][string]$Action = 'dev'
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$localCargo=Join-Path $projectRoot '.tools\cargo'
$localRustup=Join-Path $projectRoot '.tools\rustup'
if(Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:CARGO_HOME=$localCargo
    $env:RUSTUP_HOME=$localRustup
    $env:PATH=(Join-Path $localCargo 'bin')+';'+$env:PATH
}
if(-not(Get-Command cargo -ErrorAction SilentlyContinue)){ throw 'Rust MSVC is required. See docs/ENVIRONMENT.md.' }
Push-Location $projectRoot
try {
    if($Action -eq 'test') {
        & cargo test -p sentinel-core --locked
    } elseif($Action -eq 'check') {
        & cargo check --workspace --locked
    } elseif($Action -eq 'build') {
        & npm.cmd exec -- tauri build --debug --no-bundle
    } else {
        & npm.cmd exec -- tauri dev
    }
    $result=$LASTEXITCODE
} finally { Pop-Location }
exit $result
