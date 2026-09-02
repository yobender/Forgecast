$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$modlyApi = Join-Path $runtimeRoot 'modly\api'
$dataRoot = Join-Path $runtimeRoot 'forgecast-engine'
$apiPython = Join-Path $modlyApi '.venv\Scripts\python.exe'
if (!(Test-Path $apiPython)) {
  throw 'Real engine is not installed. Run scripts\setup-real-engine.ps1 first.'
}

# Keep an existing runtime checkout current after a normal Forgecast update.
# This lightweight patch does not reinstall Python or redownload checkpoints.
$sourceExtension = Join-Path $runtimeRoot 'modly-hunyuan3d-mini-extension'
$installedExtension = Join-Path $dataRoot 'extensions\hunyuan3d-mini'
$multiViewPatches = @(
  (Join-Path $projectRoot 'scripts\patches\hunyuan-extension-multiview-node.patch'),
  (Join-Path $projectRoot 'scripts\patches\hunyuan-extension-multiview-v2.patch')
)
if (Test-Path (Join-Path $sourceExtension '.git')) {
  foreach ($multiViewPatch in $multiViewPatches) {
    if (!(Test-Path $multiViewPatch)) { throw "Missing Forgecast runtime patch: $multiViewPatch" }
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git -C $sourceExtension apply --recount --check $multiViewPatch 2>$null
    $canApply = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousErrorPreference
    if ($canApply) {
      & git -C $sourceExtension apply --recount $multiViewPatch
      if ($LASTEXITCODE -ne 0) { throw "Could not apply Forgecast runtime patch: $multiViewPatch" }
    } else {
      $previousErrorPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & git -C $sourceExtension apply --recount --reverse --check $multiViewPatch 2>$null
      $alreadyApplied = $LASTEXITCODE -eq 0
      $ErrorActionPreference = $previousErrorPreference
      if (!$alreadyApplied) { throw 'The installed Hunyuan Mini source does not match the Forgecast multi-view update.' }
    }
  }
  Copy-Item -Path (Join-Path $sourceExtension '*') -Destination $installedExtension -Recurse -Force
}

$env:EXTENSIONS_DIR = Join-Path $dataRoot 'extensions'
$env:MODELS_DIR = Join-Path $dataRoot 'models'
$env:WORKSPACE_DIR = Join-Path $dataRoot 'workspace'
$env:SELECTED_MODEL_ID = 'hunyuan3d-mini/generate'

Set-Location $modlyApi
& $apiPython -m uvicorn main:app --host 127.0.0.1 --port 8765
