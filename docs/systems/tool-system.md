<!-- ARCH-ALIGNMENT: prereq-phase-3 -->

# 9. Tool System

TomoriBot exposes built-in tools, MCP tools, and REST-backed tools through one central registry.

## Core Components

- Registry and execution dispatch: `src/tools/toolRegistry.ts`
- Availability filtering: `src/tools/availability.ts`
- Startup loader: `src/tools/toolInitializer.ts`
- Tool contracts: `src/types/tool/interfaces.ts`
- Feature flag mapper: `src/utils/tools/featureFlagMapper.ts`

`toolRegistry.ts` owns registration, lookup, MCP adapter registration, execution routing, execution history, and stats. It delegates provider/context filtering to `availability.ts`, including built-in feature flags, model capability requirements, Discord permission checks, global MCP function filtering, guild MCP collision handling, and image/voice slot pruning.

## Registration Model (Current)

Built-in tools are class-based:

- each tool extends `BaseTool`
- `toolInitializer.ts` auto-discovers classes in `src/tools/functionCalls/`
- no manual `registerTool(...)` calls in tool files

## Built-In Function Tools (Current)

From `src/tools/functionCalls/`:

- `create_long_term_memory` (`memoryTool.ts`)
- `update_long_term_memory` (`updateLongTermMemoryTool.ts`)
- `update_short_term_memory` (`updateShortTermMemoryTool.ts`)
- `create_task` (`reminderTool.ts`)
- `create_thread` (`createThreadTool.ts`)
- `select_sticker_for_response` (`stickerTool.ts`)
- `process_youtube_video` (`youtubeVideoTool.ts`)
- `reveal_message_metadata` (`revealMessageMetadataTool.ts`)
- `manage_message` (`manageMessageTool.ts`)
- `interact_with_recent_message` (`interactWithRecentMessageTool.ts`)
- `peek_profile_picture` (`peekProfilePictureTool.ts`)
- `increase_media_context` (`increaseMediaContextTool.ts`)
- `process_gif` (`processGifTool.ts`)
- `generate_image` (`generateImageTool.ts`)
- `generate_image_nai` (`generateImageNaiTool.ts`)
- `review_capabilities` (`reviewCapabilities.ts`)

Current `cross_channel_message` runtime notes:

- can target another text channel immediately without scheduling
- target selection is name-first through `target_channel`; human-readable channel/thread labels are preferred, and when a visible copyable label appears as `` `#label (ID: <snowflake>)` `` the resolver accepts that full inline-code label directly for an exact target retry
- deprecated `channel_id` / `channel_name` inputs are still accepted at execution time for backward compatibility, but they are no longer advertised to the model
- ambiguous channel or thread names return a clarification failure instead of guessing; same-name text channels, active thread titles, and forum-parent references are disambiguated together so a forum request cannot silently fall through to a text channel with the same name. Clarification candidates now expose copyable inline-code labels like `` `#label (ID: <snowflake>)` `` so the next tool call can copy that exact label or use the raw ID directly
- thread permission checks use `SendMessagesInThreads` instead of `SendMessages`
- target visits require both bot `ViewChannel` and invoking member `ViewChannel`; if the invoking guild member cannot be resolved, the tool fails closed before peeking or dispatching
- the `/server crosschannel-blocklist` setting blocks tool-driven visits into listed channels, and blocked forum/media parents also block thread targets under them
- tool-driven cross-channel dispatch now preserves the active sender identity, including alter personas and `/bot impersonate` user impersonation turns, for both the target-channel visit and optional boomerang follow-up
- Discord channel/thread links in prompt context are normalized into readable labels; when reusing the visible label alone would be ambiguous, the prompt-visible label becomes a copyable inline-code token like `` `#label (ID: <snowflake>)` ``
- tool-driven cross-channel visits now hide `cross_channel_message` for the dispatched turn itself, the boomerang follow-up turn, and any queued same-chain follow-ups that inherit that internal turn state, preventing nested re-dispatch loops
- boomerang return context now assumes the original assignment is already in history and asks for a concise report-back instead of restating the task

