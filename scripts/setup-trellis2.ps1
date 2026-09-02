param([string]$Distro = 'Ubuntu-24.04')

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$sourceRoot = Join-Path $runtimeRoot 'sources\TRELLIS.2'
$markerPath = Join-Path $runtimeRoot 'trellis2.json'
$pinnedCommit = '75fbf0183001ed9876c8dbb35de6b68552ee08bd'

function Assert-LastCommand([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

$distros = @(& wsl.exe --list --quiet) -replace "`0", '' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($Distro -notin $distros) {
  throw "TRELLIS.2 requires a normal WSL2 Linux distribution. Install it with: wsl --install -d $Distro; launch it once; then rerun this script."
}
if (!(Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }

if (!(Test-Path (Join-Path $sourceRoot '.git'))) {
  New-Item -ItemType Directory -Force (Split-Path $sourceRoot -Parent) | Out-Null
  & git clone --recurse-submodules https://github.com/microsoft/TRELLIS.2.git $sourceRoot
  Assert-LastCommand 'TRELLIS.2 clone'
}
$head = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($head -ne $pinnedCommit) {
  & git -C $sourceRoot fetch --depth 1 origin $pinnedCommit
  Assert-LastCommand 'TRELLIS.2 pinned version fetch'
  & git -C $sourceRoot checkout --detach $pinnedCommit
  Assert-LastCommand 'TRELLIS.2 pinned version checkout'
  & git -C $sourceRoot submodule update --init --recursive --depth 1
  Assert-LastCommand 'TRELLIS.2 submodule checkout'
}

$sourceRootForWsl = $sourceRoot -replace '\\', '/'
$runtimeRootForWsl = $runtimeRoot -replace '\\', '/'
$linuxSource = ((& wsl.exe -d $Distro -- wslpath -a -u $sourceRootForWsl) -replace "`0", '').Trim()
$linuxRuntime = ((& wsl.exe -d $Distro -- wslpath -a -u $runtimeRootForWsl) -replace "`0", '').Trim()
if (!$linuxSource -or !$linuxRuntime) { throw 'Could not translate Forgecast paths into WSL paths.' }

$bootstrap = @'
set -e
export CUDA_HOME=/usr/local/cuda-12.4
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}"
export LIBRARY_PATH="/usr/lib/wsl/lib:$CUDA_HOME/lib64:${LIBRARY_PATH:-}"
export CONDA_ALWAYS_YES=true
export MAX_JOBS="${MAX_JOBS:-4}"
if ! command -v gcc >/dev/null 2>&1; then
  echo "Missing Linux build tools. Run: sudo apt update && sudo apt install -y build-essential ninja-build git curl libgl1 libjpeg-dev zlib1g-dev" >&2
  exit 12
fi
if [ ! -f /usr/include/zlib.h ]; then
  echo "Missing zlib development headers. Run: sudo apt install -y zlib1g-dev" >&2
  exit 14
fi
if ! command -v nvcc >/dev/null 2>&1; then
  echo "Missing the Linux CUDA Toolkit. Install CUDA Toolkit 12.4 inside this WSL distribution, then rerun setup." >&2
  exit 13
fi
if [ ! -f "$HOME/miniforge3/etc/profile.d/conda.sh" ]; then
  curl -L --fail --retry 5 -o /tmp/forgecast-miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh
  bash /tmp/forgecast-miniforge.sh -b -p "$HOME/miniforge3"
fi
source "$HOME/miniforge3/etc/profile.d/conda.sh"
cd '__SOURCE__'
sed -i 's/\r$//' setup.sh
export HF_HOME='__RUNTIME__/models/huggingface'
mkdir -p "$HF_HOME"
rm -rf /tmp/extensions/nvdiffrast /tmp/extensions/nvdiffrec /tmp/extensions/CuMesh /tmp/extensions/FlexGEMM /tmp/extensions/o-voxel
if conda env list | awk '{print $1}' | grep -qx trellis2; then
  conda activate trellis2
  . ./setup.sh --basic --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
else
  . ./setup.sh --new-env --basic --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
fi
python -m pip install flash-attn==2.7.3 --no-build-isolation
conda run -n trellis2 python -m pip install fastapi uvicorn python-multipart
'@
$bootstrap = $bootstrap.Replace('__SOURCE__', $linuxSource)
$bootstrap = $bootstrap.Replace('__RUNTIME__', $linuxRuntime)
$bootstrap = $bootstrap -replace "`r", ''
$bootstrap | & wsl.exe -d $Distro -- bash -s
Assert-LastCommand 'TRELLIS.2 Linux environment installation'

@{ distro = $Distro; commit = $pinnedCommit } | ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding UTF8
Write-Host 'TRELLIS.2 is installed for Forgecast.' -ForegroundColor Green
Write-Host "The 4B checkpoint downloads into '$(Join-Path $runtimeRoot 'models')' on the first TRELLIS.2 cast."
