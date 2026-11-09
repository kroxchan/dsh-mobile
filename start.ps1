param(
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'node.exe'
$server = Join-Path $here 'server.mjs'
$outLog = Join-Path $here 'stdout.log'
$errLog = Join-Path $here 'stderr.log'
$pidFile = Join-Path $here 'gateway.pid'

function Test-Gateway {
  try {
    $r = Invoke-WebRequest 'http://127.0.0.1:19000/' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -ge 200)
  } catch {
    if ($_.Exception.Response -ne $null) { return $true }  # 401/429 也算在跑
    return $false
  }
}

if (Test-Gateway) {
  if (-not $Restart) {
    Write-Host "网关已在运行: http://127.0.0.1:19000"
    return
  }
  if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -Raw
    if ($old -match '^\d+$') { Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 800
}

$p = Start-Process -FilePath $node -ArgumentList @($server) -WorkingDirectory $here -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
Start-Sleep -Seconds 2

if (Test-Gateway) {
  Write-Host "网关已启动: http://127.0.0.1:19000 (PID $($p.Id))"
} else {
  Write-Warning "网关可能未启动，请看 $errLog"
  Get-Content $errLog -Tail 10 -ErrorAction SilentlyContinue
}
