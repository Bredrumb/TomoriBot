param(
  [string]$Python = "python",
  [switch]$Cpu
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ScriptDir "fish-speech"
$VenvDir = Join-Path $ScriptDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$HfExe = Join-Path $VenvDir "Scripts\hf.exe"
$ModelDir = if ($env:FISH_S2_MODEL_DIR) { $env:FISH_S2_MODEL_DIR } else { Join-Path $RuntimeDir "checkpoints\fish-speech-s2-pro-int8" }
$RuntimeRepository = if ($env:FISH_S2_RUNTIME_REPOSITORY) { $env:FISH_S2_RUNTIME_REPOSITORY } else { "https://github.com/Imagilux/fish-speech.git" }
$RuntimeRef = if ($env:FISH_S2_RUNTIME_REF) { $env:FISH_S2_RUNTIME_REF } else { "2225e924e7d35cc0a1d24dbc67cd1819e6cf429f" }
$ModelId = if ($env:FISH_S2_MODEL_ID) { $env:FISH_S2_MODEL_ID } else { "Imagilux/fishaudio-s2-pro" }
$ModelRevision = if ($env:FISH_S2_MODEL_REVISION) { $env:FISH_S2_MODEL_REVISION } else { "9706ff036580881d87cc09465dd10014527bc481" }
$UseCpu = $Cpu.IsPresent -or ($env:CPU_ONLY -match "^(1|true|yes|on)$")
$CudaIndex = if ($env:TORCH_CUDA_INDEX) { $env:TORCH_CUDA_INDEX } else { "https://download.pytorch.org/whl/cu124" }
$UpdateRuntime = $env:FISH_S2_UPDATE -match "^(1|true|yes|on)$"
if ($UpdateRuntime) {
  if ($env:FISH_S2_UPDATE_REF) {
    $RuntimeRef = $env:FISH_S2_UPDATE_REF
  } elseif (-not $env:FISH_S2_RUNTIME_REF) {
    $RuntimeRef = "main"
  }
}
if ($UpdateRuntime) {
  if ($env:FISH_S2_UPDATE_MODEL_REVISION) {
    $ModelRevision = $env:FISH_S2_UPDATE_MODEL_REVISION
  } elseif (-not $env:FISH_S2_MODEL_REVISION) {
    $ModelRevision = "main"
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required."
}
if (-not (Get-Command $Python -ErrorAction SilentlyContinue)) {
  throw "$Python was not found. Python 3.12 is recommended by Fish Speech."
}

if (-not (Test-Path (Join-Path $RuntimeDir ".git"))) {
  git clone --no-checkout $RuntimeRepository $RuntimeDir
}

git -C $RuntimeDir fetch --depth 1 origin $RuntimeRef
git -C $RuntimeDir checkout --detach --force $RuntimeRef

& $Python -m venv $VenvDir
& $VenvPython -m pip install --upgrade pip setuptools wheel

if (-not $UseCpu) {
  Write-Host "Installing CUDA-enabled PyTorch from $CudaIndex..."
  & $VenvPython -m pip install torch torchvision torchaudio --index-url $CudaIndex
}

& $VenvPython -m pip install -r (Join-Path $ScriptDir "requirements.txt")
& $VenvPython -m pip install -e $RuntimeDir

if ($UpdateRuntime -or -not (Test-Path (Join-Path $ModelDir "model.pth")) -or -not (Test-Path (Join-Path $ModelDir "codec.pth"))) {
  Write-Host "Downloading $ModelId checkpoint at revision $ModelRevision..."
  Write-Host "If Hugging Face requests authentication, accept the model license and run: hf auth login"
  & $HfExe download $ModelId --revision $ModelRevision --local-dir $ModelDir
}

$TorchCheck = @'
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
else:
    print("No CUDA device detected. Fish S2 Pro will run on CPU.")
'@
& $VenvPython -c $TorchCheck

Write-Host "Fish S2 Pro setup complete."
Write-Host "Runtime: $RuntimeDir"
Write-Host "Runtime ref: $RuntimeRef"
Write-Host "Model:   $ModelDir"
Write-Host "Model ref: $ModelRevision"
Write-Host "Start:   $VenvPython $(Join-Path $ScriptDir 'server.py')"
Write-Warning "Fish Audio officially documents Linux/WSL for local S2 inference. Native Windows is best-effort; use WSL if upstream dependencies fail to build."
