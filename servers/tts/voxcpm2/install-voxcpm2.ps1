param(
  [switch]$Cpu
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$PythonBin = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { "python" }
$ModelId = if ($env:VOXCPM2_MODEL_ID) { $env:VOXCPM2_MODEL_ID } else { "openbmb/VoxCPM2" }
$UseCpu = $Cpu.IsPresent -or ($env:CPU_ONLY -match "^(1|true|yes|on)$")
$CudaIndex = if ($env:TORCH_CUDA_INDEX) { $env:TORCH_CUDA_INDEX } else { "https://download.pytorch.org/whl/cu124" }

& $PythonBin -c "import sys; assert (3, 10) <= sys.version_info[:2] < (3, 13), 'VoxCPM2 requires Python 3.10-3.12.'"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $PythonBin -m venv $VenvDir
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip setuptools wheel

if (-not $UseCpu) {
  Write-Host "Installing CUDA-enabled PyTorch from $CudaIndex..."
  & $VenvPython -m pip install torch torchvision torchaudio --index-url $CudaIndex
}

& $VenvPython -m pip install -r (Join-Path $ScriptDir "requirements.txt")

if ($env:VOXCPM2_PREFETCH -ne "0") {
  Write-Host "Downloading $ModelId into the Hugging Face cache..."
  $env:VOXCPM2_MODEL_ID = $ModelId
  & $VenvPython -c "import os; from huggingface_hub import snapshot_download; snapshot_download(os.environ['VOXCPM2_MODEL_ID'])"
}

$TorchCheck = @'
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
else:
    print("No CUDA device detected. VoxCPM2 will run on CPU unless VOXCPM2_DEVICE selects another supported device.")
'@
& $VenvPython -c $TorchCheck

Write-Host "VoxCPM2 setup complete."
Write-Host "Start: $VenvPython $(Join-Path $ScriptDir 'server.py')"
