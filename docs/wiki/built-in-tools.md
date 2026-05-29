---
title: "Built-In Tool Reference for Prompt Customization"
---

If you customize TomoriBot's system prompt, persona instructions, or external provider prompt templates, prefer the stable prompt macros below instead of hardcoding tool names.

- Prompt macros like `{memory_tool}` are expanded during context assembly. Exact tool names are emitted wrapped in backticks, while unresolved search/fetch families fall back to plain-language text. Static macros always map to the current canonical built-in tool name. Search/fetch family macros resolve to the best currently available exact tool name for the active provider/configuration.
- `Base Tool` means the tool is part of TomoriBot's normal built-in tool set. It may still depend on the current provider/model supporting tool calling.
- Other requirements below are additional gates such as server feature flags, Discord permissions, model capabilities, or optional API keys.
- Admin-added MCP tools are intentionally not listed here because their names depend on each server's configuration.

### Built-In Function Tools

| Tool name | Prompt macro | Requirements | Purpose |
|---|---|---|---|
| `review_capabilities` | `{capabilities_tool}` | Base Tool | Check current chat abilities, slash commands, or runtime settings before answering. |
| `create_long_term_memory` | `{memory_tool}` | `self_teaching_enabled` | Save a new stable server fact or user-specific preference for future conversations. |
| `update_long_term_memory` | `{memory_update_tool}` | `self_teaching_enabled` | Replace an outdated long-term memory by ID. |
| `update_short_term_memory` | `{short_term_memory_tool}` | Base Tool; unavailable on NovelAI | Save temporary working memory for the current channel/story arc without making it permanent. |
| `create_task` | `{task_tool}` | Base Tool | Schedule one-time or recurring reminders and self-tasks. |
| `cross_channel_message` | `{cross_channel_tool}` | Base Tool; unavailable on NovelAI; target channel permissions and cross-channel blocklist still apply | Instantly act in another channel or thread, with optional boomerang report-back. |
| `create_thread` | `{create_thread_tool}` | `thread_creation_enabled`; bot `CreatePublicThreads` and `SendMessagesInThreads` permissions | Create a public thread in the current or named channel and send its starter message. |
| `select_sticker_for_response` | `{sticker_tool}` | `sticker_usage_enabled`; `USE_EXTERNAL_STICKERS` | Pick a matching server sticker to accompany the response. |
| `manage_message` | `{manage_message_tool}` | `manage_message_enabled`; `MANAGE_MESSAGES` still required for `pin` | Pin any recent message, or edit/delete recent messages sent by Tomori or its characters. |
| `interact_with_recent_message` | `{message_interaction_tool}` | Base Tool; normal Discord send/react capability still applies at runtime | React to a recent message or send a short backtracking reply to it. |
| `peek_profile_picture` | `{profile_picture_tool}` | Base Tool; requires either a vision-capable chat model or a configured `vision_llm` | Inspect a user's avatar or the active persona avatar. |
| `read_document` | `{document_tool}` | Base Tool | Extract text from a PDF, TXT, or MD attachment in a recent message. |
| `reveal_message_metadata` | `{message_metadata_tool}` | Base Tool | Annotate recent visible turns with `ref_N` handles and sent timestamps for precise message targeting. |
| `increase_media_context` | `{media_context_tool}` | Base Tool; requires a vision-capable chat model | Pull older hidden images/videos back into context when media was windowed out for optimization. |
| `process_gif` | `{gif_tool}` | Base Tool; development only; requires a vision-capable chat model | Extract keyframes from a GIF for analysis. |
| `process_youtube_video` | `{youtube_tool}` | Base Tool; requires a model with YouTube/video support | Analyze a specific YouTube link on demand. |
| `analyze_image` | `{image_analysis_tool}` | Base Tool; requires a configured `vision_llm`; only shown when the current chat model cannot already see images | Delegate image understanding to a separate vision model. |
| `generate_image` | `{image_generation_tool}` | `imagegen_enabled`; active provider must support native image generation | Generate or edit an image with the current provider. |
| `generate_image_nai` | `{anime_image_generation_tool}` | `imagegen_enabled`; NovelAI provider or NovelAI optional API key | Generate or edit anime-styled images with NovelAI. |
| `generate_voice_message` | `{voice_message_tool}` | ElevenLabs optional API key; active persona needs an ElevenLabs voice; `voice_message_enabled` | Send a spoken Discord voice reply instead of plain text. |

