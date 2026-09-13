---
title: "MOSS-TTS"
---

Use `servers/tts/moss/server.py` to try MOSS voice cloning and text-described voice design through one local endpoint. Auto mode selects the clone model when TomoriBot sends `ref_audio` and MOSS-VoiceGenerator when it sends `instruct`. It keeps only one model loaded at a time. This is a trial sidecar, not a streaming Discord voice-chat integration.

The default clone model is [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), chosen as the practical starting point for a 16 GB GPU. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) is an 8B alternative but will generally need more than 16 GB VRAM at BF16. Voice design uses [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (about 1.7B). Auto mode swaps models rather than keeping both in VRAM, but a swap incurs a download/load delay.

## Setup

Run from the TomoriBot repository root. Use Python 3.12 and a CUDA driver compatible with the upstream CUDA 12.8 PyTorch wheels. Upstream's runtime extra pins PyTorch and Torchaudio 2.9.1+cu128; keep this sidecar in its own virtual environment. Other CUDA or CPU stacks need a separately validated installation.

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\server.py
```

### Linux or WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/server.py
```

The endpoint is `http://127.0.0.1:8018`. Auto mode loads the requested model on first synthesis. Check `GET /health` for `active_mode` and `model_id`; an idle response before the first request is normal. The wrapper uses Hugging Face `trust_remote_code=True`, so install only from a source you trust and review upstream changes before updating.

## Register in TomoriBot

In `/providers`, choose **Add New Custom Endpoint**, set API Compatibility to `tts-clone`, and use endpoint URL `http://127.0.0.1:8018`. Add a Speech model with **Voice Source Mode** `Auto` and **Script Markup** `Plain`. Then activate it under `/config` > Models > Switch Models.

For cloning, upload a clean reference clip under `/config` > Models > TTS Parameters & Voices and assign it under Persona > Voice. For voice design, save a natural-language voice description under Persona > Voice instead. MOSS-TTS uses the audio reference; it does not use TomoriBot's optional reference transcript. MOSS-VoiceGenerator is documented for English and Chinese, not Japanese. The 4B clone model supports Japanese, but a known language tag improves multilingual synthesis.

TomoriBot's current clone adapter sends no language tag. For a single-language trial, set `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (or `English`, `Chinese`, etc.) before starting the server. A manual `/synthesize` request can instead supply `language` per request. Leave the variable unset for mixed-language use; evaluate Japanese output before relying on it.

The sidecar reads its own process environment. Adding a value to the bot's `.env` does not automatically pass it to a separately started Python process.

To try the 8B flagship on a machine with enough memory, set `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`. `TOMORI_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE`, `MOSS_TTS_MAX_REF_AUDIO_BYTES`, and `MOSS_TTS_MAX_NEW_TOKENS` are also configurable in `.env.optional.example`. The bot's `TTS_SYNTHESIZE_TIMEOUT_MS` may need increasing for initial loads or CPU inference.
