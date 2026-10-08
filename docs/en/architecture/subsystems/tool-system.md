---
title: "Tool System"
---

The tool system owns tool registration, availability filtering, dynamic schema assembly, and execution dispatch across built-in tools, global Model Context Protocol (MCP) servers, and guild MCP integrations. Model orchestration, multi-turn tool loops, and result serialization belong to the [tool loop](/architecture/pipelines/tool-loop/).

## Registration and availability filtering

Tool registration and discovery coordinate through two core modules:

- **Registration (`src/tools/toolRegistry.ts`):** Built-in tools implement `BaseTool` and register with `ToolRegistry.registerTool()`. Provider MCP adapters register through `registerMCPAdapter()`.
- **Availability filtering (`src/tools/availability.ts`):** `getAvailableToolsWithMCP()` provides centralized availability checks before tools are exposed to the model.

Filtering evaluates multiple layers:

1. **Provider support:** The tool must declare compatibility with the active LLM provider via `isAvailableFor(provider)`.
2. **Model capabilities:** The tool's `requiredModelCapabilities` must match active model flags in `ToolAvailabilityLlmState`.
3. **Feature flags:** Tools requiring feature flags (`requiresFeatureFlag`) are evaluated against guild configuration via `configToFeatureFlags`.
4. **Channel permissions:** Tools with `requiresPermissions` verify that the bot holds necessary Discord channel permissions (such as `SendMessages` or `UseExternalStickers`).
5. **Backend slot availability:** Feature tools verify configured backend slots before admission. `generate_image` requires a standard diffusion model; `generate_image_nai` requires a NovelAI image slot; `generate_video` requires a video model slot; and `generate_voice_message` requires a speech provider and an assigned persona voice.
6. **Streaming context filtering:** `applyStreamContextAvailability()` evaluates live-turn constraints (`isAvailableForContext`) before schema declaration. This removes tools whose turn eligibility has lapsed (such as per-turn deduplication flags) so unavailable tools are not advertised to the model.

## Dynamic tool assembly

Before provider serialization, tools pass through `assembleToolsForContext()` in `src/tools/assembly.ts`. Most tools return their static definition unchanged. Capability-sensitive tools implement `assembleForContext(context)` and return tailored variants via `createToolVariant()`:

- `web_search`: Narrows category enums to the active search backend. SearXNG exposes all categories; Brave exposes text, image, video, and news; and DuckDuckGo or iAsk MCP fallbacks expose text search only.
- `generate_image`: Prunes parameters to match active backend capabilities (text-to-image, reference image fields, and ComfyUI inpaint or outpaint controls). Parameter descriptions omit instructions for unconfigured modes, preventing the model from receiving unsupported guidance.
- `generate_voice_message`: Prunes script markup and voice instruction schemas based on the active speech endpoint and persona voice design. Delivery logic is shared with `/generate voice-message`; see [Voice System](/architecture/integrations/voice/).

Assembly guards prevent the model from seeing unsupported parameters, while execution-time checks guard against stale configurations and crafted tool calls.

## Execution dispatch and failure boundaries

Tool execution coordinates through a single entry point: `ToolRegistry.executeTool()`.

```
Model tool call
       ↓
ToolRegistry.executeTool()
       ↓
Resolve opaque IDs (media_id, message_id) & aliases
       ↓
Dispatch:
├─ Provider MCP Adapter ──→ adapter.executeMCPFunction()
├─ Guild MCP Manager    ──→ guildMcpManager.executeGuildMCPFunction()
└─ Built-in Tool        ──→ tool.execute() (availability & context checked)
       ↓
Redact parameters & record ToolExecutionEvent
       ↓
Return ToolResult (success / error)
```

Execution dispatch enforces the following rules:

1. **Alias and opaque ID resolution:** Built-in aliases (`BUILTIN_TOOL_ALIASES`) resolve to canonical names. Opaque identifiers (`media_id`, `message_id`, `end_message_id`) resolve to Discord snowflakes via `MessageIdMap` before reaching tool code.
2. **Provider MCP dispatch:** If `isMCPFunction()` identifies the call as a provider MCP tool, dispatch delegates to `executeMCPFunction()`.
3. **Guild MCP dispatch:** If `guildMcpManager.isGuildMCPFunction()` matches the name for the current server, dispatch delegates to `guildMcpManager.executeGuildMCPFunction()`.
4. **Built-in tool execution:** If the name matches a registered built-in tool, `executeBuiltInTool()` validates existence (suggesting the closest matching name on failure), static provider compatibility, and live context availability (`isAvailableForContext`).
5. **Execution history and redaction:** Parameters are sanitized via `redactToolParametersForStorage()` before recording in `ToolExecutionEvent` history.
6. **Error handling:** Thrown exceptions are caught and wrapped in a structured `ToolResult` with `success: false` and a localized or descriptive error message. The error returns to the model turn so the persona can adapt or explain the failure; see [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/).

## Guild MCP integrations

Guilds manage remote MCP servers through `/config` > Plugins > MCP Servers (`src/utils/mcp/mcpConfigOperations.ts`):