### Default Search / Web Extras

These are the common built-in or bundled web tools Tomori can expose when web access is enabled. Exact availability depends on provider support, server config, API keys, and which MCP servers are active.

Family macros below may resolve to the listed bundled tools or to compatible guild MCP replacements when admins register their own `web_search` or `url_fetcher` servers.

#### Unified `web_search`

A single LLM-visible tool replaces the previous four `brave_*` tools. It takes a `category` enum (`text` / `image` / `video` / `news`) and routes through an internal **engine chain** — **Brave → SearXNG → DuckDuckGo → Felo** — picking the first engine that is both available and supports the requested category. Brave and SearXNG support all four categories; DDG and Felo only support `text`. Non-text categories fall back to a friendly "category unavailable" message when no engine in the chain handles them.

| Tool name | Prompt macro | Requirements | Purpose |
|---|---|---|---|
| `web_search` | `{web_search_tool}` / `{image_search_tool}` / `{video_search_tool}` / `{news_search_tool}` | `web_search_enabled` | Search the web. The `category` arg selects text/image/video/news. Optional `count` arg sets result count (image: max 10 sent to Discord; text/video/news: max 20 in result list). The dispatcher hides engine selection from the model — saves ~400 tokens/turn vs. the previous 4-tool surface. |
| `fetch_url` | `{url_fetch_tool}` | `web_search_enabled`; active bundled fetch path; unavailable on NovelAI | Read a specific web page or URL in more detail. Arguments mirror the bundled MCP fetch server: `url`, optional `max_length`, optional `start_index`, optional `raw`. |
| `url-metadata` | `{url_metadata_tool}` | `web_search_enabled`; active DuckDuckGo/Felo MCP search server | Retrieve page metadata for a URL when a metadata-specific fetcher is available. |

> **Engine-internal details:** the Brave per-category implementations live under `src/tools/restAPIs/brave/internal/` as `InternalBrave*` services consumed by `webSearch/braveEngine.ts`. They are intentionally **not** LLM-visible. The DDG/Felo paths are reached through `webSearch/duckduckgoEngine.ts` / `feloEngine.ts`, which call the MCP server directly via `DuckDuckGoHandler.executeWebSearchInternal()` / `executeFeloSearchInternal()`. SearXNG is reached through `webSearch/searxngEngine.ts`, which calls the self-hosted `/search` endpoint via `restAPIs/searxng/`. Adding a new engine = implement `WebSearchEngine` and append to the chain in `webSearch/dispatcher.ts`.

#### Unified `fetch_url`

