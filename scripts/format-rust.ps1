$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$localCargo=Join-Path $projectRoot '.tools\cargo'
if(Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:CARGO_HOME=$localCargo
    $env:RUSTUP_HOME=Join-Path $projectRoot '.tools\rustup'
    $env:PATH=(Join-Path $localCargo 'bin')+';'+$env:PATH
}
Push-Location $projectRoot
try { & cargo fmt --all; $result=$LASTEXITCODE } finally { Pop-Location }
exit $result
