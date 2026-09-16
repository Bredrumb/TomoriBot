---
title: "Fish Audio S2 Pro"
aiGenerated: false
---

Fish Audio S2 Pro is a multilingual 4B TTS model focused on high-fidelity voice cloning and expressive delivery. TomoriBot uses it through the local wrapper in `servers/tts/fishs2/`.

The default TomoriBot setup uses the official BF16 weights (`fishaudio/s2-pro`) to provide the highest synthesis fidelity and avoid quantization incompatibilities. For users with memory-constrained consumer GPUs, an optional INT8 weight-only quantization (`Imagilux/fishaudio-s2-pro`) is supported via environment overrides.

Fish S2 Pro supports bracket expression tags such as `[whisper]`, `[excited]`, and `[angry]`. Configure the endpoint with **Bracket Tags** markup so TomoriBot preserves these controls in generated voice scripts.

## License

Fish Speech code and S2 Pro model weights are distributed under the Fish Audio Research License. Research and non-commercial use are permitted under its terms; commercial use requires a separate Fish Audio license.

TomoriBot does not redistribute the model weights. Each self-hosting user downloads Fish S2 Pro directly from Hugging Face and is responsible for complying with the Fish Audio Research License. The required attribution is: **Built with Fish Audio**.

## Hardware & Operating System

> [!IMPORTANT]
> **Use Linux or WSL2 for Fish Speech:** Fish Audio officially targets Linux and WSL2. Fish S2 Pro uses a Dual-Autoregressive (Dual-AR) architecture (36 slow transformer layers + 10 fast codebook passes = 76 layer evaluations per token). On Linux, OpenAI Triton can compile this nested loop into fused GPU kernels (`torch.compile(backend="inductor")`), which upstream benchmarks demonstrate enables real-time synthesis on Linux server GPUs. The wrapper leaves compilation off by default, so set `FISH_S2_COMPILE=1` to use it.
>
> On native Windows, Triton is unsupported, forcing PyTorch into uncompiled eager mode with over 120,000 sequential CUDA kernel dispatches through the Windows WDDM driver. This causes a severe dispatch stall, slowing generation down to **~8-10 minutes** (~65s compute per second of audio) for the exact same clip. For usable inference, **run Fish S2 Pro inside Linux or WSL2**.

Recommended hardware:

- **Linux or WSL2 (Strongly Recommended)**
- NVIDIA GPU with **16 GB to 24 GB VRAM** (BF16 fits comfortably in ~16-18 GB VRAM with KV caching and offload)
- Python 3.12 recommended
- `git`, `ffmpeg`, and the standard audio libraries required by Fish Speech

## Setup

### Linux / WSL2 (Recommended)

From the TomoriBot repository root:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

The installer:

1. clones `Imagilux/fish-speech` into `servers/tts/fishs2/fish-speech/` and checks out the pinned runtime commit;
2. creates the isolated `.venv`;
3. installs Fish Speech plus the TomoriBot wrapper dependencies; and
4. downloads the official BF16 `fishaudio/s2-pro` checkpoint into `fish-speech/checkpoints/fish-speech-s2-pro/`.

