$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime'
$sourceRoot = Join-Path $runtimeRoot 'sources\TRELLIS.2'
$markerPath = Join-Path $runtimeRoot 'trellis2.json'
$serverPath = Join-Path $projectRoot 'backend\trellis2_server.py'

if (!(Test-Path $markerPath)) { throw 'TRELLIS.2 is not installed. Run scripts\setup-trellis2.ps1 first.' }
$config = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
$distro = [string]$config.distro
$sourceRootForWsl = $sourceRoot -replace '\\', '/'
$runtimeRootForWsl = $runtimeRoot -replace '\\', '/'
$serverPathForWsl = $serverPath -replace '\\', '/'
$linuxSource = ((& wsl.exe -d $distro -- wslpath -a -u $sourceRootForWsl) -replace "`0", '').Trim()
$linuxRuntime = ((& wsl.exe -d $distro -- wslpath -a -u $runtimeRootForWsl) -replace "`0", '').Trim()
$linuxServer = ((& wsl.exe -d $distro -- wslpath -a -u $serverPathForWsl) -replace "`0", '').Trim()

$launch = @'
set -e
source "$HOME/miniforge3/etc/profile.d/conda.sh"
cd '__SOURCE__'
export CUDA_HOME=/usr/local/cuda-12.4
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="/usr/lib/wsl/lib:$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}"
export HF_HOME='__RUNTIME__/models/huggingface'
export FORGECAST_TRELLIS_SOURCE='__SOURCE__'
export FORGECAST_TRELLIS_OUTPUTS='__RUNTIME__/forgecast-engine/trellis2/outputs'
export PYTHONPATH="$FORGECAST_TRELLIS_SOURCE:${PYTHONPATH:-}"
mkdir -p "$HF_HOME" "$FORGECAST_TRELLIS_OUTPUTS"
conda run --no-capture-output -n trellis2 python '__SERVER__' --host 127.0.0.1 --port 8766
'@
$launch = $launch.Replace('__SOURCE__', $linuxSource)
$launch = $launch.Replace('__RUNTIME__', $linuxRuntime)
$launch = $launch.Replace('__SERVER__', $linuxServer)
$launch = $launch -replace "`r", ''
$launch | & wsl.exe -d $distro -- bash -s
