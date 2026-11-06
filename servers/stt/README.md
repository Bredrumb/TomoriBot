# TomoriBot Reference STT Server

`whisperx_server.py` is the Phase 4 reference local STT endpoint. It exposes:

- `GET /health`
- `GET /v1/models`
- `POST /v1/audio/transcriptions`

## Prerequisites

- **Python 3.10+**: used to create the virtual environment
- **FFmpeg**: required by WhisperX for audio decoding; install it system-wide
  (e.g. `winget install Gyan.FFmpeg.Shared` on Windows, `brew install ffmpeg` on macOS, or your distro package manager)
- **CUDA 12.x + drivers** *(optional)*: required for GPU acceleration; without it the server falls back to CPU (significantly slower).
  On Windows, CTranslate2 needs the cuBLAS 12 and cuDNN 12 DLLs (`cublas64_12.dll`) on `PATH`. Without
  them the server logs `GPU found but unusable` at startup and falls back to CPU, or stops at startup
  when `WHISPERX_DEVICE=cuda` is set explicitly.

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

# 4. (Optional) Reinstall PyTorch with CUDA support. Whisper itself uses the GPU without this;
#    it only moves the voice activity detector and alignment models onto the GPU.
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 5. Start the server
python servers\stt\whisperx_server.py
```

> **CUDA version**: use `cu118` or `cu121` in the index URL above if your driver targets an older toolkit.

## Choosing a model

| `WHISPERX_MODEL` | Size | Use |
|---|---|---|
| `large-v3` | 1.55B | Best multilingual accuracy; about 0.6 GiB more VRAM than turbo |
| `large-v3-turbo` | 809M | Multilingual, faster decoder; slightly worse Japanese |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | Japanese only; more accurate than turbo on Japanese test clips, at the same speed |

On short clips the encoder dominates, so all three run at similar speed. Pick by language and VRAM.
`small` and `base` lose too much Japanese accuracy to recommend. Whisper models can still invent
text on very short or near-silent clips.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `WHISPERX_MODEL` | `large-v3` | Model name or Hugging Face repo ID (see above) |
| `WHISPERX_DEVICE` | `cuda` / `cpu` | Compute device; `cuda` when CTranslate2 sees a GPU |
| `WHISPERX_COMPUTE_TYPE` | `float16` / `int8` | Precision; `float16` on `cuda`, otherwise `int8` |
| `WHISPERX_BATCH_SIZE` | `16` | Transcription batch size |
| `WHISPERX_ENABLE_ALIGNMENT` | `0` | Set to `1` to enable word-level alignment |
| `TOMORI_STT_HOST` | `127.0.0.1` | Bind host |
| `TOMORI_STT_PORT` | `8021` | Bind port |

## Registering in TomoriBot

After the server is running, register it with:

- `capability = transcription`
- `api_style = openai-compatible-transcription`
- `endpoint_url = http://127.0.0.1:8021`
- `model`: exactly `WHISPERX_MODEL`, including the full repo ID for kotoba (`kotoba-tech/kotoba-whisper-v2.0-faster`)

Use `127.0.0.1` rather than `localhost` for local clients on Windows; `localhost` can resolve to IPv6
first, which the server does not listen on.

`GET /health` reports the loaded model, `device`, `compute_type`, `batch_size`, and `vad_device`. Check
that `device` is `cuda` after startup.
