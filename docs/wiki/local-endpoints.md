---
title: "Local & Self-Hosted Endpoints"
---


### Local LLM (Text / Embeddings)

Any OpenAI-compatible server works out of the box using the `/custom-endpoints` command category. Popular options:

| Server | Notes |
|--------|-------|
| [Ollama](https://ollama.com) | Easiest local LLM setup; enable OpenAI-compat mode |
| [KoboldCPP](https://github.com/LostRuins/koboldcpp) | GGUF models; OpenAI-compat mode built in |
| [LM Studio](https://lmstudio.ai) | GUI-based; exposes a local `/v1` server |
| [vLLM](https://github.com/vllm-project/vllm) | High-throughput GPU serving |
| [LiteLLM](https://github.com/BerriAI/litellm) | Unified proxy over many backends |
| [ChatMock](../user-guides/setup-chatmock.md) | Local OpenAI-compat bridge for Codex CLI |

Configure via `/custom-endpoints` in Discord, pointing at your local endpoint URL (e.g. `http://192.168.1.10:11434/v1`).


### Local Image Generation (ComfyUI)

TomoriBot ships a ready-to-use Anima v1 ComfyUI workflow for txt2img and img2img. Use `/help custom-endpoint` to learn how to create a TomoriBot-compatible ComfyUI workflow for images and videos as well.

- **Anima v1 workflow**: [`assets/comfyui-workflows/tomoribot-anima-v1-comfyui.json`](../../assets/comfyui-workflows/tomoribot-anima-v1-comfyui.json)
- **Workflow notes**: [`assets/comfyui-workflows/README.md`](../../assets/comfyui-workflows/README.md)
- Upload the `.json` workflow during `/provider custom-endpoints add` (capability: `image`, API style: `comfyui`)
- ComfyUI must be reachable on the network, TomoriBot polls its `/history` endpoint until the image is ready

### Local TTS (Voice Messages)

Three reference FastAPI wrapper servers are included, each exposing a `/synthesize` endpoint that TomoriBot calls for native Discord voice messages. All of which support voice cloning

| Engine | Folder | Model | Strength |
|--------|--------|-------|---------|
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | [`servers/tts/chatterbox/`](../../servers/tts/chatterbox/) | Chatterbox Turbo | English, lightweight, expressive bracket tags |
| [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) | [`servers/tts/qwen3tts/`](../../servers/tts/qwen3tts/) | Qwen3-TTS 1.7B Base | Large but accurate multilingual reference-audio cloning (RECOMMENDED) |
| [IrodoriTTS](https://huggingface.co/Aratako/Irodori-TTS-500M-v2) | [`servers/tts/irodoritts/`](../../servers/tts/irodoritts/) | Irodori-TTS 500M v2 | Japanese-focused reference-audio cloning, styles with emojis |

Each folder contains a `server.py` and `requirements.txt`. Start the server, then register it in Discord with `/provider custom-endpoints add` (capability: `speech`). Upload a short reference audio clip via `/speech voice-add` and assign it to a persona with `/speech voice-assign`. The clip can be in any audio format (TomoriBot automatically converts it to mono WAV), but it is strongly recommended to use a 10-20 second clip with no background music.

ElevenLabs is also supported as a cloud TTS/STT option via `/speech elevenlabs`.

### Local STT (Audio Transcription)

A reference WhisperX server is included for transcribing audio attachments sent to TomoriBot.

- **Server script**: [`servers/stt/whisperx_server.py`](../../servers/stt/whisperx_server.py)
- Exposes the standard OpenAI `/v1/audio/transcriptions` endpoint shape
- Compatible alternatives: whisper.cpp HTTP mode, KoboldCPP STT

Register via `/custom-endpoints add` (capability: `transcription`). Use `/help transcription` in Discord for a step-by-step setup guide.

### Local Search & Web Tools

TomoriBot can route her built-in web tools through your own self-hosted infrastructure to avoid public API limits and improve parsing quality.

| Sidecar | Tool | Purpose | Guide |
|---------|------|---------|-------|
| **SearXNG** | `web_search` | Privacy-respecting metasearch engine proxy to avoid rate limits | [Setup Guide](../user-guides/setup-searxng.md) |
| **Crawl4AI** | `fetch_url` | Browser-rendered markdown extraction for JS-heavy sites | [Setup Guide](../user-guides/setup-crawl4ai.md) |

### Starting Sidecars with `bun run launch`

Instead of starting sidecar services manually, use `bun run launch` which starts the requested sidecars, waits for them to be ready, then launches the bot in watch mode automatically:

```sh
# Bot only, identical to bun run dev
bun run launch

# With SearXNG and Crawl4AI Docker sidecars
bun run launch --searxng --crawl4ai

# With a local TTS server (venv must be set up first — see docs/integrations/voice/tts/)
bun run launch --qwen3tts

# See all available flags
bun run launch --help
```

Available flags: `--searxng`, `--crawl4ai`, `--qwen3tts`, `--chatterbox`, `--irodoritts`, `--whisperx`

Docker sidecars (`--searxng`, `--crawl4ai`) are created on first run and reused on subsequent runs. Python TTS/STT sidecars require their venv to be set up once beforehand; see the individual setup guides in `docs/integrations/voice/`.

**Ctrl+C** stops the bot and any Python sidecar processes. Docker containers are intentionally left running — stop them manually with `docker stop searxng` / `docker stop crawl4ai` when done.