Current `create_thread` runtime notes:

- accepts `thread_name`, `first_message`, and optional `channel_name`
- when `channel_name` is omitted or blank, the target defaults to the current channel
- channel-name resolution uses the shared resolver from `targetResolver.ts`, including raw IDs and copyable `` `#name (ID: <snowflake>)` `` labels
- target channels must be regular text or announcement channels; the tool fails closed for DMs, voice channels, forums, media channels, and existing threads
- runtime requires bot `ViewChannel`, `CreatePublicThreads`, and `SendMessagesInThreads`; it also verifies the invoking member can view the target channel
- alter persona and user-impersonation turns send the starter message through a bot-managed webhook in the target channel; main persona turns use a normal bot message
- `/config tools manage` controls availability through `server_capabilities_configs.thread_creation_enabled`

Current `generate_image_nai` runtime notes:

- server-wide style tags come from `/novelai image-tags style` via `server_novelai_imagegen_configs.nai_style_tags`
- server-wide negative tags come from `/novelai image-tags negative` via `server_novelai_imagegen_configs.nai_negative_tags`
- selecting a NovelAI provider in `/config model image` writes to `server_novelai_imagegen_configs.nai_diffusion_model_id`, which drives the dedicated `generate_image_nai` tool
- `characters[]` now drives V4 multi-character prompting for `generate_image_nai`; coordinate mode is enabled when two or more characters are present
- persona and user appearance tags are resolved from `tomoris.nai_tags` and `users.nai_char_tags`
- tool guidance for `generate_image_nai` now uses a simpler inline-tag model: each `characters[]` item is one visible character instance, and `characters[].tags` must contain that character's full appearance plus their role in the scene. For erotic scenes, clothing tags can be omitted and the intended nude state can be stated directly in `tags`. The active schema/runtime no longer advertises `id`-driven appearance autofill or `remove_tags`; if saved appearance tags are available for a known persona/user, they are shown inline in context and the model is expected to copy them into `tags`
- persona and user reference images are resolved from `tomoris.nai_char_ref_url` and `users.nai_char_ref_url`, normalized onto NovelAI's supported reference canvases with black padding, and sent through `director_reference_images` only for single-character generations when `NAI_ENABLE_CHAR_REFERENCES` is enabled
- avatar-targeting tools that share `avatarResolver.ts` now accept `self` for the current active persona and also treat the bot's Discord user ID as an execution-time alias for that persona, keeping `peek_profile_picture`, `generate_image.user_id`, and `generate_image_nai.characters[].id` aligned
- tool-facing schema guidance now also explicitly prefers `self` over the bot's Discord user ID when the active persona is the intended target, without assuming a specific bot or persona name
- context building now includes saved NAI appearance tags inline on the relevant user/persona conversation entries instead of a separate `# Image Profiles` knowledge block, so image identity guidance stays attached to the same entity description the model is already reading
- provider tool adapters now preserve nested array/object tool schemas recursively, so structured tool params such as `characters[]` survive provider conversion

Current name-resolution notes for built-in tools:

