$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$sourceRoot = Join-Path $runtimeRoot 'sources\Hunyuan3D-2.1'
$venvRoot = Join-Path $runtimeRoot 'venvs\hunyuan3d-2.1'
$pythonExe = Join-Path $venvRoot 'Scripts\python.exe'
$paintRoot = Join-Path $sourceRoot 'hy3dpaint'
$customRasterizerRoot = Join-Path $paintRoot 'custom_rasterizer'
$rendererRoot = Join-Path $paintRoot 'DifferentiableRenderer'
$realEsrganPath = Join-Path $paintRoot 'ckpt\RealESRGAN_x4plus.pth'
$rasterizerBuildHelper = Join-Path $projectRoot 'backend\build_custom_rasterizer.py'
$meshBuildHelper = Join-Path $projectRoot 'backend\build_mesh_inpaint.py'
$paintVerifyHelper = Join-Path $projectRoot 'backend\verify_hunyuan_paint.py'
$pinnedCommit = '82920d643c0dc2f7bfd7255f45f62d386edfe60c'

function Assert-LastCommand([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is required. Install Git for Windows, then run this installer again.'
}
if (!(Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'Python 3.10 is required. Install it from python.org with the py launcher enabled.'
}
& py -3.10 -c 'import sys; assert sys.version_info[:2] == (3, 10)'
Assert-LastCommand 'Python 3.10 check'

if (!(Test-Path (Join-Path $sourceRoot '.git'))) {
  New-Item -ItemType Directory -Force (Split-Path $sourceRoot -Parent) | Out-Null
  & git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git $sourceRoot
  Assert-LastCommand 'Hunyuan3D 2.1 clone'
}
$head = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($head -ne $pinnedCommit) {
  & git -C $sourceRoot fetch --depth 1 origin $pinnedCommit
  Assert-LastCommand 'Hunyuan3D 2.1 pinned version fetch'
  & git -C $sourceRoot checkout --detach $pinnedCommit
  Assert-LastCommand 'Hunyuan3D 2.1 pinned version checkout'
}

if (!(Test-Path $pythonExe)) {
  New-Item -ItemType Directory -Force (Split-Path $venvRoot -Parent) | Out-Null
  & py -3.10 -m venv $venvRoot
  Assert-LastCommand 'Hunyuan3D 2.1 environment creation'
}

& $pythonExe -m pip install --upgrade pip
Assert-LastCommand 'pip upgrade'
& $pythonExe -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
Assert-LastCommand 'CUDA PyTorch installation'
& $pythonExe -m pip install -r (Join-Path $projectRoot 'backend\requirements-hunyuan21.txt')
Assert-LastCommand 'Hunyuan3D 2.1 shape and paint dependencies'

$vsDevCmd = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat'
if (!(Test-Path $vsDevCmd)) {
  throw 'Visual Studio 2022 C++ build tools are required for Hunyuan3D Paint.'
}
$cudaRoot = @(
  'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4',
  'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.0'
) | Where-Object { Test-Path (Join-Path $_ 'bin\nvcc.exe') } | Select-Object -First 1
if (!$cudaRoot) {
  throw 'CUDA Toolkit 12.x with nvcc is required for Hunyuan3D Paint.'
}

$env:CUDA_HOME = $cudaRoot
$env:TORCH_CUDA_ARCH_LIST = '8.9'
$env:MAX_JOBS = '4'
$env:HF_HOME = Join-Path $runtimeRoot 'models\huggingface'
New-Item -ItemType Directory -Force $env:HF_HOME | Out-Null
$rasterizerBuildTemp = Join-Path $runtimeRoot 'build\hunyuan3d-paint-rasterizer'
$rasterizerCommand = "call `"$vsDevCmd`" -no_logo -arch=x64 -host_arch=x64 >nul && set `"CUDA_HOME=$cudaRoot`" && set `"TORCH_CUDA_ARCH_LIST=8.9`" && set `"MAX_JOBS=4`" && set `"DISTUTILS_USE_SDK=1`" && `"$pythonExe`" `"$rasterizerBuildHelper`" --root `"$customRasterizerRoot`" --temp `"$rasterizerBuildTemp`""
& cmd.exe /d /s /c $rasterizerCommand
Assert-LastCommand 'Hunyuan3D Paint CUDA rasterizer build'

$meshSource = Join-Path $rendererRoot 'mesh_inpaint_processor.cpp'
$meshBuildTemp = Join-Path $runtimeRoot 'build\hunyuan3d-paint-mesh-inpaint'
$meshCommand = "call `"$vsDevCmd`" -no_logo -arch=x64 -host_arch=x64 >nul && `"$pythonExe`" `"$meshBuildHelper`" --source `"$meshSource`" --output `"$rendererRoot`" --temp `"$meshBuildTemp`""
& cmd.exe /d /s /c $meshCommand
Assert-LastCommand 'Hunyuan3D Paint mesh inpainting helper build'

if (!(Test-Path $realEsrganPath)) {
  New-Item -ItemType Directory -Force (Split-Path $realEsrganPath -Parent) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth' -OutFile $realEsrganPath
}

$env:PYTHONPATH = "$sourceRoot;$paintRoot;$customRasterizerRoot"
& $pythonExe $paintVerifyHelper --source $sourceRoot
Assert-LastCommand 'Hunyuan3D Paint import verification'
& $pythonExe -c 'import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'
Assert-LastCommand 'CUDA runtime verification'

Write-Host 'Hunyuan3D 2.1 Shape + Paint is installed.' -ForegroundColor Green
Write-Host 'The official shape and paint checkpoints download into .runtime\models on first use.'
Write-Host 'Forgecast unloads Shape before loading Paint so the two stages fit sequentially on this GPU.'