A normal reinstall stays on the pinned runtime commit `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` rather
than following a moving branch. The model revision defaults to `main`; pin `FISH_S2_MODEL_REVISION` to
an immutable Hugging Face revision when a deployment must be reproducible. The installer settings are
listed under [Installer variables](#installer-variables).

The Hugging Face model is gated. Accept its license on Hugging Face first. If the download asks for authentication, run:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Then rerun the installer.

### Windows PowerShell (Best-Effort Only)

Native Windows is provided for evaluation only. Due to driver dispatch latency on uncompiled eager mode, generation will be extremely slow (~8-10 minutes per clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

The PowerShell installer targets CUDA GPU acceleration (`cu124`) by default. To install on a CPU-only machine without an NVIDIA GPU, pass `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

If PyTorch on Windows ever needs to be manually installed or updated with CUDA support, run:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot stops waiting for a voice message after `TTS_SYNTHESIZE_TIMEOUT_MS` (default 240000 ms), which
is shorter than a native Windows clip takes. Raise it in TomoriBot's `.env` (for example
`TTS_SYNTHESIZE_TIMEOUT_MS=900000`) while evaluating on Windows.

## Mandatory Reference Transcript

> [!WARNING]
> **Reference Text (`ref_text`) is required for voice cloning:** Fish S2 Pro's cross-attention mechanism requires the transcript of the reference audio to align phonetic tokens with acoustic codes.
>
> If you upload a voice sample without providing its matching reference transcript, Fish Speech **silently drops the reference audio tokens** and falls back to random zero-reference speech. The TomoriBot Fish wrapper validates and rejects synthesis requests that lack reference text with a `400 Bad Request` to prevent accidental unconditioned generation.

When adding a persona voice in `/config` under **Models > TTS Parameters & Voices**, always fill in the **Reference transcript** field with the verbatim text spoken in your reference audio clip.

## Register in TomoriBot

In `/providers`, choose **Add New Custom Endpoint** and configure:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Voice Source Mode: `Clone`
- Script Markup: `Bracket Tags`
- API key: leave empty for the default loopback setup. If bearer auth is enabled, enter the exact `FISH_S2_API_KEY` value.

Then add the endpoint's model entry and activate it through `/config` under Models > Switch Models.

## Add persona voices

1. Prepare a clean 10-20 second reference clip with one speaker and little or no background noise.
2. In `/config`, open Models > TTS Parameters & Voices and upload the voice sample.
3. **Enter the exact transcript** spoken in the reference clip into the reference text field.
4. In `/config`, open Persona > Voice and assign the sample to the persona.
5. Generate a voice message with `/generate voice-message` or let TomoriBot generate one through its voice-message tool.

## Expression controls

Fish S2 Pro can vary delivery within one utterance using bracket tags. For example:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Because the endpoint uses `Bracket Tags` markup, TomoriBot preserves these tags instead of stripping them before synthesis.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Fish Speech runtime directory |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro checkpoint directory |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Model repository and health metadata label for the configured checkpoint |
| `TOMORI_TTS_HOST` | `127.0.0.1` | TomoriBot wrapper bind address |
| `FISH_S2_PORT` | `8015` | Fish wrapper port; falls back to `TOMORI_TTS_PORT` when unset |
| `TOMORI_TTS_PORT` | unset | Backward-compatible shared port override |
| `FISH_S2_API_KEY` | unset | Optional bearer token, also required for authenticated remote binds |
| `TOMORI_TTS_API_KEY` | unset | Shared bearer-token fallback when `FISH_S2_API_KEY` is unset |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | Explicitly allow a non-loopback bind without a bearer token |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | Maximum decoded reference WAV size |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | unset | Shared decoded reference-audio limit fallback |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | Internal Fish API bind address |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Internal Fish API port |
| `FISH_S2_COMPILE` | `0` | Enable Fish Speech `torch.compile` (requires Linux/WSL2 with Triton) |
| `FISH_S2_HALF` | `0` | Request FP16 runtime mode |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish iterative prompt chunk length |
| `FISH_S2_TOP_P` | `0.8` | Sampling top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Sampling temperature |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Repetition penalty |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Maximum semantic tokens generated per request |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Cache encoded reference voices in the Fish runtime |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | Maximum script length accepted by the wrapper |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | Maximum time to wait for the nested Fish API |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | Maximum time to wait for one upstream synthesis request |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | How long `bun run launch --fishs2` waits for the wrapper's health check |

### Installer variables

Read by `install-fishs2.sh` and `install-fishs2.ps1`. Record any value you override so the deployment can be reproduced.

| Variable | Default | Purpose |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Fish Speech runtime repository, for example a reviewed mirror |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | Runtime commit checked out on install |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Hugging Face repository to download |
| `FISH_S2_MODEL_REVISION` | `main` | Hugging Face revision to download |
| `FISH_S2_UPDATE` | `0` | Set to `1` to deliberately update the runtime and re-download the model |
| `FISH_S2_UPDATE_REF` | unset | Runtime ref for an update. Without it, an explicit `FISH_S2_RUNTIME_REF` is kept; otherwise the update uses `main` |
| `FISH_S2_UPDATE_MODEL_REVISION` | unset | Model revision for an update, with the same precedence as `FISH_S2_UPDATE_REF` |

Reference audio must be a non-empty, uncompressed PCM RIFF/WAVE file. The decoded size limit is
checked before inference to prevent an oversized base64 request from consuming unbounded memory.

## Low-VRAM Option (INT8 Quantization)

Users running on GPUs with constrained VRAM (for example 8-12 GB) who cannot fit the official BF16 checkpoint can opt into the INT8 quantized model (`Imagilux/fishaudio-s2-pro`).

To install and run the INT8 checkpoint:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Start `server.py` from the same shell, or set the same three variables before launching it, so the wrapper loads the INT8 directory instead of the BF16 default.

The INT8 checkpoint reduces transformer weights from ~10.3 GB to ~5.1 GB while keeping audio embeddings and codec layers in BF16, fitting inside ~10 GB total VRAM.
