---
title: "Supported Providers"
---

If you don't have the workstation to host your own models, TomoriBot supports a wide range of LLM providers, image generation APIs, voice services, and search tools, as well as features to mix-and-match them. There are plans to add in more providers.

### LLM Providers

| Provider | Streaming | Tool Calling | Image Input |Embeddings |Notes |
|----------|-----------|--------------|-------------|-------|-------|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ |Free Models Available |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ |Free Models Available |
| **Anthropic (API)** | ✅ | ✅ | ✅ |- | NOT Claude Code |
| **NovelAI** | ✅ | ✅ | - |- | Only GLM 4.6 can use Tools |
| **Nvidia** | ✅ | ✅ | ✅ | ✅ |Free Models Available | 
| **Deepseek** | ✅ | ✅ | - | - |- |
| **Z.ai** | ✅ | ✅ | ✅ | - |Free Models Available |
| **Z.ai Coding** | ✅ | ✅ | - | - |Subscription Plan ⚠️ ToS restricts to coding/agent use only |
| **Google Vertex AI** | ✅ | ✅ | ✅ |✅ | Includes 'free' Express version |
| **Codex CLI (via ChatMock)** | ✅ | ✅ | ✅ | - |via ChatMock (README for Instructions)) |

### Image Generation

| Provider | Text-to-Image | Image-to-Image | Inpainting | Notes |
|----------|---------------|----------------|-----------|-------|
| **Google** | ✅ | ✅ | - | - |
| **OpenRouter** | ✅ | ✅ | - | - |
| **NovelAI** | ✅ | ✅ | ✅ | Can be combined with other providers |
| **Nvidia** | ✅ | ✅ | - | - |
| **Z.ai** | ✅ | - | - | - |

### Video Generation

| Provider | Text-to-Video | Image-to-Video | Notes |
|----------|---------------|----------------|-------|
| **Google** | ✅ | ✅ | Async polling workflow |
| **OpenRouter** | ✅ | ✅ | Async polling workflow |
| **Z.ai** | ✅ | ✅ | Async polling workflow |

### Voice & Audio

| Provider | Text-to-Speech | Speech-to-Text |
|----------|----------------|-----------------|
| **ElevenLabs** | ✅ | ✅ |

### Search & Web Tools

| Provider | Search Type | MCP | Notes |
|----------|-------------|-----|-------|
| **Brave Search** | Web search, news, local | ✅ | REST API integration ⚠️ Set $5 usage limit in dashboard to avoid charges |
| **DuckDuckGo/Felo Search** | Web search, instant answers | ✅ | MCP server integration |