- `create_task` now advertises optional `target_user` and optional `target_channel`; when `target_user` is omitted and `self_reminder` is not true, the reminder targets the current turn's invoking user.
- `create_long_term_memory` and `update_long_term_memory` now advertise `target_user`
- `update_long_term_memory` treats blank `memory_content` as a delete request and emits the same self-teach-style notification flow with a red embed
- `peek_profile_picture` and `generate_image` now advertise `target_identity`
- `peek_profile_picture` now supplies the target Discord user's profile banner alongside the avatar when a banner exists, so vision-capable flows can inspect both images together
- shared resolution is handled by `src/utils/discord/targetResolver.ts`
- user resolution order is: current-conversation aliases, exact guild display name, exact DB nickname intersected with guild membership, exact global name, exact username
- channel resolution first accepts raw IDs and visible copyable labels that carry an `(ID: <snowflake>)` suffix, then resolves exact human-readable channel/thread names with cross-set ambiguity handling, and treats a bare forum/media parent name as that forum's active posts instead of silently falling through to a same-named text channel
- matching is exact plus unique normalized only; V1 intentionally avoids fuzzy matching
- ambiguous results never auto-pick and instead return candidate labels for clarification; those candidate labels now carry copyable inline-code `(ID: <snowflake>)` suffix labels so the model can retry with the exact shown label or raw ID
- if a Discord user resolves successfully but has no Tomori user row yet, reminder/personal-memory tools fail with a human-readable "Tomori doesn't know this user yet" style error
- bridge users can still be resolved by name from current conversation metadata, but avatar tools reject them and personal-memory creation/update does not create bridge-scoped personal memories
- message-targeted tools such as `read_file`, `manage_message`, `interact_with_recent_message`, `analyze_image`, `process_gif`, and edit/inpaint reference flows still target Discord messages internally, but the prompt-visible arguments are opaque `media_N` / `ref_N` handles rather than raw snowflakes
- `ref_N` is now a general recent-message handle, not just a reply reference
- `ToolRegistry.executeTool()` resolves those opaque handles back to real Discord IDs before dispatch, including both `message_id` and `end_message_id`, so individual tool implementations continue to work with normal message IDs

Current message-management / interaction notes:

- `reveal_message_metadata` is a no-argument context rewrite tool that annotates existing visible message turns in place for the current turn and then hides itself for the rest of that turn
- the metadata annotations are built from the same post-reset recent history window already loaded for chat context, not as a new synthetic ledger message
- each annotated turn gains a compact metadata suffix containing `ref_N` and an absolute + relative sent timestamp
- `manage_message` accepts `action = "pin" | "edit" | "delete"` plus `message_id`, optional `end_message_id`, and optional `content`
- `interact_with_recent_message` accepts `action = "react" | "reply"` plus `message_id` and `content`
- `pin` remains single-target and still requires Discord `Manage Messages`; `edit` and `delete` are runtime-gated to direct bot messages or bot-managed character webhook messages
- `react` and `reply` are intentionally ungated by the message-management feature flag; they are expressive tools for revisiting recent ideas/messages rather than administrative message mutation
- native replies use Discord reply threading when the active sender is the bot account directly; webhook/persona contexts fall back to a normal message plus a small link embed that points back to the referenced message
- delete ranges are inclusive, normalized by recent-message chronology, and report skipped refs/counts instead of failing the whole request when some messages are ineligible

Current `update_short_term_memory` runtime notes:

- the tool is hidden for a turn when the triggering user message explicitly asks the bot to remember something for future use
- this suppression currently uses a shared English/Japanese phrase detector so direct long-term-memory requests do not compete with STM summary nudges in the same turn

## Stable Prompt Macros

Prompt-like text that flows through context assembly can use stable `{..._tool}` macros instead of hardcoding function names. This currently applies to:

- `/sysprompt`
- persona prompts
- personality attribute lines
- SillyTavern preset custom nodes and depth injections
- Tomori's own built-in tool hints inside context assembly

Static built-in macros always expand to the current canonical built-in tool name, wrapped in backticks:

