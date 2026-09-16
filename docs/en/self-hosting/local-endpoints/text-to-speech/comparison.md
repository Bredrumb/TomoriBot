---
title: "TTS Engine Comparison"
aiGenerated: false
sidebar:
  order: 1
---

TomoriBot supports multiple local Text-to-Speech sidecars, each suited for different languages, hardware profiles, and latency requirements.

This page provides empirical benchmark results, synthesis timings, and audio comparison clips recorded in an identical test environment with matching voice cloning references.

## Multilingual & English Voice Cloning

### Benchmark Prompts

- **Standard Prompt** *(used for Chatterbox, MOSS-TTS, CosyVoice 3, VoxCPM2, Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Fish Audio S2 Pro Prompt** *(tested with bracket expression tags)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Performance & Audio Comparison

Timings report both the **full generation time** (total wall-clock seconds from request to finished audio) and the **Real-Time Factor (RTF)**, defined as $\frac{\text{generation time}}{\text{audio duration}}$:

- **RTF < 1.0 (Bold):** The engine generates speech faster than real time (e.g. `0.50× RTF` renders a 10-second clip in 5 seconds). This is required for live voice chat, as the bot can stream audio packets continuously without falling behind.
- **RTF > 1.0:** Generation takes longer than the spoken audio. While suitable for static `/synthesize` replies in text channels, a live voice call would starve its playback buffer and pause.

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Audio Sample |
|---|---|---|---|---|
| **[Fish Audio S2 Pro](./fishs2/)** | ~8–10 min<sup>(2)</sup><br/>*(~65× RTF)* | Untested | Untested | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| **[Chatterbox (Turbo)](./chatterbox/)** | **~5.0s** *(8.7s clip)*<br/>**0.57× RTF** | Untested | Untested | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| **[MOSS-TTS](./moss/)** | ~12.0s *(8.8s clip)*<br/>1.36× RTF | Untested | Untested | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| **[CosyVoice 3](./cosyvoice3/)** | **~6.0s** *(13.9s clip)*<br/>**0.43× RTF** | Untested | Untested | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| **[VoxCPM2](./voxcpm2/)** | ~8.0s *(7.4s clip)*<br/>1.09× RTF | Untested | Untested | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| **[Qwen3-TTS](./qwen3tts/)** | ~10.0s *(9.2s clip)*<br/>1.09× RTF | Untested | Untested | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **Test Environment**: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) on Windows 11 (native execution) using a 26.6-second 24 kHz mono reference audio sample with matching verbatim transcript.
- <sup>(2)</sup> **Fish Audio S2 Pro**: Windows execution runs in uncompiled eager mode (~65× RTF) due to CUDA kernel launch latency across its 76 layer evaluations per token. Running on Linux or WSL2 with OpenAI Triton compiler fusion (`torch.compile`) is recommended to avoid this dispatch stall.

---

## Japanese Voice Cloning

### Benchmark Prompt

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Performance & Audio Comparison

| Engine | Windows Native<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Audio Sample |
|---|---|---|---|---|
| **[IrodoriTTS](./irodoritts/)** | **~4.0s** *(8.5s clip)*<br/>**0.47× RTF** | Untested | Untested | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Measured in the same RTX 4070 Ti SUPER Windows 11 test environment.

---

## Which Engine Should You Choose?

