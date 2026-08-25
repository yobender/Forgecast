$ErrorActionPreference = 'Stop'

$mutex = [System.Threading.Mutex]::new($false, 'Local\ForgecastMultiViewDownload')
$hasLock = $false

try {
  $hasLock = $mutex.WaitOne(0)
  if (!$hasLock) { exit 0 }

  $projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $modelDir = Join-Path $projectRoot '.runtime\forgecast-engine\models\hunyuan3d-mini\multiview\hunyuan3d-dit-v2-mv-fast'
  $modelFile = Join-Path $modelDir 'model.fp16.safetensors'
  $partialFile = "$modelFile.part"
  $expectedBytes = 4930777530
  $modelUrl = 'https://huggingface.co/tencent/Hunyuan3D-2mv/resolve/main/hunyuan3d-dit-v2-mv-fast/model.fp16.safetensors?download=true'

  New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
  if ((Test-Path -LiteralPath $modelFile) -and (Get-Item -LiteralPath $modelFile).Length -eq $expectedBytes) {
    exit 0
  }

  & curl.exe -L --fail --retry 20 --retry-delay 3 -C - --output $partialFile $modelUrl
  if ($LASTEXITCODE -ne 0) { throw "Multi-view model download failed with exit code $LASTEXITCODE." }

  $actualBytes = (Get-Item -LiteralPath $partialFile).Length
  if ($actualBytes -ne $expectedBytes) {
    throw "Multi-view checkpoint is incomplete: received $actualBytes of $expectedBytes bytes."
  }

  Move-Item -LiteralPath $partialFile -Destination $modelFile -Force
  Write-Output 'Hunyuan3D multi-view checkpoint installed.'
}
finally {
  if ($hasLock) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