- **Connection pooling and lifecycle:** `GuildMcpManager` (`src/utils/mcp/guildMcpManager.ts`) connects servers lazily on the critical path of tool gathering. Connection attempts try transports in order: Smithery Connect (for `*.run.tools`), StreamableHTTP, and SSE. Each attempt creates a fresh client bounded by `GUILD_MCP_CONNECT_TIMEOUT_MS`.
- **Circuit breaker quarantine:** Servers that fail to connect enter quarantine for `GUILD_MCP_FAILURE_COOLDOWN_MS` (default 5 minutes). This prevents unreachable endpoints from exhausting connection timeouts on every generation turn.
- **Tool name snapshots:** Discovered tool names persist in `last_discovered_tool_names` as a bounded display cache, capped at 100 names and 128 Unicode characters per name (`mcpToolSnapshot.ts`). Live `listTools()` output remains authoritative for invocation.
- **Collision and replacement policy:** Guild MCP tools append after built-in and global MCP filtering. If a guild enables a `url_fetcher` MCP server, the bundled `fetch_url` tool is suppressed for that guild, and the `{url_fetch_tool}` prompt macro routes to the guild replacement.

## Web tools and network security

Web access tools enforce security boundaries before network dispatch:

- `web_search`: Dispatches queries through internal search engines while hiding engine-specific tool names from the model.
- `fetch_url`: The primary URL-reading tool. In production (`RUN_ENV === "production"`), requests to private, localhost, or reserved IP ranges are blocked unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` is set.
- **Cloud metadata protection:** Cloud instance metadata and link-local ranges (`169.254.0.0/16`, IPv6 link-local, AWS IMDS) are blocked unconditionally by `src/utils/security/cloudMetadata.ts`. This check cannot be bypassed by configuration.
- **Safe HTTP engine:** The `safe_http` engine validates and pins DNS, follows a bounded number of redirects (revalidating each hop), limits downloaded byte counts, and converts HTML to Markdown.
- **Result storage:** Successful content is stored in `ToolResult.data.summary` so streaming tool loops serialize the text into provider turn history.

## Participant targeting

Participant-aware tools resolve user and persona targets through `ParticipantTargetIndex` attached to the prepared participant context; see [Participants](/architecture/pipelines/context-build/02-native-assembly/06-participants/). The index is constructed from typed identities and purpose-filtered aliases, avoiding ambiguous display-name searches.

For image analysis, `analyze_image` resolves attachments from the target Discord message. When that message is a text-only reply, it checks the directly referenced message. The tool enforces the `VISION_ANALYSIS_TIMEOUT_MS` deadline (default 60 seconds) across media downloads and vision provider inference.

## Persona user blocking

The `block_user` and `unblock_user` tools allow personas to manage interpersonal boundaries, gated by the `user_blocking_enabled` permission in `/config`:

- **Scoping:** Blocks persist in `persona_user_blocks`, keyed by server, local persona ID, and target user ID.
- **Channel permission check:** Before saving a block, `block_user` checks whether the bot can view the channel and send embeds. Missing permissions abort the save and return an error to the model.
- **Dialogue filtering:** Active blocks suppress the target user's messages in dialogue history, replacing them with a system notice: `[System: ... sent a message but is currently blocked by you ...]`. The notice is an English system injection, mirroring reminder and join injections. Blocking suppresses dialogue turns and reply annotations without deleting stored long-term memories or documents.

## Structured user info updates
<!-- anchor: structured-user-info-updates -->

The `update_user_info` tool (`src/tools/functionCalls/updateUserInfoTool.ts`) updates personal profile and addressing preferences:

- **Target resolution:** Resolves target users across mentions, names, aliases, and Discord IDs using `resolveUserTarget`. Omitted targets default to the invoking user; wildcards (`all`, `everyone`) are rejected.
- **Field scoping:**
  - Persona-specific fields (`nickname`, `prefix`, `suffix`) persist in `user_persona_naming_preferences`, scoped to the active persona lineage.
  - Global fields (`gender_identity`, `pronouns`, `addressing_style`, `timezone_offset`) persist in `user_personalization_configs`, shared across all personas.
- **Clearing values:** Fields listed in the `clear` array are removed. Submitting empty string values folds into clearing. Cleared prefixes or suffixes persist as explicit suppressions (`none`), preventing lower-precedence defaults from resurfacing.
- **Affix deduplication:** When a submitted nickname contains an already-resolved prefix or suffix, redundant affixes are stripped by comparing against resolved values.
- **Privacy and permissions:** Mutations require `user_info_updates_enabled`. Restrictive privacy levels block updates but permit clearing existing values.

## Capability self-diagnosis

The `review_capabilities` tool inspects system configuration dynamically:

- **Inventory sources:** Gathers active tools from `ToolRegistry` runtime availability and registered commands from cached `loadCommandData()`.
- **Privilege boundaries:** General members receive safe reports detailing commands and feature states. Detailed reports containing credential presence, rotation pool counts, internal identifiers, and system-prompt metadata require the requesting member to hold `ManageGuild` permissions. Invocations without verified member context fail closed with the redacted report.

## NovelAI constraints

The `fetch_url` tool is excluded from NovelAI models. NovelAI tool calling is prompt-based and token-constrained, requiring dedicated budget validation before large URL payloads can be admitted.

## Source pointers

- `src/tools/toolRegistry.ts`: Central tool registry and execution dispatcher.
- `src/tools/availability.ts`: Availability filtering, model capability checks, and backend slot validation.
- `src/tools/assembly.ts`: Per-turn dynamic schema assembly.
- `src/utils/mcp/guildMcpManager.ts`: Guild MCP connection pooling, circuit breaking, and dispatch.
- `src/tools/functionCalls/updateUserInfoTool.ts`: Structured user profile and naming preferences.
- `src/tools/fetchUrl/dispatcher.ts`: URL fetch security and safe HTTP engine dispatch.
- `src/utils/security/cloudMetadata.ts`: Cloud instance metadata denylist.
