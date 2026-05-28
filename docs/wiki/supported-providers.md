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

The LLM sees a single unified `web_search(query, category)` tool. A dispatcher routes each call through an engine chain (Brave → SearXNG → DuckDuckGo → Felo) and returns the first successful result. Individual engines are no longer LLM-visible.

For URL reading, the LLM sees `fetch_url(url, max_length?, start_index?, raw?)`. It can route through optional Crawl4AI first, then always falls back to internal `mcp_fetch`. It is unavailable on NovelAI.

| Engine | Categories | Integration | Notes |
|----------|-------------|-----|-------|
| **Brave Search** | text / image / video / news | REST API | First in chain when a Brave API key is configured. ⚠️ Set a $5 usage limit in the Brave dashboard to avoid surprise charges. |
| **SearXNG** | text / image / video / news | REST API (self-hosted sidecar) | Activates when `SEARXNG_BASE_URL` is set and the sidecar's `/healthz` is reachable. Self-hosted aggregator that proxies Google, Bing, DDG, Brave, Wikipedia, etc. See `servers/searxng/README.md`. |
| **DuckDuckGo** | text only | MCP server | Fallback when Brave/SearXNG are unavailable; transparently cascades to Felo on rate limits. |
| **Felo AI Search** | text only | MCP server | Final-resort text fallback. |
| **Crawl4AI** | URL fetch | REST API (self-hosted sidecar) | Optional hidden `fetch_url` engine. Activates when `CRAWL4AI_BASE_URL` is set and `/health` is reachable. Browser-renders pages and returns markdown via `/md`; falls back to `mcp_fetch` when unavailable. See `servers/crawl4ai/README.md`. |
| **MCP Fetch** | URL fetch | Bundled MCP server | Mandatory final `fetch_url` fallback and default behavior when Crawl4AI is unset or unhealthy. |
