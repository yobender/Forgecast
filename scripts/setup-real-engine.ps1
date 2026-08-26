$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$modlyRoot = Join-Path $runtimeRoot 'modly'
$sourceExtension = Join-Path $runtimeRoot 'modly-hunyuan3d-mini-extension'
$dataRoot = Join-Path $runtimeRoot 'forgecast-engine'
$extensionsRoot = Join-Path $dataRoot 'extensions'
$extensionRoot = Join-Path $extensionsRoot 'hunyuan3d-mini'
$apiVenv = Join-Path $modlyRoot 'api\.venv'
$extensionVenv = Join-Path $extensionRoot 'venv'
$downloadsRoot = Join-Path $runtimeRoot 'downloads'
$patchesRoot = Join-Path $PSScriptRoot 'patches'
$modlyCommit = '3ae371c69b05ba7b5dd4fef102be320930d2dc21'
$extensionCommit = 'c927d5657249f91d09bb912900d5d4f7b26725fb'

function Assert-LastCommand([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}

function Get-PinnedRepository([string]$url, [string]$destination, [string]$commit, [string]$label) {
  if (Test-Path (Join-Path $destination '.git')) { return }
  if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows, then run this installer again.'
  }
  Write-Host "[setup] Downloading $label source..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
  & git clone $url $destination
  Assert-LastCommand "$label clone"
  & git -C $destination checkout $commit
  Assert-LastCommand "$label version checkout"
}

function Apply-ForgecastPatch([string]$repository, [string]$patchFile, [string]$label) {
  & git -C $repository apply --recount --check $patchFile 2>$null
  if ($LASTEXITCODE -eq 0) {
    & git -C $repository apply --recount $patchFile
    Assert-LastCommand "$label patch"
    return
  }
  & git -C $repository apply --recount --reverse --check $patchFile 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "$label patch does not match the pinned source. Delete .runtime and run setup again."
  }
}

Get-PinnedRepository 'https://github.com/lightningpixel/modly.git' $modlyRoot $modlyCommit 'Modly'
Get-PinnedRepository 'https://github.com/lightningpixel/modly-hunyuan3d-mini-extension.git' $sourceExtension $extensionCommit 'Hunyuan3D Mini extension'
Apply-ForgecastPatch $modlyRoot (Join-Path $patchesRoot 'modly-forgecast.patch') 'Forgecast Modly integration'
Apply-ForgecastPatch $sourceExtension (Join-Path $patchesRoot 'hunyuan-extension-base.patch') 'Hunyuan extension compatibility'
Apply-ForgecastPatch $sourceExtension (Join-Path $patchesRoot 'hunyuan-extension-runtime.patch') 'Forgecast high-detail generator'

New-Item -ItemType Directory -Force $extensionRoot | Out-Null
Copy-Item -Path (Join-Path $sourceExtension '*') -Destination $extensionRoot -Recurse -Force

if (!(Test-Path (Join-Path $apiVenv 'Scripts\python.exe'))) {
  python -m venv $apiVenv
}

$apiPython = Join-Path $apiVenv 'Scripts\python.exe'
& $apiPython -m pip install --upgrade pip
Assert-LastCommand 'API pip upgrade'
& $apiPython -m pip install -r (Join-Path $modlyRoot 'api\requirements.txt')
Assert-LastCommand 'API dependency installation'

$setupArgs = @{
  python_exe = (Get-Command python).Source
  ext_dir = $extensionRoot
  gpu_sm = 89
  cuda_version = 124
  torch_flavor = 'cuda'
  accelerator = 'cuda'
  platform = 'win32'
} | ConvertTo-Json -Compress

if (!(Test-Path (Join-Path $extensionVenv 'Scripts\python.exe'))) {
  python -m venv $extensionVenv
  Assert-LastCommand 'Hunyuan environment creation'
}

$extensionPython = Join-Path $extensionVenv 'Scripts\python.exe'
& $extensionPython -c 'import torch; assert torch.__version__.startswith("2.6.0+cu124")' 2>$null
if ($LASTEXITCODE -ne 0) {
  New-Item -ItemType Directory -Force $downloadsRoot | Out-Null
  $torchWheel = Join-Path $downloadsRoot 'torch-2.6.0+cu124-cp312-cp312-win_amd64.whl'
  $torchUrl = 'https://download-r2.pytorch.org/whl/cu124/torch-2.6.0%2Bcu124-cp312-cp312-win_amd64.whl'
  Write-Host '[setup] Downloading retryable CUDA PyTorch wheel (2.5 GB)...' -ForegroundColor Cyan
  & curl.exe --location --fail --retry 20 --retry-delay 5 --retry-all-errors --continue-at - --output $torchWheel $torchUrl
  Assert-LastCommand 'CUDA PyTorch download'
  & $extensionPython -m pip install $torchWheel
  Assert-LastCommand 'CUDA PyTorch wheel installation'
}

python (Join-Path $extensionRoot 'setup.py') $setupArgs
Assert-LastCommand 'Hunyuan3D Mini dependency installation'
Write-Host 'Forgecast real engine dependencies are installed.' -ForegroundColor Green
Write-Host 'Model weights download automatically on the first real generation.'
