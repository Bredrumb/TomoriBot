# TomoriBot Reference STT Server

`whisperx_server.py` is the Phase 4 reference local STT endpoint. It exposes:

- `GET /health`
- `GET /v1/models`
- `POST /v1/audio/transcriptions`

## Prerequisites

- **Python 3.10+** — used to create the virtual environment
- **FFmpeg** — required by WhisperX for audio decoding; install it system-wide
  (e.g. `winget install Gyan.FFmpeg.Shared` on Windows, `brew install ffmpeg` on macOS, or your distro package manager)
- **CUDA 12.x + drivers** *(optional)* — required for GPU acceleration; without it the server falls back to CPU (significantly slower)

## Setup (Windows PowerShell)

Run these commands from the repo root.

```powershell
# 1. Create and activate a virtual environment inside scripts/stt/
python -m venv servers\stt\.venv
servers\stt\.venv\Scripts\Activate.ps1

# 2. Upgrade pip
python -m pip install -U pip

# 3. Install dependencies
python -m pip install -r servers\stt\requirements.txt

# 4. (GPU only) Reinstall PyTorch with CUDA support — skip this for CPU-only installs
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 5. Start the server
python servers\stt\whisperx_server.py
```

> **CUDA version**: use `cu118` or `cu121` in the index URL above if your driver targets an older toolkit.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `WHISPERX_MODEL` | `large-v3` | WhisperX model identifier |
| `WHISPERX_DEVICE` | `cuda` / `cpu` | Compute device (auto-detected) |
| `WHISPERX_COMPUTE_TYPE` | `float16` / `int8` | Precision (auto-detected) |
| `WHISPERX_BATCH_SIZE` | `16` | Transcription batch size |
| `WHISPERX_ENABLE_ALIGNMENT` | `0` | Set to `1` to enable word-level alignment |
| `TOMORI_STT_HOST` | `127.0.0.1` | Bind host |
| `TOMORI_STT_PORT` | `8021` | Bind port |

## Registering in TomoriBot

After the server is running, register it with:

- `capability = transcription`
- `api_style = openai-compatible-transcription`
- `endpoint_url = http://127.0.0.1:8021`
- `model = large-v3` (or whatever `WHISPERX_MODEL` is set to)
