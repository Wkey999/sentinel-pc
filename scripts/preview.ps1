param([switch]$OpenBrowser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(-not(Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
    throw 'Build the frontend first: npm run build'
}
$node=(Get-Command node -ErrorAction Stop).Source
$previewUrl='http://127.0.0.1:1421/'
$ready=$false
try { $response=Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2; $ready=$response.Content -match 'Sentinel PC' } catch {}
if(-not $ready) {
    $cache=Join-Path $projectRoot '.cache'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $process=Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','1421','--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $cache 'preview.stdout.log') -RedirectStandardError (Join-Path $cache 'preview.stderr.log') -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $cache 'preview.pid')
    for($attempt=0;$attempt -lt 20;$attempt++) {
        try { $response=Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 1; if($response.Content -match 'Sentinel PC') {$ready=$true;break} } catch {}
        Start-Sleep -Milliseconds 250
    }
}
if(-not $ready){throw 'Preview did not start. See .cache/preview.stderr.log; port 1421 may be occupied.'}
Write-Output $previewUrl
if($OpenBrowser){Start-Process $previewUrl}
