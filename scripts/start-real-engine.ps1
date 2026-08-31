$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$modlyApi = Join-Path $runtimeRoot 'modly\api'
$dataRoot = Join-Path $runtimeRoot 'forgecast-engine'
$apiPython = Join-Path $modlyApi '.venv\Scripts\python.exe'
if (!(Test-Path $apiPython)) {
  throw 'Real engine is not installed. Run scripts\setup-real-engine.ps1 first.'
}

$env:EXTENSIONS_DIR = Join-Path $dataRoot 'extensions'
$env:MODELS_DIR = Join-Path $dataRoot 'models'
$env:WORKSPACE_DIR = Join-Path $dataRoot 'workspace'
$env:SELECTED_MODEL_ID = 'hunyuan3d-mini/generate'

Set-Location $modlyApi
& $apiPython -m uvicorn main:app --host 127.0.0.1 --port 8765
