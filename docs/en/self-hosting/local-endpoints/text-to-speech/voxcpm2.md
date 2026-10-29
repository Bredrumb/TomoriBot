---
title: "VoxCPM2"
aiGenerated: true
---

Synthesize expressive 48 kHz speech across 30 languages using OpenBMB's [VoxCPM2](https://github.com/OpenBMB/VoxCPM) text-to-speech model.

VoxCPM2 is a 2B-parameter multilingual speech model supporting voice cloning, transcript-assisted Ultimate Cloning, and natural-language Voice Design. TomoriBot connects to the official `voxcpm` Python library through the server in `servers/tts/voxcpm2/`, running the official unquantized `openbmb/VoxCPM2` BF16 checkpoint comfortably within 16 GB of VRAM.

## License

VoxCPM2 code and model weights are released under Apache-2.0, including commercial use subject to the license terms. TomoriBot does not redistribute the weights; the installer downloads them from the official Hugging Face repository.

Official upstream resources:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 on Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM documentation](https://voxcpm.readthedocs.io/)

## Supported languages

VoxCPM2 officially supports 30 languages without requiring a language tag:

Arabic, Burmese, Chinese, Danish, Dutch, English, Finnish, French, German, Greek, Hebrew, Hindi, Indonesian, Italian, Japanese, Khmer, Korean, Lao, Malay, Norwegian, Polish, Portuguese, Russian, Spanish, Swahili, Swedish, Tagalog, Thai, Turkish, and Vietnamese.

OpenBMB also documents several Chinese dialects. TomoriBot may still send a `language` field for compatibility with the common TTS contract, but VoxCPM2 detects the language from the synthesis text and the wrapper does not force a language tag.

## Voice modes

Use `Auto` and `Plain` markup for cloning and voice design. A reference transcript enables Ultimate Cloning; a delivery instruction takes precedence and omits the transcript for that request.

## Hardware and runtime

Recommended starting point:

- Python 3.10-3.12
- NVIDIA GPU with 8 GB VRAM or more for the official BF16 runtime; 12-16 GB gives comfortable headroom
- Current NVIDIA driver and a CUDA-enabled PyTorch build for GPU acceleration
- CPU is supported as a fallback but is substantially slower

The official package also exposes CPU and Apple MPS device selection. For TomoriBot on Windows, the standard Python package can run natively; WSL is not required. The Windows PowerShell installer installs a CUDA-enabled PyTorch build (`cu124`) by default.

To explicitly install on a CPU-only machine, pass the `-Cpu` switch:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

If your native Windows PyTorch installation ever needs a manual reinstall or driver realignment, install the CUDA-enabled PyTorch build directly into the server's virtual environment:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## Installation

The server pins the current stable `voxcpm` 2.0.3 package and downloads `openbmb/VoxCPM2` into the normal Hugging Face cache.

### Linux and WSL Bash

From the TomoriBot repository root:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

From the TomoriBot repository root:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

The first setup downloads several gigabytes of model weights. To install the Python environment without prefetching the model, set `VOXCPM2_PREFETCH=0`; the official library will then download the checkpoint on first server start.

Linux and WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

After setup, `bun run launch --voxcpm2` starts the server together with TomoriBot. The default endpoint is `http://127.0.0.1:8016`.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and configure the Speech endpoint:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Voice Source Mode: `Auto`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

After saving the connection, select it and use its model dropdown to add a Speech model. Then open `/config` > Models > Switch Models and select the VoxCPM2 speech model.

`Auto` is recommended because the same server supports reference-audio cloning and Voice Design. You do not need separate VoxCPM2 processes for the two modes.

## Persona voice cloning

For a persona that should clone an existing speaker:

1. Prepare a clean reference clip with one speaker and little or no background music. Upstream treats 5 to 30 seconds as the practical range.
2. Open `/config` under Models > TTS Parameters & Voices and upload the clip.
3. Add the exact transcript of the reference clip when available. VoxCPM2 uses it for Ultimate Cloning and can reproduce more of the reference rhythm, emotion, and style.
4. Open `/config` under Persona > Voice, choose the persona, and assign the saved sample.

If no transcript is stored, VoxCPM2 still performs normal reference-audio cloning.

## Persona voice design

For a persona that should be created from a written voice description instead of a sample:

1. Open `/config` under Persona > Voice and choose VoiceDesign.
2. Choose the persona.
3. Enter a natural-language description such as `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

For a cloned voice, one-off delivery instructions take precedence over the reference transcript.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face model ID or local model directory |
| `VOXCPM2_DEVICE` | `auto` | Runtime device: `auto`, `cuda`, `cuda:N`, `cpu`, or `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Enable the official runtime's optimization / compile path |
| `VOXCPM2_LOAD_DENOISER` | `0` | Load the optional upstream denoiser; disabled by default to save memory |
| `VOXCPM2_CFG_VALUE` | `2.0` | Guidance strength |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Flow-matching inference steps; more can improve quality at the cost of speed |
| `VOXCPM2_MAX_LEN` | `4096` | Maximum generation length |
| `VOXCPM2_NORMALIZE` | `0` | Enable upstream text normalization |
| `VOXCPM2_RETRY_BADCASE` | `1` | Enable upstream retry behavior for abnormal generations |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Maximum automatic retries |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Upstream bad-case length threshold |
| `VOXCPM2_PREFETCH` | `1` | Installer only: download the model during setup |
| `VOXCPM2_PORT` | `8016` | VoxCPM2 local server port |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Local server bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |

Reference audio must be a non-empty WAV container of at most 10 MB decoded, which the wrapper checks before writing a temporary file.
