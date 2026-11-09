$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $here 'gateway.pid'
if (-not (Test-Path $pidFile)) {
  Write-Host '网关没有运行（找不到 gateway.pid）'
  return
}
$old = (Get-Content $pidFile -Raw).Trim()
if ($old -match '^\d+$') {
  Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue
  Write-Host '手机网关已停止'
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
