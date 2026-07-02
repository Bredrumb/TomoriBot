---
title: "Providers & Models"
sidebar:
  order: 7
---

TomoriBot doesn't have a built-in AI brain — you connect one. A **provider** is an AI
service (Google Gemini, OpenRouter, NovelAI, a local endpoint, …), and a **model** is a
specific model on that provider. You need at least one provider to use her at all.

## API Keys

Add a provider key during first-time setup with `/config setup`, or later with
`/config api-key set`. Keys are **encrypted at rest** — no one, including server admins, can
read them back.

Each provider has its own key-generation steps. Run **`/help api-key`** and pick your
provider for the exact walkthrough, or use these starting points:

| Provider | Notes | Get a key |
|---|---|---|
| **Google Gemini** | Free tier, runs every feature. Recommended first setup. | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | One key, many models (some free). | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| **NovelAI** | Subscription; uncensored storytelling/roleplay (text only). | [NovelAI](https://novelai.net/) |
| **DeepSeek** | Pay-as-you-go reasoning models. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | Hosted text, embeddings, and image. | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | Claude models via the API (not Claude Code). | — |
| **Z.ai** | GLM family. ⚠️ ToS restricts usage to coding/agent scenarios. | [Z.ai](https://z.ai/) |
| **Vertex AI** | Google Cloud via `gcloud` ADC — best for locally-run/dev setups. | see below |
| **Vertex AI Express** | Google Cloud API-key BYOK (Preview, Gemini subset). | [Express Mode](https://console.cloud.google.com/expressmode) |
| **Custom** | Any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, …). | see [Custom Endpoints](#custom-endpoints) |

:::caution
Never share your API key. Custom endpoints can add a Bearer auth token after setup with
`/config api-key set`.
:::

**Vertex AI** authenticates with Application Default Credentials rather than a stored secret,
so it involves a short `gcloud` CLI setup. The full step-by-step lives in
`/help api-key provider:Google Vertex AI`. ⚠️ Projects starting with `gen-lang-client-`
(auto-created by AI Studio) won't work with Vertex — create a proper project.

### Optional: Brave Search key

Brave Search is separate from your AI provider and only enhances web search (adds image,
video, and news search). Set it with `/optional-key brave set`. ⚠️ Brave includes $5/month
free credit — set a $5 usage limit in the Brave dashboard to avoid charges.

## Choosing Models

After a provider is set, pick which model each capability uses:

- `/model text` — the main chat model
- `/model vision` — a vision model (for reading images when the chat model can't)
- `/model image` — image generation (see [Image Generation](/features/media-generation/image-generation/))
- `/model video` — video generation
- `/model embedding` — embeddings for the [document knowledge base](/features/memory/#document-knowledge-base-rag)
- `/model speech` / `/model transcription` — [voice](/features/media-generation/tts-and-stt/)

You can also manage backup keys for automatic failover and load balancing with
`/config api-key rotation`.

## Custom Endpoints

Custom endpoints let you register self-hosted or proxy-backed services — Ollama, LM Studio,
LiteLLM, vLLM, ComfyUI, local TTS/STT — as **labeled provider bundles**.

- **Server scope:** `/provider custom-endpoint add` / `remove`.
- **Personal scope:** `/personal custom-endpoint add` / `remove` (just you — see
  [Personalization](/features/personalization/#your-own-providers)).

A **label** groups every capability under one bundle. After registering, select the label
from `/model text`, `/model image`, `/model video`, etc.; if a label has several models for a
capability, a picker lets you choose. Re-run the add command with the same label and
capability but a different model name to register an additional model on that connection (its
URL and API style are inherited).

For full walkthroughs of running the servers, see:

- [Setup: Local LLM](/self-hosting/setup-local-llm/) — Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Setup: ComfyUI](/self-hosting/setup-comfyui/) — local image/video generation.
- [Setup: ChatMock](/self-hosting/setup-chatmock/) — ChatGPT account / Codex CLI.

## Supported Providers

If you don't have the hardware to host your own models, TomoriBot supports a wide range of
services. Not every feature is available on every provider.

### LLM Providers

| Provider | Streaming | Tool Calling | Image Input | Embeddings | Notes |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | Free models available |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | Free models available |
| **Anthropic (API)** | ✅ | ✅ | ✅ | – | Not Claude Code |
| **NovelAI** | ✅ | ✅ | – | – | Only GLM 4.6 can use tools |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | Free models available |
| **DeepSeek** | ✅ | ✅ | – | – | – |
| **Z.ai** | ✅ | ✅ | ✅ | – | Free models; ⚠️ ToS = coding/agent use only |
| **Z.ai Coding** | ✅ | ✅ | – | – | Subscription plan |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | Includes 'free' Express version |
| **Codex CLI (via ChatMock)** | ✅ | ✅ | ✅ | – | [Setup](/self-hosting/setup-chatmock/) |

### Image Generation

| Provider | Text-to-Image | Image-to-Image | Inpainting | Notes |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | – | – |
| **OpenRouter** | ✅ | ✅ | – | – |
| **NovelAI** | ✅ | ✅ | ✅ | Can combine with other providers |
| **NVIDIA** | ✅ | ✅ | – | – |
| **Z.ai** | ✅ | – | – | – |

### Video Generation

| Provider | Text-to-Video | Image-to-Video | Notes |
|---|---|---|---|
| **Google** | ✅ | ✅ | Async polling workflow |
| **OpenRouter** | ✅ | ✅ | Async polling workflow |
| **Z.ai** | ✅ | ✅ | Async polling workflow |

### Voice & Audio

| Provider | Text-to-Speech | Speech-to-Text |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

Local voice engines are covered under [Self-Hosting](/self-hosting/). For the built-in web
search and URL-fetch engines, see [Tools & Extensions](/features/tools-and-extensions/#web-search--url-reading).
