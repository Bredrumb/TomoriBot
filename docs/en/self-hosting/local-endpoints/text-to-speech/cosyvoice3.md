---
title: "CosyVoice 3"
aiGenerated: true
---

Synthesize natural, multilingual character voices with instruction-based emotional delivery using Alibaba's [CosyVoice 3](https://github.com/QwenAudio/CosyVoice).

CosyVoice 3 provides zero-shot and cross-lingual voice cloning across 9 languages and over 18 Chinese dialects. TomoriBot wraps the official runtime in `servers/tts/cosyvoice3/` to expose the standard `POST /synthesize` speech interface. The bundled installer defaults to the official unquantized `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` model, running within 16 GB of VRAM.

CosyVoice supports nine languages and Chinese dialects. If Japanese pronunciation is poor, upstream recommends converting the text to katakana.

Use `Plain` script markup and provide delivery direction through `voice_instructions`. A matching reference transcript enables zero-shot cloning; without it, the server uses cross-lingual cloning. Instructions use the reference audio without its transcript.

## Hardware

Recommended hardware:

- NVIDIA GPU with 16 GB VRAM
- Python 3.10
- NVIDIA driver compatible with CUDA 12
- `git`
- `ffmpeg` for voice-sample normalization
- `sox` and `libsox-dev` on Linux if audio compatibility issues occur

The 0.5B parameter model fits easily in 16 GB VRAM without quantization. The checkpoint download includes flow models, speech tokenizers, text models, and reinforcement learning weights, requiring roughly 10 GB of disk space plus Python dependencies.

While CPU inference is technically supported upstream, it is too slow for Discord voice interactions.

## Installation

### Linux and WSL2 (recommended)

From the TomoriBot repository root:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Or start the configured server and TomoriBot together:

```bash
bun run launch --cosyvoice3
```

The installer downloads pinned runtime and model revisions and refuses to overwrite a checkout with uncommitted changes.

Upstream requirements install PyTorch 2.3.1 with CUDA 12.1 packages, CUDA 12 ONNX Runtime packages on Linux, and TensorRT 10.13 packages on Linux. If your GPU requires a newer PyTorch build, install a compatible PyTorch build inside the virtual environment after setup completes.

### Windows PowerShell

Native Windows is provided as a best-effort path:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WSL2 is strongly recommended for NVIDIA GPU usage on Windows. Upstream requirements install CPU-only ONNX Runtime on Windows, whereas Linux and WSL2 install GPU-accelerated packages.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and configure the speech endpoint:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Voice Source Mode: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

After saving the connection, select it and add a Speech model. A clear model code is `Fun-CosyVoice3-0.5B-2512`.

Then open `/config` > Models > Switch Models and activate the CosyVoice 3 speech endpoint.

## Assign a persona voice

For zero-shot voice cloning:

1. Prepare a clean 3 to 30 second audio clip with one speaker and minimal background noise.
2. Open `/config` under Models > TTS Parameters & Voices and upload the sample.
3. Enter the matching transcript when available. CosyVoice 3 tokenizes this transcript as a prompt prefix for zero-shot cloning; it should describe the first 30 seconds of the audio.
4. Open `/config` under Persona > Voice and assign the sample to the persona.

The wrapper trims reference audio to the first 30 seconds. Cross-lingual cloning can use a reference spoken in a different language from the generated text.

## Test with `/generate voice-message`

Use `/generate voice-message` to test synthesis without waiting for an automated chat trigger. You can test with the persona's assigned sample or upload a one-off clip with its transcript.

To guide emotion and delivery, enter direction in the modal or let the persona prompt supply `voice_instructions`. Keep the spoken text as plain dialogue; inline style tags are removed before synthesis.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Local checkpoint directory |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Wrapper bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Wrapper port |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Enable CosyVoice's internal streaming generator |
| `COSYVOICE3_SPEED` | `1.0` | Global numeric speed multiplier passed to upstream inference |
| `COSYVOICE3_DEFAULT_INSTRUCT` | empty | Optional instruction added when a request does not provide one |
| `COSYVOICE3_FP16` | `0` | Ask the official runtime to use its fp16 mode |
| `COSYVOICE3_LOAD_TRT` | `0` | Enable upstream TensorRT loading when properly prepared |
| `COSYVOICE3_LOAD_VLLM` | `0` | Enable upstream vLLM loading when its separate dependencies are installed |

By default, TensorRT, vLLM, and fp16 remain disabled. The standard PyTorch runtime runs comfortably on 16 GB GPUs without additional runtime dependencies.

## Model variants

To try the included RL weights, copy the model directory, rename `llm.rl.pt` to `llm.pt` in the copy, and set `COSYVOICE3_MODEL_DIR` to it. Optional vLLM and TensorRT runtimes require separate dependencies.

## License

The CosyVoice codebase and `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` weights are published under the Apache-2.0 license.

The upstream model card notes that demonstration materials are for academic evaluation. TomoriBot does not distribute model weights. Review upstream licensing and terms for your specific use case before deploying commercially.
