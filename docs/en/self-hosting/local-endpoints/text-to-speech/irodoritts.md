---
title: "IrodoriTTS"
aiGenerated: true
---

Generate natural Japanese speech with voice cloning, caption-based VoiceDesign, and expressive emoji markup using [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 is a Japanese-focused text-to-speech model supporting both voice cloning and text-described VoiceDesign within a single checkpoint. TomoriBot connects to Irodori through the local FastAPI wrapper in `servers/tts/irodoritts/`, defaulting to `Aratako/Irodori-TTS-v4.1-Small`.

Compatible Hugging Face checkpoints can be selected with `IRODORI_TTS_MODEL_ID`, including community fine-tunes such as `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Setup

Irodori uses `uv` for dependency and PyTorch backend management. The server maintains its own `pyproject.toml` with pinned Irodori and `dacvae` dependencies for reproducible installations. Install `uv` first, then run the setup script from the TomoriBot repository root:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

The setup scripts create `servers/tts/irodoritts/.venv`, so `bun run launch --irodoritts` continues to work after installation.

Available backends:

- `cu128`: NVIDIA CUDA 12.8 on Windows and Linux
- `cpu`: CPU-only, or macOS CPU/MPS through PyPI
- `rocm`: AMD ROCm on Linux/WSL
- `xpu`: Intel XPU on Windows and Linux

The default endpoint URL is `http://127.0.0.1:8013`.

## Using a different checkpoint

The default model is `Aratako/Irodori-TTS-v4.1-Small`. You can select other official checkpoints (including the 3.29B parameter Large model and its quantized variants), community fine-tunes, or local checkpoint files through environment variables.

### Checkpoints and variants

| Model / `IRODORI_TTS_MODEL_ID` | Parameters | Checkpoint size | Recommended VRAM | Notes |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | Default model: fast inference and low memory use. |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | Full unquantized Large model with T5Gemma 2 text backbone. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | FP8 weights with BF16 activations: recommended for NVIDIA Ada (RTX 40-series) and newer. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | General-purpose INT8 weights with BF16 compute on NVIDIA CUDA. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | Smallest Large variant: requires NVIDIA Ampere (RTX 30-series) or newer. |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | Community fine-tune for anime-style speech delivery. |

For voice cloning, Small offers similar quality with faster inference. Large has a stronger text encoder and follows VoiceDesign descriptions more closely.

The server reads the repository root `.env` or a local `servers/tts/irodoritts/.env`.

### Via `.env` (persistent)

Add to your `.env` in the TomoriBot root:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Via environment variable per session

In Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

On Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Using a local checkpoint file

If you have downloaded a checkpoint file (`.pt` or `.safetensors`) locally, set `IRODORI_TTS_CHECKPOINT` to its path:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Current Irodori downloads the checkpoint together with any tokenizer assets bundled in the Hugging Face repo. Hugging Face subfolder variants are also supported by `IRODORI_TTS_MODEL_ID` when the model repo provides them.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and use the speech API compatibility:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

After saving the connection, select it and use its model dropdown to add a Speech model. For v4.1, the recommended settings are:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

`Auto` lets the same Irodori endpoint support both TomoriBot voice modes, so emotion cues survive the send:

- Personas with a voice sample assigned under Persona > Voice send a stored reference clip for voice cloning.
- Personas with a VoiceDesign prompt set under Persona > Voice send the saved natural-language prompt as Irodori caption conditioning.

You can still choose `Voice Clone` as the Voice Source Mode if you only want reference-audio voice cloning.

Use `/providers` for endpoint registration and model setup. Then open `/config` > Models > Switch Models to select and activate the registered endpoint.

## Set up persona voices

### Voice cloning

1. Prepare a clean Japanese voice clip with one speaker and no background music. Around 30 seconds is already enough: past that point the extra audio buys little timbre fidelity while costing upload size and inference time.
2. Open `/config` under Models > TTS Parameters & Voices and upload the clip.
3. Open `/config` under Persona > Voice, then choose the persona and the voice sample.

Irodori defaults to a 120-second reference limit and trims longer clips. Set `IRODORI_MAX_REF_SECONDS` to change the limit.

The server encodes each reference clip once and keeps the result in `servers/tts/irodoritts/reference-cache/`, so repeat requests skip that step. Replacing a persona's clip creates a new entry, and old entries stay until you delete the folder.

### VoiceDesign

1. Open `/config` under Persona > Voice.
2. Choose the persona.
3. Enter a natural-language description of the desired voice and delivery.

TomoriBot sends this prompt as `instruct`; the Irodori wrapper maps it to the v4.1 `caption` condition. VoiceDesign requests do not require a stored reference clip.

TomoriBot strips Discord custom emoji syntax before sending text to TTS. With `script_markup: emoji`, Unicode emojis are preserved for Irodori's text conditioning.

### Emoji style controls

IrodoriTTS supports emoji annotations in input text to influence sound effects, speaking styles, and emotional expressions. With TomoriBot's `Script Markup Style` set to `Emoji`, these Unicode emojis are preserved and sent to Irodori.

For supported emoji and their meanings, see the [upstream emoji annotations](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md). Emoji are style cues and results can vary.

## Long voice messages

Long text is split into chunks and returned as one voice message. Long requests can exceed the default 240-second timeout; adjust `TTS_SYNTHESIZE_TIMEOUT_MS` if needed. Set `IRODORI_CHUNKING_ENABLED=false` to disable chunking or `IRODORI_CHUNK_MIN_CHARS` to adjust the split threshold.

## Faster inference with sway sampling

The default remains Irodori's higher-quality 40-step linear sampling. For lower latency, try Sway Sampling with fewer steps:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

This is an inference quality and speed tradeoff, so test it with your chosen checkpoint and voices before making it permanent.

## Low-latency mode (NVIDIA)

Low-latency mode makes each sentence about 3-4x faster on an NVIDIA GPU with the same 40 steps and voice settings, so it does not trade away quality the way Sway Sampling does. Turn it on in `.env`:

```dotenv
IRODORI_COMPILE_MODE="cudagraphs"
```

`cudagraphs` is the fastest mode. `compile` is about 2x faster than the default; try it if `cudagraphs` misbehaves on your GPU. Both need the `cu128` backend, and the server refuses to start with either mode on other backends.

What to expect:

- The server warms up before it reports ready. The first start takes about 2-4 minutes; later starts take about 1-2 minutes because the compiled kernels are cached on disk. `bun run launch --irodoritts` waits up to 5 minutes; on a slower GPU, raise that limit with `TOMORI_TTS_STARTUP_TIMEOUT_MS` (in milliseconds).
- The first request with a new sentence length or a new voice clip adds a fraction of a second, once.
- VRAM use goes down slightly.
- The audio is not bit-identical to the default mode for the same seed. In testing it sounded equivalent, so listen to a few lines with your own voices before relying on it.

On Windows, the mode also needs the Microsoft C++ compiler:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload.
2. Rerun `.\servers\tts\irodoritts\install-irodori.ps1 cu128` so the Windows Triton package is installed.
3. Start the server (or `bun run launch --irodoritts`) from **Developer PowerShell for VS**, or load the compiler into an ordinary PowerShell first:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
cmd /c "`"$vs\VC\Auxiliary\Build\vcvars64.bat`" >nul && set" | ForEach-Object {
  if ($_ -match "^([^=]+)=(.*)$") { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
}
```

If the compiler or Triton is missing, the server stops at startup and says which one.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face model repo or supported repo/subfolder source |
| `IRODORI_TTS_CHECKPOINT` | unset | Optional local `.pt` or `.safetensors` checkpoint; overrides the Hugging Face model |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Server bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Server port |
| `IRODORI_MODEL_DEVICE` | `auto` | Model device (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Codec device |
| `IRODORI_MODEL_PRECISION` | `bf16` on CUDA, otherwise `fp32` | Model precision |
| `IRODORI_CODEC_PRECISION` | `fp32` | Codec precision |
| `IRODORI_COMPILE_MODE` | `off` | `off`, `compile`, or `cudagraphs`; see [Low-latency mode](#low-latency-mode-nvidia) |
| `IRODORI_NUM_STEPS` | `40` | Euler sampling steps |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Sampling schedule (`linear` or `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Sway coefficient when using the `sway` schedule |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Text guidance scale |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Caption / VoiceDesign guidance scale |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Reference-speaker guidance scale |
| `IRODORI_MAX_REF_SECONDS` | checkpoint default | Optional cap on reference audio duration |
| `IRODORI_CHUNKING_ENABLED` | `true` | Split long text at eligible punctuation boundaries and concatenate the generated chunks |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Minimum non-whitespace characters before strong sentence boundaries split; commas are fallback boundaries at about 1.5x this value |
