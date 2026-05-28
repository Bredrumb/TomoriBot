# Local & Self-Hosted Endpoints

### Local LLM (Text / Embeddings)

Any OpenAI-compatible server works out of the box using the `/custom-endpoints` command category. Popular options:

| Server | Notes |
|--------|-------|
| [Ollama](https://ollama.com) | Easiest local LLM setup; enable OpenAI-compat mode |
| [KoboldCPP](https://github.com/LostRuins/koboldcpp) | GGUF models; OpenAI-compat mode built in |
| [LM Studio](https://lmstudio.ai) | GUI-based; exposes a local `/v1` server |
| [vLLM](https://github.com/vllm-project/vllm) | High-throughput GPU serving |
| [LiteLLM](https://github.com/BerriAI/litellm) | Unified proxy over many backends |

Configure via `/custom-endpoints` in Discord, pointing at your local endpoint URL (e.g. `http://192.168.1.10:11434/v1`).

### Local Image Generation (ComfyUI)

TomoriBot ships a ready-to-use Anima3 ComfyUI workflow for txt2img and img2img. Use `/help custom-endpoint` to learn how to create a TomoriBot-compatible ComfyUI workflow for images and videos as well.

- **Anima3 workflow**: [`scripts/comfyui-workflows/tomoribot-anima3-comfyui.json`](../../scripts/comfyui-workflows/tomoribot-anima3-comfyui.json)
- **Workflow notes**: [`scripts/comfyui-workflows/README.md`](../../scripts/comfyui-workflows/README.md)
- Upload the `.json` workflow during `/config custom-endpoints add` (capability: `image`, API style: `comfyui`)
- ComfyUI must be reachable on the network, TomoriBot polls its `/history` endpoint until the image is ready

### Local TTS (Voice Messages)

Three reference FastAPI wrapper servers are included, each exposing a `/synthesize` endpoint that TomoriBot calls for native Discord voice messages. All of which support voice cloning

| Engine | Folder | Model | Strength |
|--------|--------|-------|---------|
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | [`scripts/tts/chatterbox/`](../../scripts/tts/chatterbox/) | Chatterbox Turbo | English, lightweight, expressive bracket tags |
| [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) | [`scripts/tts/qwen3tts/`](../../scripts/tts/qwen3tts/) | Qwen3-TTS 1.7B Base | Large but accurate multilingual reference-audio cloning (RECOMMENDED) |
| [IrodoriTTS](https://huggingface.co/Aratako/Irodori-TTS-500M-v2) | [`scripts/tts/irodoritts/`](../../scripts/tts/irodoritts/) | Irodori-TTS 500M v2 | Japanese-focused reference-audio cloning, styles with emojis |

Each folder contains a `server.py` and `requirements.txt`. Start the server, then register it in Discord with `/config custom-endpoints add` (capability: `speech`). Upload a short reference audio clip via `/speech voice-add` and assign it to a persona with `/speech voice-assign`. The clip can be in any audio format (TomoriBot automatically converts it to mono WAV), but it is strongly recommended to use a 10-20 second clip with no background music.

ElevenLabs is also supported as a cloud TTS/STT option via `/speech elevenlabs`.

### Local STT (Audio Transcription)

A reference WhisperX server is included for transcribing audio attachments sent to TomoriBot.

- **Server script**: [`scripts/stt/whisperx_server.py`](../../scripts/stt/whisperx_server.py)
- Exposes the standard OpenAI `/v1/audio/transcriptions` endpoint shape
- Compatible alternatives: whisper.cpp HTTP mode, KoboldCPP STT

Register via `/custom-endpoints add` (capability: `transcription`). Use `/help transcription` in Discord for a step-by-step setup guide.
