$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$sourceRoot = Join-Path $runtimeRoot 'sources\Hunyuan3D-2.1'
$pythonExe = Join-Path $runtimeRoot 'venvs\hunyuan3d-2.1\Scripts\python.exe'
$server = Join-Path $projectRoot 'backend\hunyuan21_server.py'

if (!(Test-Path $pythonExe)) {
  throw 'Hunyuan3D 2.1 is not installed. Run scripts\setup-hunyuan21.ps1 first.'
}
if (!(Test-Path (Join-Path $sourceRoot 'hy3dshape'))) {
  throw 'The pinned Hunyuan3D 2.1 source checkout is missing. Run setup-hunyuan21.ps1 again.'
}

$env:FORGECAST_HUNYUAN21_SOURCE = $sourceRoot
$env:FORGECAST_HUNYUAN21_OUTPUTS = Join-Path $runtimeRoot 'forgecast-engine\hunyuan3d-2.1\outputs'
$env:HF_HOME = Join-Path $runtimeRoot 'models\huggingface'
$env:PYTORCH_CUDA_ALLOC_CONF = 'expandable_segments:True'

New-Item -ItemType Directory -Force $env:FORGECAST_HUNYUAN21_OUTPUTS | Out-Null
& $pythonExe $server --host 127.0.0.1 --port 8081
