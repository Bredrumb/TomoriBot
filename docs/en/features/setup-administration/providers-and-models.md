---
title: "Providers & Models"
sidebar:
  order: 1
---

TomoriBot connects to external AI providers rather than hosting a built-in model. You can
connect hosted services like Google Gemini, OpenRouter, and NovelAI, or point her at local
self-hosted endpoints. You need at least one provider to start chatting.

## API Keys
<!-- anchor: api-keys -->

Add a provider key during first-time setup with `/setup`, or later from `/providers` by choosing
`+ Add new Provider`. Keys are encrypted at rest, so no one, including server admins, can read
them back.

In `/setup`, choose a hosted provider, a custom endpoint, or User BYOK for a server where members
supply their own providers. Setup saves changes when you finish. Use `/providers` to replace a key;
saved sampler settings are preserved.

Each provider has its own key-generation steps. In `/help`, choose `Setup`, then
`Get an API Key`, and pick your provider for a step-by-step walkthrough, or use these starting points:

| Provider | Notes | Get a key |
|---|---|---|
| Google Gemini | Free tier, runs every feature. Recommended first setup. | [AI Studio](https://aistudio.google.com/apikey) |
| OpenRouter | One key, many models (some free). | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| NovelAI | Subscription; uncensored storytelling and roleplay (text only). | [NovelAI](https://novelai.net/) |
| DeepSeek | Pay-as-you-go reasoning models. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | Hosted text, embeddings, and image. | [NVIDIA Build](https://build.nvidia.com/) |
| Anthropic | Claude models via the API (not Claude Code). | [Anthropic](https://console.anthropic.com/) |
| Z.ai | GLM family. ⚠️ ToS restricts usage to coding and agent scenarios. | [Z.ai](https://z.ai/) |
| Vertex AI | Google Cloud via `gcloud` ADC (best for locally-run or dev setups). | see below |
| Vertex AI Express | Google Cloud API-key BYOK (Preview, Gemini subset). | [Express Mode](https://console.cloud.google.com/expressmode) |
| Custom | Any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, …). | see [Custom Endpoints](#custom-endpoints) |

:::caution
Never share your API key with anyone else. Add or replace a custom endpoint's Bearer auth token
from its `Edit Endpoint` action in `/providers`.
:::

Vertex AI authenticates with Application Default Credentials (ADC) rather than a stored secret.
For local hosting, ADC can come from `gcloud`; hosted deployments should use a workload identity
or service account. An AI Studio API key alone does not authenticate full Vertex AI. The selected
Google Cloud project must have billing and the Vertex AI API enabled, and the host identity needs
Vertex access. The setup guide is available from Google Vertex AI on the `API Keys` page in `/help`.

Brave Search is separate from your AI provider. Add its key in `/providers` to enable more search
categories; see [Web search](/features/capabilities/tools-and-extensions/web-search/).

## Choosing Models

Use `/providers` to manage server credentials, model catalogs, and endpoint registrations.
Then use `/config` > Models > Switch Models to select the shared capability assignments every
member of the server uses. Both commands require server management permissions.

Members can set up their own providers and models with `/personal providers` and `/personal config`.
Personal settings follow them across servers; see
[Personalization](/features/knowledge/personalization/#your-own-providers).

In `/config` > Models > Switch Models, you can assign models and endpoints across these capability slots:

- **Text**: the main chat model.
- **Vision**: reads images when the chat model cannot.
- **Embeddings**: powers the [document knowledge base](/features/knowledge/memory/#document-knowledge-base-rag).
- **Decision**: a registered [Decision model](#decision-models). [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) uses it to decide when to join a conversation.
- **Standard Image**: standard image generation (see [Image Generation](/features/capabilities/media-generation/image-generation/)).
- **NovelAI Image**: NovelAI image generation.
- **Video**: video generation.
- **TTS (Voice Design)**: speaks using a saved voice description.
- **TTS (Voice Clone)**: speaks using a reference sample or provider voice.
- **STT Endpoint**: speech-to-text audio transcription endpoint.

:::tip
`- No Model` in the Vision slot does not make a vision-capable chat model blind: it can still read
images directly. The Vision slot provides a separate model for image analysis when the chat model
cannot see images.
:::

Speech has separate voice design and voice clone slots. See
[Voice: TTS & STT](/features/capabilities/media-generation/tts-and-stt/) for setup and provider
support. You can also manage backup keys in `/providers`.

:::tip
Adding one backup key to an AI provider turns on rotation for that provider. Requests rotate across
the primary key and its backups, and a key that hits a rate limit is skipped for 60 seconds.
:::

## Decision Models
<!-- anchor: decision-models -->

Decision models answer structured questions, such as yes/no or a choice from a list. They are separate
from the chat model. [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges)
can use one to decide when a persona should join a conversation.

Register an OpenRouter Decision model or a compatible custom endpoint in `/providers` or
`/personal providers`. Select the server's model under `/config` > `Models` > `Switch Models`.
Custom services must support System One or OpenAI Decisions compatibility. Register models from the
service's documentation; a successful connection does not verify their capabilities.

## Custom Endpoints
<!-- anchor: custom-endpoints -->

Custom endpoints connect self-hosted or proxy-backed services such as Ollama, LM Studio, vLLM,
ComfyUI, and local speech servers. Register a server endpoint in `/providers` or a personal endpoint
in `/personal providers`.

Choose the API compatibility supported by your service, then register its exact model and supported
capabilities. A connection can group models that share one endpoint URL. Personal local speech
endpoints are not supported.

For setup instructions, see [Local LLM](/self-hosting/local-endpoints/setup-local-llm/),
[ComfyUI](/self-hosting/local-endpoints/setup-comfyui/), and
[ChatMock](/self-hosting/local-endpoints/setup-chatmock/).

## Supported Providers
<!-- anchor: supported-providers -->

If you do not have the hardware to host your own models, TomoriBot supports a wide range of
cloud services. Not every feature is available on every provider.

### LLM Providers

| Provider | Streaming | Tool Calling | Image Input | Embeddings | Notes |
|---|---|---|---|---|---|
| Google Gemini | ✅ | ✅ | ✅ | ✅ | Free models available |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | Free models available |
| Anthropic (API) | ✅ | ✅ | ✅ | - | Not Claude Code |
| NovelAI | ✅ | ✅ | - | - | Only GLM 4.6 can use tools |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | Free models available |
| DeepSeek | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | Free models; ⚠️ ToS = coding and agent use only |
| Z.ai Coding | ✅ | ✅ | - | - | Subscription plan |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | Includes 'free' Express version |
| Codex CLI (via ChatMock) | ✅ | ✅ | ✅ | - | [Setup](/self-hosting/local-endpoints/setup-chatmock/) |

### Image Generation

| Provider | Text-to-Image | Image-to-Image | Inpainting | Notes |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | Can combine with other providers |
| NVIDIA | ✅ | - | - | Text-to-image only; reference images are ignored |
| Z.ai | ✅ | - | - | - |

These are default capabilities. When registering an image model, declare the modes its API supports;
unsupported modes fail at generation time. NovelAI uses its own image pipeline.

### Video Generation

| Provider | Text-to-Video | Image-to-Video | Notes |
|---|---|---|---|
| Google | ✅ | ✅ | Async polling workflow |
| OpenRouter | ✅ | ✅ | Async polling workflow |
| Z.ai | ✅ | ✅ | Async polling workflow |

### Voice & Audio

| Provider | Text-to-Speech | Speech-to-Text |
|---|---|---|
| ElevenLabs | ✅ | ✅ |
| Google Gemini | Voice Design | No |
| Vertex AI (standard, global) | Voice Design | No |
| OpenRouter Fish | Voice Clone | No |
| OpenRouter Seed Audio | Voice Design | No |

Local voice engines are covered under [Self-Hosting](/self-hosting/). For built-in web search and
URL reading, see [Tools & Extensions](/features/capabilities/tools-and-extensions/web-search/).
