# TomoriBot Reference TTS Servers

These scripts are optional local wrapper servers for TomoriBot speech endpoints. They expose TomoriBot's `POST /synthesize` contract and keep model weights outside the Bun app.

Each engine lives in its own subfolder with its own `.venv` to keep dependencies isolated:

| Engine | Folder | Default port |
|---|---|---|
| Chatterbox (Turbo by default, optional Nano, English, event tags) | `chatterbox/` | 8011 |
| Qwen3-TTS 12Hz 1.7B Base / VoiceDesign auto mode (10 languages, plain text) | `qwen3tts/` | 8012 |
| MOSS-TTS Local v1.5 / VoiceGenerator auto mode (plain text) | `moss/` | 8018 |
| Irodori-TTS v4.1 (Japanese, clone + VoiceDesign, emoji tags) | `irodoritts/` | 8013 |
| Qwen3-TTS 12Hz 1.7B VoiceDesign (natural-language voice descriptions) | `qwen3tts/server.py --mode voice-design` | 8014 |
| Fish Audio S2 Pro INT8 (multilingual cloning, bracket expression tags) | `fishs2/` | 8015 |
| VoxCPM2 2B (30 languages, clone + VoiceDesign + controllable cloning) | `voxcpm2/` | 8016 |
| CosyVoice 3 0.5B (multilingual clone + cross-lingual clone + instructions) | `cosyvoice3/` | 8017 |

## Prerequisites

- **Python 3.10+**. VoxCPM2 currently requires Python 3.10-3.12.
- **CUDA-capable NVIDIA GPU** *(optional)* for fast local synthesis. CPU fallbacks are significantly slower.
- **ffmpeg** for TomoriBot voice-sample normalization.

## Setup

Each local server has its own setup guide under `docs/en/self-hosting/local-endpoints/text-to-speech/`. Modern servers include installer scripts where their upstream runtimes make that practical.

For VoxCPM2:

```powershell
# Windows PowerShell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

```bash
# Linux / WSL
bash servers/tts/voxcpm2/install-voxcpm2.sh
```

After setup, start it directly or use the launcher:

```sh
bun run launch --voxcpm2
```

Fish S2 Pro has its own installer because the local server also installs the Fish Speech runtime and downloads the checkpoint. See `docs/en/self-hosting/local-endpoints/text-to-speech/fishs2.md`. The default is the official BF16 `fishaudio/s2-pro` checkpoint; the guide covers the optional INT8 `Imagilux/fishaudio-s2-pro` checkpoint for smaller GPUs. The installer pins the Fish Speech runtime commit, and updating it means changing that pin.

CosyVoice 3 has its own installer because the server checks out the reviewed upstream runtime and downloads the pinned model snapshot. See `docs/en/self-hosting/local-endpoints/text-to-speech/cosyvoice3.md`.

## Registering in TomoriBot

Run `/providers`, choose **Add New Custom Endpoint**, and register the server as a Speech endpoint using API Compatibility `tts-clone`. Use the endpoint URL and voice-source mode documented for that engine.

Then use `/providers` to add the Speech model, and `/config` > Models > Switch Models to activate it.

For voice samples, open `/config` under Models > TTS Parameters & Voices. TomoriBot normalizes uploaded samples to WAV with ffmpeg. Assign clone samples or VoiceDesign prompts to personas under `/config` > Persona > Voice.

## Engine notes

Chatterbox defaults to Turbo. For the smaller Nano model, install the pinned upstream revision in the [Chatterbox guide](../../docs/en/self-hosting/local-endpoints/text-to-speech/chatterbox.md) and set `CHATTERBOX_FAST_MODEL=nano` before starting the server. The `/config` fast-model toggle chooses the configured Turbo or Nano model when enabled; disabling it selects standard Chatterbox for `cfg_weight` and `exaggeration` tuning.

Qwen3-TTS defaults to auto mode. One server URL can handle both clone and VoiceDesign requests: the server detects clone requests by `ref_audio`, detects VoiceDesign requests by `instruct`, and swaps the loaded model when needed. Start VoiceDesign only with `TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py` or `python servers/tts/qwen3tts/server.py --mode voice-design`.

MOSS-TTS uses the same auto request shapes. Its default clone checkpoint is the 4B Local Transformer v1.5 for a 16 GB GPU trial; `MOSS_TTS_CLONE_MODEL_ID` can select the 8B flagship on larger hardware. Run `python servers/tts/moss/prefetch_models.py` during setup to cache both models and their audio tokenizers. Auto mode warms clone at startup by default; `MOSS_TTS_WARM_MODE` can select voice-design or none. See the [MOSS setup guide](../../docs/en/self-hosting/local-endpoints/text-to-speech/moss.md) for the separate Python environment and model limitations.

Irodori-TTS v4.1 also supports TomoriBot's `Auto` voice source mode from one endpoint. Clone requests use `ref_audio`; VoiceDesign requests use `instruct`, which the wrapper maps to Irodori caption conditioning.

Fish S2 Pro is registered as a cloning endpoint with `Bracket Tags` markup. TomoriBot sends the stored reference WAV and transcript directly to Fish, while expression tags such as `[whisper]`, `[excited]`, and `[angry]` remain in the generated script for Fish's fine-grained delivery control.

Every wrapper binds to loopback by default and has no authentication. Read the Network access section of the [TTS overview](../../docs/en/self-hosting/local-endpoints/text-to-speech/README.mdx) before setting `TOMORI_TTS_HOST` to another address.

VoxCPM2 uses one official `openbmb/VoxCPM2` model for all modes. Reference audio maps to normal cloning, reference audio plus its stored transcript maps to Ultimate Cloning, and `instruct` is converted into VoxCPM2's natural-language Voice Design / controllable-cloning prefix. Register it with Voice Source Mode `Auto`, Script Markup `Plain`, and Supports Instruct `Yes`. If a clone request includes both a transcript and one-off instruction, the instruction path wins and the transcript prompt is omitted.

CosyVoice 3 is registered with Voice Source Mode `Clone`, Script Markup `Plain`, and Supports Instruct `Yes`. A matching transcript enables the zero-shot path; without one, the wrapper uses cross-lingual cloning. `voice_instructions` selects the instruction-conditioned path and takes precedence over the stored transcript.

## Manual tests

Two helpers have unit tests that no CI job runs. After changing one, run its test from the engine folder with that engine's venv (`.venv\Scripts\python.exe` on Windows):

```sh
cd servers/tts/cosyvoice3 && .venv/bin/python -m unittest test_reference_audio
cd servers/tts/irodoritts && .venv/bin/python -m unittest test_chunking
```