| Macro | Expands to | Notes |
|---|---|---|
| `{capabilities_tool}` | `review_capabilities` | Inspect current tool/runtime availability first. |
| `{memory_tool}` | `create_long_term_memory` | Save a new long-term memory. |
| `{memory_update_tool}` | `update_long_term_memory` | Update an existing long-term memory by ID, or delete it with blank content. |
| `{short_term_memory_tool}` | `update_short_term_memory` | Update the current conversation's STM. |
| `{task_tool}` | `create_task` | Create reminders or scheduled self-tasks. |
| `{cross_channel_tool}` | `cross_channel_message` | Send an immediate message to another channel/thread. |
| `{create_thread_tool}` | `create_thread` | Create a Discord thread and send its first message. |
| `{sticker_tool}` | `select_sticker_for_response` | Attach a Discord sticker to the response. |
| `{manage_message_tool}` | `manage_message` | Pin any recent message, or edit/delete recent messages sent by the bot or its characters. |
| `{pin_tool}` | `manage_message` | Compatibility alias for `{manage_message_tool}`. |
| `{message_interaction_tool}` | `interact_with_recent_message` | React to or reply to a recent message for playful backtracking. |
| `{profile_picture_tool}` | `peek_profile_picture` | Inspect an avatar or banner. |
| `{document_tool}` | `read_file` | Read PDF or any text-based file attachment (source code, markdown, JSON, YAML, etc.). |
| `{message_metadata_tool}` | `reveal_message_metadata` | Reveal recent message refs and sent timestamps. |
| `{timestamp_refresh_tool}` | `reveal_message_metadata` | Compatibility alias for `{message_metadata_tool}`. |
| `{media_context_tool}` | `increase_media_context` | Bring older hidden images/videos back into context. |
| `{gif_tool}` | `process_gif` | Extract GIF frames for analysis. |
| `{youtube_tool}` | `process_youtube_video` | Analyze a YouTube video. |
| `{image_analysis_tool}` | `analyze_image` | Delegate image understanding to the vision model. |
| `{image_generation_tool}` | `generate_image` | Generate/edit images with the active provider. |
| `{anime_image_generation_tool}` | `generate_image_nai` | Generate/edit anime-styled images with NovelAI. |
| `{voice_message_tool}` | `generate_voice_message` | Send a spoken Discord voice reply. |

Search/fetch macros are family-level and availability-aware instead of hardcoded:

| Macro | Resolves to | Notes |
|---|---|---|
| `{web_search_tool}` | Best available exact web-search tool name | Prefers bundled Brave/DuckDuckGo search, or a discovered guild MCP `web_search` replacement. |
| `{image_search_tool}` | Best available exact image-search tool name | Falls back to `{web_search_tool}` when only general search is available. |
| `{video_search_tool}` | Best available exact video-search tool name | Falls back to `{web_search_tool}` when only general search is available. |
| `{news_search_tool}` | Best available exact news-search tool name | Falls back to `{web_search_tool}` when only general search is available. |
| `{url_fetch_tool}` | Best available exact URL-fetch tool name | Prefers bundled `fetch`, or a discovered guild MCP `url_fetcher` replacement. |
| `{url_metadata_tool}` | Best available exact metadata/fetch tool name | Prefers metadata-specific fetchers, then falls back to a compatible fetch tool. |

Behavior notes:

- static macros do not depend on feature flags or provider availability; they are stable aliases for the canonical built-in tool names
- dynamic family macros resolve at context-build time against the current provider/configuration
- when a macro resolves to an exact tool/function name, the expansion is wrapped in backticks (for example, `` `create_long_term_memory` ``)
- if a guild MCP server with `server_type = web_search` or `server_type = url_fetcher` replaces the bundled tools, the macro resolver uses that server's discovered function names
- if no exact search/fetch function name can be discovered, the macro expands to plain-language fallback text rather than a stale hardcoded tool name

## REST API Tools

- Brave REST tool classes in `src/tools/restAPIs/brave/braveTools.ts`:
  - `brave_web_search`
  - `brave_image_search`
  - `brave_video_search`
  - `brave_news_search`

## MCP Integration

- MCP manager: `src/utils/mcp/mcpManager.ts`
- MCP stdio transport: `src/utils/mcp/bannerFilteringStdioTransport.ts`
- MCP registration handler: `src/events/clientReady/02_registerMCPs.ts`
- MCP server definitions/configs: `src/tools/mcpServers/*`

Current MCP behavior notes:

