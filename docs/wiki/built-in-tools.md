---
title: "Built-In Tool Reference for Prompt Customization"
---

If you customize TomoriBot's system prompt, persona instructions, or external provider prompt templates, prefer the stable prompt macros below instead of hardcoding tool names.

- Prompt macros like `{memory_tool}` are expanded during context assembly. Exact tool names are emitted wrapped in backticks, while unresolved search/fetch families fall back to plain-language text.
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
| `update_task` | `{task_update_tool}` | Base Tool | Replace or delete an existing reminder or self-task by `ID:N`, scoped to the requester. |
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
| `generate_image` | `{image_generation_tool}` | `imagegen_enabled`; active provider must support native image generation | Generate an image with the current provider; uses Physical Appearance context, default positive image tags, and default negative tags when the backend declares negative-prompt support; reference, inpaint, and outpaint arguments are shown only when the configured backend supports them. `target_identity` accepts one or more user/persona names, each resolved to that user's guild avatar (or alter persona webhook avatar) and added as a reference. The final Discord message uses a Components V2 media gallery with generation-time subtext, including a line listing any referenced users/personas. |
| `generate_image_nai` | `{anime_image_generation_tool}` | `imagegen_enabled`; NovelAI provider or NovelAI optional API key | Generate or edit anime-styled images with NovelAI, using Physical Appearance context as character tags when relevant. The final Discord message uses a Components V2 media gallery with generation-time subtext. |
| `generate_voice_message` | `{voice_message_tool}` | ElevenLabs optional API key; active persona needs an ElevenLabs voice; `voice_message_enabled` | Send a spoken Discord voice reply instead of plain text. |

### Default Search / Web Extras

These are the common built-in or bundled web tools Tomori can expose when web access is enabled. Exact availability depends on provider support, server config, API keys, and which MCP servers are active.

Family macros below may resolve to the listed bundled tools or to compatible guild MCP replacements when admins register their own `web_search` or `url_fetcher` servers.

#### Unified `web_search`

A single LLM-visible tool replaces the previous four `brave_*` tools. Its assembled `category` enum is narrowed for the active backend before the provider adapter sees it. SearXNG exposes all categories (`text` / `image` / `video` / `news` / `science` / `it` / `files` / `music`), Brave exposes the common four categories (`text`, `image`, `video`, `news`), and DDG/Felo expose `text` only. If no backend is available, `web_search` is omitted.

Search progress embeds show the selected category as a separate localized label (for example, "Searching videos for `beaver`...") rather than mutating the query string.

| Tool name | Prompt macro | Requirements | Purpose |
|---|---|---|---|
| `web_search` | `{web_search_tool}` / `{image_search_tool}` / `{video_search_tool}` / `{news_search_tool}` | `web_search_enabled`; at least one search backend currently available | Search the web. The assembled `category` arg only lists categories supported by the active backend. Optional `count` arg sets result count (image: max 10 sent to Discord; text-like categories: max 20 in result list). The dispatcher hides engine selection from the model — saves ~400 tokens/turn vs. the previous 4-tool surface. |
| `fetch_url` | `{url_fetch_tool}` | `web_search_enabled`; active bundled fetch path; unavailable on NovelAI | Read a specific web page or URL in more detail. Arguments mirror the bundled MCP fetch server: `url`, optional `max_length`, optional `start_index`, optional `raw`. |
| `url-metadata` | `{url_metadata_tool}` | `web_search_enabled`; active DuckDuckGo/Felo MCP search server | Retrieve page metadata for a URL when a metadata-specific fetcher is available. |

> **Engine-internal details:** the Brave per-category implementations live under `src/tools/restAPIs/brave/internal/` as `InternalBrave*` services consumed by `webSearch/braveEngine.ts`. They are intentionally **not** LLM-visible. The DDG/Felo paths are reached through `webSearch/duckduckgoEngine.ts` / `feloEngine.ts`, which call the MCP server directly via `DuckDuckGoHandler.executeWebSearchInternal()` / `executeFeloSearchInternal()`. SearXNG is reached through `webSearch/searxngEngine.ts`, which calls the self-hosted `/search` endpoint via `restAPIs/searxng/`. Adding a new engine = implement `WebSearchEngine` and append to the chain in `webSearch/dispatcher.ts`.

#### Unified `fetch_url`

`fetch_url` is the single bundled URL-reading tool shown to the LLM. Its dispatcher can try optional browser sidecars first, then always falls back to the internal `mcp_fetch` engine. Before dispatch, TomoriBot blocks localhost/private/internal/reserved target URLs unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`; the default error message explicitly names the `FETCH_URL_ALLOW_PRIVATE_NETWORK=false` default so the bot can explain the failure to the user. `mcp_fetch` calls the existing bundled MCP `fetch` server and reuses its result processing. The raw global MCP function name `fetch` is hidden from the LLM after centralized feature-flag filtering.

Guild MCP replacements still work: if an enabled guild MCP server is registered as `url_fetcher` and exposes functions, TomoriBot hides the bundled `fetch_url` for that guild so `{url_fetch_tool}` resolves to the guild function instead.

#### Crawl4AI sidecar (optional URL-fetch engine)

[Crawl4AI](https://docs.crawl4ai.com/) is an optional browser-rendered markdown sidecar used only behind `fetch_url`. When `CRAWL4AI_BASE_URL` is set and the health probe passes, it runs before `mcp_fetch` in the engine chain. If unset or unavailable, `fetch_url` falls back to `mcp_fetch` transparently.

See **[Setup: Crawl4AI Sidecar](../guides/setup-crawl4ai.md)** for deployment, cookie injection, and `FETCH_URL_ENGINE_ORDER` configuration.

#### SearXNG sidecar (optional self-hosted engine)

[SearXNG](https://docs.searxng.org/) is a privacy-respecting metasearch aggregator that sidesteps single-engine rate limits and unlocks SearXNG-only search categories: `science`, `it`, `files`, and `music`. It sits between Brave and DDG/Felo in the engine chain. If unset or unavailable, the chain reduces to `Brave → DDG → Felo`.

See **[Setup: SearXNG Web Search Sidecar](../guides/setup-searxng.md)** for deployment, image result tuning, and AWS/GCP configuration.
