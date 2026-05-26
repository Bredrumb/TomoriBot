<!-- ARCH-ALIGNMENT: prereq-phase-5.5c -->

# Context Assembly

> How TomoriBot builds the LLM prompt from server state, user data, conversation history, and optional ST presets.

## Overview

Context assembly is the process of transforming raw server/user/conversation state into a structured array of `StructuredContextItem[]` that providers send to the LLM. The public entry point is `buildContext()` in `src/utils/text/contextBuilder.ts`; extracted implementation and responsibility-specific helpers live under `src/utils/text/context/`.

The system has two modes:

1. **Native assembly** — Fixed native block structure, always available, no configuration needed
2. **Preset-driven assembly** — When a SillyTavern preset is active, native blocks are rearranged according to the preset's node order (see [ST Preset System](../integrations/sillytavern-preset-system.md))

If no preset is active (the default), the system behaves exactly as native assembly. The preset path is fully transparent to callers.

## Architecture

```text
buildContext(params)          ← routing wrapper (exported)
  │
  ├─ Active preset? ──yes──→ buildContextNative(params)
  │                            → reassembleWithPreset(nativeOutput, preset)
  │                            → return rearranged items
  │
  └─ No preset ──────────→ buildContextNative(params)
                             → return native items directly
```

Support modules:

- `context/builder.ts` owns preset routing and final random macro resolution
- `context/nativeBuilder.ts` owns the native assembly sequence as a readable coordinator
- `context/mentionNormalizer.ts` owns Discord mention, channel-link, role, and template placeholder normalization
- `context/templates.ts` owns default prompt constants, prompt/sample dialogue blocks, random prompt macros, and conditioning context items
- `context/memories.ts` owns server-memory and short-term memory context assembly
- `context/rag.ts` owns document retrieval/RAG context assembly
- `context/serverAssets.ts` owns custom emoji and sticker context
- `context/participants.ts` owns users-in-conversation, personal memories, reminders, and mention metadata
- `context/dialogueHistory.ts` owns history shaping, context-note insertion, media attribution, and media-window rendering
- `context/history.ts` owns shared media/history formatting helpers, timestamp formatting, and presence formatting
- `context/types.ts` owns the public context-builder parameter and result types re-exported by `contextBuilder.ts`

### BuildContextParams

All callers pass a single `BuildContextParams` object (exported from `contextBuilder.ts`). Key fields:

| Field | Type | Purpose |
|-------|------|---------|
| `guildId` | `string` | Discord server ID |
| `simplifiedMessageHistory` | `SimplifiedMessageForContext[]` | Preprocessed conversation messages |
| `triggererName` | `string` | Display name of the user who triggered the response |
| `tomoriNickname` | `string` | Bot's display name (persona-aware) |
| `tomoriAttributes` | `string[]` | Personality attribute lines |
| `publicPersonaAttributes` | `{ personaId; personaName; attributes }[]` | Public attributes from other personas triggered by the same original message |
| `tomoriConfig` | `AssembledServerConfig` | Server-level bot configuration (assembled from split tables) |
| `personaPrompt` | `string \| null` | Persona-specific system prompt |
| `snapshot` | `RequestSnapshot` | Pre-loaded caches (tomoriState, etc.) |
| `isUserImpersonation` | `boolean` | Whether this is a user impersonation request |

### BuildContextResult

```typescript
{
  contextItems: StructuredContextItem[];  // Ordered prompt segments
  tailDirectives: string[];               // Highest-recency end-of-prompt instructions
  lowerPriorityTailDirectives: string[];  // End-of-prompt notes injected slightly earlier
  uncensorDirective?: string;             // Optional uncensor instruction
}
```

## StructuredContextItem and MetadataTag

Each context item has:

```typescript
{
  role: "system" | "user" | "model";
  parts: ContextPart[];          // Text, image, or video segments
  metadataTag?: ContextItemTag;  // Semantic tag for identification
  conversationUsers?: ConversationUserReference[]; // Hidden mention/target metadata
}
```

The `metadataTag` is a stable interface between the native builder and the preset builder. It identifies *what kind of content* each item carries, allowing the preset system to rearrange items without understanding their internal structure.

### Tag Reference