- Google and OpenRouter MCP-capable adapters are registered at startup.
- NovelAI MCP adapter is intentionally disabled due prompt budget constraints.
- Guild-registered remote MCP servers added via `/config mcp add` are validated before save and again before each connection attempt.
- In production, guild MCP servers must use HTTPS and resolve only to publicly routable IP addresses.
- Direct HTTP/SSE transports for guild MCP servers disable redirects so a validated URL cannot bounce to a different internal target later.
- Stdio MCP startup uses `BannerFilteringStdioClientTransport`, which strips known banner-art lines from each child process stdout stream before JSON-RPC framing sees them.
- The bot does not monkey-patch parent `process.stdout`; MCP output filtering is scoped to the child transport that owns the noisy server.

## Current MCP Servers

From `src/tools/mcpServers/`:

- `brave-search`
- `fetch`
- `duckduckgo-search` (kept available, but search routing may prefer Brave when Brave API is configured)

## Tool Filtering and Availability

`src/tools/availability.ts` filters tools by:

- provider availability (`isAvailableFor` / context-aware checks)
- declared model capability requirements (`requiredModelCapabilities`)
- feature flags (mapped by `featureFlagMapper.ts`)
- permission requirements (`requiresPermissions`)

Centralized helper:

- `getAvailableToolsWithMCP(provider, stateForContext)`
  - returns filtered built-in tools + filtered MCP function names
  - the first pass uses `stateForContext.llm` to filter capability-gated tools before any streaming-context-only checks run

Additional routing logic:

- when Brave API is available, DuckDuckGo MCP search functions are excluded to prefer Brave.
- when Brave is unavailable, DuckDuckGo `web-search` remains the primary free search path.
- if DuckDuckGo `web-search` is rate-limited or returns no usable result, the DuckDuckGo handler may retry internally with `felo-search`.
- `felo-search` remains hidden from provider tool lists; it is used as an internal fallback, not a first-class exposed tool.

## Tool Categories

`ToolCategory` values in current type contracts:

- `discord`
- `search`
- `memory`
- `utility`
- `mcp`

## Creating a New Built-In Tool

1. Add a file under `src/tools/functionCalls/`.
2. Export a class that extends `BaseTool`.
3. Define:
   - `name`, `description`, `category`
   - JSON-schema-like `parameters`
   - `execute(args, context)`
4. Optionally set:
   - `requiredModelCapabilities`
   - `requiresFeatureFlag`
   - `requiresPermissions`
   - `requiresFollowUp`
5. Restart bot; startup auto-discovery registers the tool.

## Observability

Registry tracks execution history and stats:

- `getExecutionHistory(limit)`
- `getStats()`

## Tool Notice Visibility

User-facing tool progress notices are centralized in `src/utils/discord/toolProgressNotice.ts`.

Current notice keys:

- `web_search`
- `image_search`
- `video_search`
- `news_search`
- `web_fetch`
- `document_reading`
- `image_generation`
- `image_editing`
- `image_analysis`
- `gif_processing`
- `youtube_processing`
- `mcp_tool_call`

Behavior notes:

- visibility is server-scoped via `server_notice_embeds_configs.tool_notice_hidden_keys`
- an empty hidden-key list means all current and future notice types remain visible by default
- `/config notice-embeds visibility` manages the hidden-key list through checkbox groups
- visible notices are posted in the source channel as normal
- hidden tool notices are rerouted to the configured thought-log channel when one exists; non-tool command notices covered by this registry are simply suppressed
- the `fallback_model_usage` notice is a source-channel `Fallback Used` button without a public embed; when hidden, its full details embed is rerouted to the thought-log channel instead of posting anything publicly
- hidden notices from private channels are suppressed instead of being rerouted, so private-channel activity never leaks to thoughtlogs
- hidden notices in DMs are suppressed because DMs have no guild thought-log destination
- all tool notices include a footer hint pointing users to `/config notice-embeds visibility`
- `FALLBACK_NOTICE_BUTTON_TIMEOUT_MS` controls how long the fallback-details button stays interactive before it is disabled
- image-generation, image-editing, and video-generation notices now append the active model codename and a trimmed copy of the raw tool-call prompt, plus lightweight execution hints such as configured style tags, per-character NAI tags, or reference-image usage; server-side style-tag contents, defaults, and other system-added prompt material are not shown
