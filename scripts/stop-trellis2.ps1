$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$markerPath = Join-Path $projectRoot '.runtime\trellis2.json'
if (!(Test-Path $markerPath)) { exit 0 }
$config = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
$distro = [string]$config.distro
& wsl.exe -d $distro -- bash -lc "pkill -f 'backend/trellis2_server.py' || true"
exit 0
