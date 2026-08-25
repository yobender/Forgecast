$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$modlyApi = Join-Path $runtimeRoot 'modly\api'
$dataRoot = Join-Path $runtimeRoot 'forgecast-engine'
$apiPython = Join-Path $modlyApi '.venv\Scripts\python.exe'
$multiViewInstaller = Join-Path $PSScriptRoot 'install-multiview-model.ps1'
$multiViewModel = Join-Path $dataRoot 'models\hunyuan3d-mini\multiview\hunyuan3d-dit-v2-mv-fast\model.fp16.safetensors'
$multiViewExpectedBytes = 4930777530

if (!(Test-Path $apiPython)) {
  throw 'Real engine is not installed. Run scripts\setup-real-engine.ps1 first.'
}

$multiViewReady = (Test-Path -LiteralPath $multiViewModel) -and (Get-Item -LiteralPath $multiViewModel).Length -eq $multiViewExpectedBytes
if (!$multiViewReady -and (Test-Path -LiteralPath $multiViewInstaller)) {
  $downloadLog = Join-Path $dataRoot 'multiview-download.log'
  $downloadErrorLog = Join-Path $dataRoot 'multiview-download-error.log'
  Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$multiViewInstaller`"" -WindowStyle Hidden -RedirectStandardOutput $downloadLog -RedirectStandardError $downloadErrorLog
}

$env:EXTENSIONS_DIR = Join-Path $dataRoot 'extensions'
$env:MODELS_DIR = Join-Path $dataRoot 'models'
$env:WORKSPACE_DIR = Join-Path $dataRoot 'workspace'
$env:SELECTED_MODEL_ID = 'hunyuan3d-mini/generate'

Set-Location $modlyApi
& $apiPython -m uvicorn main:app --host 127.0.0.1 --port 8765