`fetch_url` is the single bundled URL-reading tool shown to the LLM. Its dispatcher can try optional browser sidecars first, then always falls back to the internal `mcp_fetch` engine. Before dispatch, TomoriBot blocks localhost/private/internal/reserved target URLs unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`; the default error message explicitly names the `FETCH_URL_ALLOW_PRIVATE_NETWORK=false` default so the bot can explain the failure to the user. `mcp_fetch` calls the existing bundled MCP `fetch` server and reuses its result processing. The raw global MCP function name `fetch` is hidden from the LLM after centralized feature-flag filtering.

Guild MCP replacements still work: if an enabled guild MCP server is registered as `url_fetcher` and exposes functions, TomoriBot hides the bundled `fetch_url` for that guild so `{url_fetch_tool}` resolves to the guild function instead.

#### Crawl4AI sidecar (optional URL-fetch engine)

[Crawl4AI](https://docs.crawl4ai.com/) is an optional browser-rendered markdown sidecar used only behind `fetch_url`.

- **When it activates:** `CRAWL4AI_BASE_URL` is set AND `${CRAWL4AI_BASE_URL}/health` responds OK. The probe result is cached for `FETCH_URL_HEALTHCHECK_CACHE_SEC` seconds (default 60).
- **Where it sits in the chain:** before `mcp_fetch` by default. `FETCH_URL_ENGINE_ORDER` accepts `crawl4ai` and `mcp_fetch`; unknown names are ignored, duplicates are collapsed, and `mcp_fetch` is always appended.
- **Graceful absence:** if `CRAWL4AI_BASE_URL` is unset OR the health probe fails, `fetch_url` uses `mcp_fetch` only.
- **Private targets:** TomoriBot blocks private/internal target URLs before calling Crawl4AI unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`.
- **Cookie injection:** set `CRAWL4AI_COOKIES_JSON` to a JSON array of `{name, value, domain?}` objects. When set, the engine switches from the `/md` endpoint to `/crawl` with `browser_config.cookies` — required because `/md` has no cookie field. Useful for login-gated sites; note that sites with headless browser fingerprinting (e.g. Twitter/X) will still block content even with valid cookies. See `docs/guides/setup-fetch-sidecars.md`.
- **Deployment:** enable the compose sidecar with `docker compose --profile fetch-crawl4ai up` and set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` for the bot container. See `servers/crawl4ai/README.md`.

#### SearXNG sidecar (optional self-hosted engine)

[SearXNG](https://docs.searxng.org/) is a privacy-respecting metasearch aggregator that fronts Google, Bing, DuckDuckGo, Brave, Wikipedia, and others behind a single JSON API. Running our own instance sidesteps single-engine rate limits and scrape breakage.

- **When it activates:** `SEARXNG_BASE_URL` is set AND `${SEARXNG_BASE_URL}/healthz` responds OK. The probe result is cached for `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` seconds (default 60).
- **Where it sits in the chain:** after Brave (so a configured Brave API key still takes priority) and before DDG/Felo (so the self-hosted aggregator absorbs traffic before the public-instance fallbacks).
- **Categories:** all four — `text`, `image`, `video`, `news`. Image results are HEAD-validated → optionally compressed → posted as Discord attachments, identical UX to Brave images.
  - `SEARXNG_IMAGE_COUNT` (default 3, max 10) — how many valid images are sent to Discord. Overridden by the LLM's `count` arg.
  - `SEARXNG_IMAGE_POOL` (default 10) — candidate URL pool when the LLM does **not** specify `count`. When `count` is specified, the pool is `count × 3` (capped at 30) to absorb hotlink-protection failures without depleting candidates.
  - `IMAGE_MIN_SIZE_BYTES` (default 5120 = 5 KB) — images below this size are rejected. Filters placeholder/error images that Discord would render as raw file attachments rather than inline media. Shared with Brave image search.
  - If all pool URLs fail validation, SearXNG returns a text listing of image result links instead of a hard failure — the dispatcher does not fall through to "category unavailable".
- **Deployment:**
  - **Local (compose):** `docker compose up` starts the sidecar automatically; the bot picks it up via `SEARXNG_BASE_URL=http://searxng:8080/`.
  - **Local (`bun run dev`):** see `servers/searxng/README.md` for the standalone `docker run` snippet.
  - **AWS ECS:** sidecar container in the same task definition; sets `SEARXNG_BASE_URL=http://localhost:8080/` on the app container and depends on the sidecar's healthcheck.
  - **GCP Cloud Run:** multi-container service; same `localhost:8080` access. `SEARXNG_SECRET` injected via Secret Manager.
- **Graceful absence:** if `SEARXNG_BASE_URL` is unset OR the health probe fails, the chain reduces to `Brave → DDG → Felo` — same as Phase 1.