| Tag | Block # | Description | Configured via |
|-----|---------|-------------|---------------|
| `SYSTEM_HUMANIZER_RULES` | 1 | System prompt + persona prompt | `/sysprompt`, `/persona` |
| `SYSTEM_PERSONALITY` | 2 | Personality attributes | `/persona attribute add`, `/persona attribute edit`, `/persona attribute remove` |
| `SYSTEM_PUBLIC_PERSONA_ATTRIBUTES` | 3 | Public attributes from other triggered personas | `/persona attribute add`, `/persona attribute edit` |
| `KNOWLEDGE_SERVER_INFO` | 4 | Server name, description, channel info | Automatic (Discord metadata) |
| `KNOWLEDGE_SERVER_MEMORIES` | 5 | Server-level memories | `/memory server add`, `/memory server edit`, `/memory server remove` |
| `KNOWLEDGE_SERVER_EMOJIS` | 6 | Available custom emojis | `/server initialize expressions` |
| `KNOWLEDGE_SERVER_STICKERS` | 7 | Available stickers | `/server initialize expressions` |
| `KNOWLEDGE_USERS_IN_CONVERSATION` | 8 | User list + personal memories + status + reminders + time/channel info | `/memory personal add`, `/memory personal edit`, `/memory personal remove` |
| `KNOWLEDGE_SHORT_TERM_MEMORY` | 9 | Recent conversation summaries from other channels (STM) | `/personal cache` |
| `KNOWLEDGE_SERVER_DOCUMENTS` | 10 | RAG document chunks | `/memory document add`, `/memory history import`, `/memory document remove` |
| `KNOWLEDGE_SERVER_CONDITIONING` | 11 | Reward/punish conditioning guidance for the active persona | `/conditioning reward`, `/conditioning punish`, `/conditioning manage` |
| `DIALOGUE_SAMPLE` | 12 | Sample dialogue pairs | `/persona sample-dialogue add`, `/persona sample-dialogue edit`, `/persona sample-dialogue remove` |
| `DIALOGUE_HISTORY` | 13 | Actual conversation history | `/config message-fetch-limit` |

## Native Assembly Order

When no preset is active, `buildContextNative()` assembles items in this fixed order.
All blocks marked with `*` are conditional (only included when enabled/available in server config).

```text
 1.  System prompt (/sysprompt)                          [SYSTEM_HUMANIZER_RULES]
 2.  Persona prompt (/persona)*                          [SYSTEM_HUMANIZER_RULES]
 3.  Personality attributes (/persona attribute add|edit)* [SYSTEM_PERSONALITY]
 4.  Other triggered personas' public attributes*          [SYSTEM_PUBLIC_PERSONA_ATTRIBUTES]
 5.  Server info = server name + description              [KNOWLEDGE_SERVER_INFO]
 6.  Server memories (/memory server add|edit)*           [KNOWLEDGE_SERVER_MEMORIES]
 7.  Server emojis*                                       [KNOWLEDGE_SERVER_EMOJIS]
 8.  Server stickers*                                     [KNOWLEDGE_SERVER_STICKERS]
 9.  Users in conversation = user list + personal         [KNOWLEDGE_USERS_IN_CONVERSATION]
     memories + status + reminders + time/channel info
10.  Short-term memory (STM) = other-channel summaries*   [KNOWLEDGE_SHORT_TERM_MEMORY]
11.  RAG documents*                                       [KNOWLEDGE_SERVER_DOCUMENTS]
12.  Conditioning guidance*                               [KNOWLEDGE_SERVER_CONDITIONING]
13.  Sample dialogues*                                    [DIALOGUE_SAMPLE]
14.  Conversation history                                 [DIALOGUE_HISTORY]
     + Tail directives (appended to last history item)
```

**Design note:** Volatile content (RAG, conversation history) is placed at the bottom deliberately. LLM providers like Gemini cache context from the top, so keeping stable blocks higher maximizes cache hits across requests.

The system prompt is skipped entirely for user impersonation requests (bot-specific personality should not leak).

Public persona attributes are only drawn from other personas that matched the same original trigger. They are formatted under `Other triggered personas' public attributes:` and each attribute is mention/template-converted with its owning persona name, so `{bot}` resolves to the public attribute's owner rather than the currently responding persona.

## Preset-Driven Assembly

When a SillyTavern preset is active, the system uses a **Build-Then-Rearrange** strategy:

1. Call native `buildContextNative()` to produce all blocks (tagged with `metadataTag`)
2. Group items by tag into consumable "buckets"
3. Walk the preset's node order, pulling from buckets at marker positions
4. Insert custom preset nodes at their declared positions
5. Merge depth-injected nodes into dialogue history items
6. Flush any remaining TomoriBot-only blocks at anchor points

This avoids refactoring the native builder while gaining full preset control over prompt ordering. The native blocks still contain the same content (system prompt from `/sysprompt`, personality from `/persona attribute add`, etc.) — the preset only controls **where** each block appears and **what additional content** is injected around them.

If the preset is deactivated or deleted, context assembly immediately reverts to the native fixed order above. No data is lost — `/sysprompt`, personality attributes, memories, and all other settings are stored independently from the preset.

See [ST Preset System — Context Assembly Override](../integrations/sillytavern-preset-system.md#context-assembly-override-phase-3) for the full algorithm with a worked before/after example.

## Author's Note (Context Note) Injection

TomoriBot supports a user-configurable **author's note** injected into the conversation history block at a specified depth. This is the TomoriBot equivalent of the author's note feature in NovelAI/SillyTavern — a short reminder string placed near the model's most recent attention to reduce context drift.

### Storage and Fallback

Two storage scopes exist, set via `/config context-note set`:

| Scope | Table | Column |
|---|---|---|
| Per-persona | `persona_context_note_configs` | `context_note`, `context_note_depth` |
| Global (server-wide) | `server_chat_configs` | `context_note`, `context_note_depth` |

At inference, the **active persona's note takes priority** over the global note. If the active persona has no note (column is `NULL`), the global note is used as a fallback. If neither is set, no injection occurs.

### Depth Semantics

`depth` is an integer from `0` to `100` (Discord's message-fetch max):

- `depth=0` → injected **after** all fetched history messages (the most recent position)
- `depth=N` → injected before the message at position `totalMessages - N` from the start
- `depth >= totalMessages` → clamped to the **top** of the conversation history

### Injection Format

The note is emitted as a `"user"` role context item with `[System: Author's note — <text>]` formatting, matching the existing convention for system annotations in the dialogue stream (short-term memory summaries, users-in-conversation headers, etc.). No new `authorType` was added.

**Implementation location:** `appendDialogueHistoryContext()` in `src/utils/text/context/dialogueHistory.ts` computes `contextNoteTargetIndex`, emits the note at that index through `pushDialogueHistoryContextItem()` from `src/utils/text/context/history.ts`, and performs the post-loop fallback for `depth=0`.

## Key Behaviors

### User Impersonation Bypass

When `isUserImpersonation` is true, the preset routing is skipped entirely. Presets are character-centric (they control how the bot's persona is presented), so they don't apply when the AI is impersonating a user.

### Tail Directives

Tail directives are short instructions appended to the very last dialogue history item (closest to the model's response). They include:
- Response format hints
- Tool usage guidance

TomoriBot also carries a lower-priority tail bucket for reminders that should sit near the end without owning the strongest recency slot. This is currently used for same-channel memory reminders, and the message pipeline also places emoji repetition guidance there. When possible, this bucket is injected just above the latest dialogue pair instead of at the absolute end.

The uncensor directive is kept isolated and injected after the other tail messages so it retains the strongest recency signal when enabled.

These pass through unchanged in both native and preset modes.

### Tool Prompt Macros

Prompt-owned text can use stable `{..._tool}` macros instead of hardcoding exact function names. During context assembly, Tomori expands these macros before mention conversion.

- static built-in macros expand to the canonical built-in tool names
- search/fetch family macros resolve to the best currently available exact tool name for the active provider/configuration
- if a guild MCP server replaces bundled web search or URL fetching, the resolver uses that server's discovered function names
- if no exact family match can be discovered, the macro falls back to plain-language guidance instead of a stale bundled tool name

This applies to `/sysprompt`, persona prompts, personality attributes, native tool hints, and SillyTavern preset custom/depth-injected nodes.

### convertMentions()

After tool prompt macro expansion, text content passes through `convertMentions()` before being added to context items. This function:
- Resolves `{bot}` → bot's display name
- Resolves `{user}` → triggerer's display name
- Resolves Discord mention syntax (`<@id>`) → display names
- Resolves Discord channel mentions (`<#id>`) and pasted channel links into plain `#name` text instead of exposing channel IDs
- Uses a stable "User" placeholder in system-role content to avoid cache invalidation when different users trigger the same prompt

### Users In Conversation Block

`KNOWLEDGE_USERS_IN_CONVERSATION` now separates visible prompt text from executable targeting metadata:

- visible text lists human-readable user/channel names only
- Discord and Matrix user IDs are no longer shown to the model in this block
- channel context is rendered as plain `#channel-name`
- mention guidance only shows unique non-ID handles; if a handle is ambiguous, the prompt explicitly says clarification is required before pinging
- hidden `conversationUsers` metadata stores the alias-to-target mapping used later by the stream orchestrator and tool resolvers

This keeps the prompt more natural while preserving exact internal IDs for mentions, reminders, and Discord API calls.

### History Annotation Rules

Conversation history can contain one or more leading `[System: ...]` lines before a user's actual text. TomoriBot uses this for:
- reply references
- forwarded-message snapshots
- media-origin hints for quoted/forwarded attachments

Reply-reference and forwarded-message quotes preserve the full normalized message text. If the prompt later needs to shrink, that happens at the history-truncation layer rather than inside the annotation itself.

When a history annotation needs to identify a Discord message for later tool use, the prompt never sees the raw snowflake. Context assembly now emits opaque per-turn keys instead:

- `ref_N` for reply-reference / pin-target message handles
- `media_N` for media-bearing message handles used by `analyze_image`, `read_file`, `process_gif`, image/video generation reference flows, and similar tools

The real Discord IDs stay in a per-request `MessageIdMap` carried alongside context metadata and resolved back at tool-execution time.

When those annotations are present, the dialogue formatter keeps the system lines intact and inserts the speaker prefix only before the remaining user text. This prevents forwarded/reply metadata from being misread as user-authored dialogue.

### Runtime Random Macros

After native assembly or SillyTavern preset rearrangement, `buildContext()` resolves random choice macros in all text parts and tail directives before returning context to callers. Supported forms:

- `{{random: A, B, C}}` / `{random: A, B, C}`
- `{{random::A::B::C}}` / `{random::A::B::C}`

Each macro occurrence is rolled independently at context-build time. Media parts are left unchanged.

## File Map

| File | Purpose |
|------|---------|
| `src/utils/text/contextBuilder.ts` | Public context assembly API boundary |
| `src/utils/text/context/builder.ts` | Preset-aware context routing wrapper |
| `src/utils/text/context/nativeBuilder.ts` | Native fixed-order assembly coordinator |
| `src/utils/text/context/mentionNormalizer.ts` | Mention, channel-link, role, and placeholder normalization |
| `src/utils/text/context/types.ts` | `BuildContextParams`, `BuildContextResult`, `SimplifiedMessageForContext` |
| `src/utils/text/context/templates.ts` | Default prompt, prompt/sample blocks, random-choice macros, conditioning context |
| `src/utils/text/context/memories.ts` | Server memories and short-term memory context from cross-channel and same-channel caches |
| `src/utils/text/context/rag.ts` | RAG query selection and document chunk context |
| `src/utils/text/context/serverAssets.ts` | Custom emoji and sticker context |
| `src/utils/text/context/serverInfo.ts` | Server/DM knowledge-base header |
| `src/utils/text/context/participants.ts` | Users-in-conversation, personal memories, reminders, and mention metadata |
| `src/utils/text/context/dialogueHistory.ts` | Dialogue history shaping, media attribution, context-note injection, and media-window rendering |
| `src/utils/text/context/history.ts` | Shared dialogue/media helpers, timestamps, presence formatting |
| `src/utils/text/presetContextBuilder.ts` | Preset-driven rearrangement engine |
| `src/utils/text/stPresetEngine.ts` | ST macro template engine (two-pass resolution) |
| `src/utils/cache/stPresetCache.ts` | In-memory cache for active preset + nodes |
| `src/types/misc/context.ts` | `StructuredContextItem`, `ContextPart`, `ContextItemTag` definitions |

## See also

- [`../systems/prompt-snapshot.md`](../systems/prompt-snapshot.md) — `/tool prompt snapshot` exposes the fully-assembled context to admins for debugging; describes what it respects vs. skips compared to the live pipeline.
