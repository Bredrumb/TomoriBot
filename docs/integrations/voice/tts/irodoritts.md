---
title: "IrodoriTTS"
---

Irodori-TTS 500M v2 is a Japanese-focused voice-cloning TTS model. It runs via a local FastAPI wrapper server in `servers/tts/irodoritts/`.

## Why a script instead of a plain pip install

A direct `pip install git+https://github.com/Aratako/Irodori-TTS` fails for two reasons:

1. **Packaging bugs in upstream `pyproject.toml`** — the `license` field uses a bare string instead of a PEP 621 table, and the `configs/` directory at the repo root causes setuptools auto-discovery to reject the flat layout. The install script patches both before building.
2. **`dacvae` is not on PyPI** — the upstream repo declares it via `[tool.uv.sources]`, which is a `uv`-only extension that pip ignores. The script pre-installs `dacvae` directly from GitHub before installing irodori-tts.

## Setup (Windows PowerShell)

```powershell
# 1. Create and activate a venv inside the engine folder
python -m venv scripts\tts\irodoritts\.venv
scripts\tts\irodoritts\.venv\Scripts\Activate.ps1

# 2. Upgrade pip
python -m pip install -U pip

# 3. Install server runtime deps (FastAPI, uvicorn, PyTorch)
pip install -r scripts\tts\irodoritts\requirements.txt

# 4. (GPU only) Reinstall PyTorch with CUDA support — skip for CPU-only installs
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 5. Install irodori-tts from source via the patch script
.\scripts\tts\irodoritts\install-irodori.ps1

# 6. Start the server
python scripts\tts\irodoritts\server.py
```

> **CUDA version**: replace `cu124` with `cu118` or `cu121` if your driver targets an older toolkit.

## Security note

Both `Irodori-TTS` and `dacvae` are installed from GitHub. The install script pins both to specific commit SHAs (defined at the top of `install-irodori.ps1`) to prevent silent upstream changes from affecting installs. When updating, replace the SHA constants with the new HEAD commits and verify the diff before deploying.

## Registering in TomoriBot

After the server is running, register it with `/config custom-endpoint add`:

- `capability`: `speech`
- `api_style`: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`
- `script_markup`: `emoji`
- `supports_instruct`: `false`

Then select it with `/config model speech`, upload a reference sample with `/speech voice-add`, and assign it with `/speech voice-assign`.

TomoriBot strips Discord custom emoji syntax before sending text to TTS. With `script_markup: emoji`, Unicode emojis are preserved for IrodoriTTS emotion control; other speech modes remove Unicode emojis too so they are not spoken literally.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-500M-v2` | HuggingFace model repo |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Server bind address |
| `TOMORI_TTS_PORT` | `8013` | Server port |
| `IRODORI_MODEL_DEVICE` | `cuda` / `cpu` | Inference device |
| `IRODORI_CODEC_DEVICE` | same as model device | Codec device |
| `IRODORI_MODEL_PRECISION` | `bf16` (GPU) / `fp32` (CPU) | Model precision |
| `IRODORI_CODEC_PRECISION` | `fp32` | Codec precision |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `1000` | Per-request text length cap |