- **Choose [Fish Audio S2 Pro](./fishs2/)** if you want the highest possible vocal fidelity, fine-grained expressive bracket tags (`[whisper]`, `[laughs]`, `[sigh]`), and you have access to **Linux or WSL2** where Triton compiler fusion can be enabled.
- **Choose [Chatterbox Turbo](./chatterbox/)** if you want rapid English voice cloning with small VRAM footprint and support for event tags (`[laughter]`, `[sigh]`, `[giggle]`).
- **Choose [MOSS-TTS](./moss/)** for experimental multi-modal voice cloning and text-described English/Chinese voice generation.
- **Choose [CosyVoice 3](./cosyvoice3/)** if you need high-quality multilingual zero-shot cloning with natural language delivery direction (`"Speak in English with excitement"`).
- **Choose [VoxCPM2](./voxcpm2/)** if you need comprehensive multilingual support (30 languages), transcript-assisted Ultimate Cloning, and natural voice design.
- **Choose [Qwen3-TTS](./qwen3tts/)** if you want clean multi-language cloning with flexible voice design and stable prompt adherence.
- **Choose [IrodoriTTS](./irodoritts/)** if your bot speaks Japanese. It is the fastest engine available (~4s on Windows) and natively parses Unicode emojis (`😊`, `😢`, `😡`) to modulate character emotion.

---

## Compare the Engines

All TomoriBot sidecars currently return a complete WAV to the bot.

| Engine | Model size; 16 GB GPU | Languages | Voice sources and controls | Speed / streaming path | Choose it for |
|---|---|---|---|---|---|
| [Chatterbox](./chatterbox/) | 350M Turbo or 110M Nano; yes, Nano can use CPU | English | Reference cloning, supported event tags; standard model offers CFG/exaggeration | Fast/small focus; wrapper returns full WAV | Small English clone setup or CPU experiments |
| [Qwen3-TTS](./qwen3tts/) | 1.7B per mode; yes, models swap | 10, including English/Japanese | Clone or text-described VoiceDesign | Quality-focused; upstream streaming, wrapper buffers | General-purpose multilingual clone and Japanese VoiceDesign |
| [MOSS-TTS](./moss/) | 4B clone + ~1.7B design, swapped; 16 GB is a trial target, not verified; 8B flagship likely no | Clone: 31, including Japanese; design: English/Chinese | Clone or text-described VoiceGenerator; clone language tags | Experimental; Local clone has upstream streaming backend, wrapper buffers | Compare MOSS clone quality or English/Chinese voice design |
| [IrodoriTTS](./irodoritts/) | ~0.8B current v4.1 Small; ~3–4 GB VRAM observed in one local run | Japanese only | Clone or VoiceDesign; emoji style cues | Sampling steps trade quality for speed; wrapper buffers | Small-footprint Japanese voices and emoji-driven delivery |
| [Fish S2 Pro](./fishs2/) | 4B; official BF16 default (~16–18 GB), optional INT8 for 16 GB | 83 claimed upstream | Reference cloning (requires ref transcript), free-form bracket expression tags | Heavy Dual-AR model; requires Linux/WSL2 with Triton for fast synthesis (~65× RTF on Windows eager mode) | Fine-grained expressive cloning; check research-license terms |
| [VoxCPM2](./voxcpm2/) | 2B; ~8 GB BF16 reported upstream | 30 | Clone, Voice Design, transcript-assisted Ultimate Cloning, delivery instructions | ~0.30 RTF on upstream RTX 4090; upstream streaming, wrapper buffers | One multilingual model with the broadest voice-source controls |
| [CosyVoice 3](./cosyvoice3/) | 0.5B core; 16 GB comfortable, download/runtime larger | 9, including Japanese, plus Chinese dialects | Clone, cross-lingual clone, natural-language delivery | Low-latency focus; native text/audio streaming upstream, wrapper buffers | A future streaming candidate with cross-lingual cloning |

Model size and language counts follow the [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2), and [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) upstream pages. Check each guide for OS, driver, license, model revision, and memory details. A 16 GB GPU cannot necessarily host a TTS model and a large local LLM simultaneously.

The Irodori VRAM figure is a single local observation, not a published minimum or cross-engine benchmark. Memory use varies with the runtime, precision, script length, and other GPU workloads.

The first Qwen3-TTS auto request includes model loading. MOSS pre-downloads both models during setup and warms the clone model at startup by default, but either auto server still has to load the other model after a mode switch. TomoriBot waits up to `TTS_SYNTHESIZE_TIMEOUT_MS` (default 240000 ms) for each complete response.
