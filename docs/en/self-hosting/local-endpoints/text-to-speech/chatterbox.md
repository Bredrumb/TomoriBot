---
title: "Chatterbox TTS"
aiGenerated: true
---

Clone English voices with emotion tags using the local [Chatterbox](https://github.com/resemble-ai/chatterbox) text-to-speech server.

Chatterbox runs locally via `servers/tts/chatterbox/server.py`. It defaults to the fast Chatterbox-Turbo model (350M parameters) with inline emotion event tags like `[laugh]` and `[sigh]`. You can also configure the lightweight Chatterbox-Nano model (110M parameters) for CPU setups or the standard 0.5B model for classifier-free guidance (`cfg_weight`) and emotional `exaggeration` tuning. This wrapper does not load Chatterbox Multilingual V3.

## Setup

Run these commands from the TomoriBot repo root, the folder where you cloned TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Keep that terminal open while TomoriBot is using Chatterbox. The default endpoint URL is `http://127.0.0.1:8011`; set `CHATTERBOX_PORT` to use another port.

### Optional: use Chatterbox-Nano

Nano requires a Chatterbox build with the `nano=True` loader option. After the normal setup above, install the pinned upstream revision in the same virtual environment. The commit hash fixes the compatible source version; it is not a security guarantee. This command requires `git` and keeps the already installed runtime dependencies:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Then set `CHATTERBOX_FAST_MODEL=nano` before starting the wrapper. Leave the variable unset for Turbo. On Windows PowerShell, set it with `$env:CHATTERBOX_FAST_MODEL = "nano"`; on Linux or macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. The `/health` response reports `fast_model` so you can verify the loaded choice. Nano and Turbo use the same cloning request and supported event tags. Both are English-only.

The `/config` fast-model toggle must stay enabled to use Nano or Turbo. Disabling it selects the standard Chatterbox 0.5B model for CFG weight and exaggeration tuning.

### Standard Chatterbox

To use the Standard model, disable `Fast Model (Turbo)` under `/config` > Models > TTS Parameters & Voices. Standard supports `cfg_weight` and `exaggeration` tuning, but not bracket event tags.

## Register in TomoriBot

Include `Chatterbox` in the endpoint label or model name. TomoriBot recognizes a Chatterbox endpoint only by that name (or an endpoint URL containing it), so the Turbo tag whitelist, the standard-model tag stripping, and the Chatterbox options in `/generate voice-message` apply only when it is present.

Run `/providers`, choose `Add New Custom Endpoint`, and use the speech API compatibility:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

After saving the connection, select it and choose `+ Add new Speech Model` from the model dropdown. Choose `Voice Clone` as the `Voice Source Mode` and `Bracket Tags` as the `Script Markup Style` so delivery tags survive the send.

Use `/providers` for endpoint registration and model setup. Then open `/config` > Models > Switch Models to select and activate the registered endpoint.

## Set up a persona voice

1. Prepare a clean 10-second voice clip with one speaker and no background music.
2. Open `/config` under Models > TTS Parameters & Voices and upload the clip.
3. Open `/config` under Persona > Voice, then choose the persona and the voice sample.

Chatterbox requires more than 5 seconds of audio. Aim for 10 seconds; the model uses a limited portion of longer clips for conditioning.

## Optional tuning

In `/config` > Models > TTS Parameters & Voices, adjust `cfg_weight` and `exaggeration` for the Standard model. Both default to `0.5`; higher values follow the reference more closely and increase expressiveness, respectively.

Supported Turbo/Nano event tags are `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]`, and `[laugh]`. Unsupported descriptors such as `[excited]`, `[whisper]`, or `[smiles]` are stripped instead of being sent to TTS.
