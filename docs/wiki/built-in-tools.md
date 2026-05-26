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

| Tool name | Prompt macro | Requirements | Purpose |
|---|---|---|---|
| `brave_web_search` | `{web_search_tool}` | `web_search_enabled`; Brave API available | Search the web for general information. |
| `brave_image_search` | `{image_search_tool}` | `web_search_enabled`; Brave API available | Search for relevant images on the web. |
| `brave_video_search` | `{video_search_tool}` | `web_search_enabled`; Brave API available | Search for relevant videos on the web. |
| `brave_news_search` | `{news_search_tool}` | `web_search_enabled`; Brave API available | Search specifically for current news coverage. |
| `fetch` | `{url_fetch_tool}` | Active bundled fetch MCP server | Read a specific web page or URL in more detail. |
| `web-search` | `{web_search_tool}` | `web_search_enabled`; active DuckDuckGo/Felo MCP search server | Free web search fallback when Brave is unavailable. |
| `url-metadata` | `{url_metadata_tool}` | `web_search_enabled`; active DuckDuckGo/Felo MCP search server | Retrieve page metadata for a URL when a metadata-specific fetcher is available. |
