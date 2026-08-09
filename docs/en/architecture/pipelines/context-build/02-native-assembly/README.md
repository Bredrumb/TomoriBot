---
title: "02: Native Assembly"
sidebar:
  label: "Overview"
---

Fixed-order contributor pipeline. Each numbered file in this folder
documents one contributor that appends to the shared `contextItems` list.
Order is structural — it determines where each item appears in the LLM's
prompt, and the LLM cares about that order.

**File:** `src/utils/text/context/nativeBuilder.ts:27-320`

## Read order

Walk the numbered files in sequence — they describe the prompt top-to-bottom
as the LLM will see it. The chat pipeline's
[`buildChatTurnContext`](../../chat/06-per-turn/01-build-context) appends
tail directives *after* this output, so the actual prompt the LLM sees is:

```
[01] prompt items                ← system role, top of prompt
[02] server info
[03] server memories             ← skipped on impersonation
[04] server emojis               ← optional
[05] server stickers             ← optional
[06] participants
[07] short-term memory           ← may emit lower-priority tail directive
[07b] verbatim tool definitions  ← optional (verbatim workaround only)
[08] RAG documents               ← optional
[09] conditioning                ← optional
[10] sample dialogues            ← few-shot examples
[11] dialogue history            ← actual messages, bottom of prompt
+ tail directives                ← appended by chat pipeline
+ uncensor directive             ← appended by chat pipeline
```

## Stage index

| # | Contributor | File | Output tag | Skipped when |
|---|-------------|------|-----------|--------------|
| 01 | Prompt items | [`01-prompt-items.md`](./01-prompt-items) | `SYSTEM_HUMANIZER_RULES`, `SYSTEM_CHANNEL_PROMPT`, `SYSTEM_PERSONA_PROMPT`, `SYSTEM_PERSONALITY` | (always emits at least one in non-impersonation) |
| 02 | Server info | [`02-server-info.md`](./02-server-info) | `KNOWLEDGE_SERVER_INFO` | (always emits) |
| 03 | Server memories | [`03-server-memories.md`](./03-server-memories) | `KNOWLEDGE_SERVER_MEMORIES` | impersonation; no memories |
| 04 | Server emojis | [`04-server-emojis.md`](./04-server-emojis) | `KNOWLEDGE_SERVER_EMOJIS` | DM; `emoji_usage_enabled=false`; no guild emojis |
| 05 | Server stickers | [`05-server-stickers.md`](./05-server-stickers) | `KNOWLEDGE_SERVER_STICKERS` | DM; impersonation; `sticker_usage_enabled=false` |
| 06 | Participants | [`06-participants.md`](./06-participants) | `KNOWLEDGE_USERS_IN_CONVERSATION` | prepared discovery plan has no seeds |
| 07 | Short-term memory | [`07-short-term-memory.md`](./07-short-term-memory) | `KNOWLEDGE_SHORT_TERM_MEMORY` | no triggering user ID |
| 07b | Verbatim tool definitions | [`07b-verbatim-tool-definitions.md`](./07b-verbatim-tool-definitions) | `KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS` | `verbatim_tool_calling_enabled=false`; model not tool-capable; no tools resolve |
| 08 | RAG documents | [`08-rag-documents.md`](./08-rag-documents) | `KNOWLEDGE_SERVER_DOCUMENTS` | RAG unavailable; no docs; memory pressure critical |
| 09 | Conditioning | [`09-conditioning.md`](./09-conditioning) | `KNOWLEDGE_SERVER_CONDITIONING` | impersonation; conditioning disabled; no persona lineage |
| 10 | Sample dialogues | [`10-sample-dialogues.md`](./10-sample-dialogues) | `DIALOGUE_SAMPLE` | impersonation; mismatched/empty arrays |
| 11 | Dialogue history | [`11-dialogue-history.md`](./11-dialogue-history) | `DIALOGUE_HISTORY`, `CONTEXT_NOTE_INJECTION` | empty history (no-op) |

## Output shape

```ts
type NativeBuildContextResult = {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];                // populated by contributors
  lowerPriorityTailDirectives: string[];   // populated by short-term memory
  uncensorDirective?: string;              // built from tomoriConfig.uncensor_*
};
```

## Tail-directive collection

Three contributors emit tail directives during assembly:

| Source | Directive | Bucket |
|---|---|---|
| Native builder (impersonation closing block) | `"Imitate ${impersonatedIdentityName}, start your message with ${impersonatedIdentityName}:"` | `tailDirectives` |
| Short-term memory (stage 07) | "Create a short-term memory for this conversation..." hint | `lowerPriorityTailDirectives` (inserted before latest dialogue pair by the chat pipeline) |
| Native builder (uncensor closing block) | Stripped `[System: ...]` text from `buildUncensorInjectionText` | `uncensorDirective` (separate tail item) |

The wrapper (`01-preset-routing.md`) then runs random-choice macro
resolution across all three buckets before returning.

## Shared helpers used across contributors

These helpers are imported by multiple contributors and documented here
rather than per-stage:

### `convertMentions` (`mentionNormalizer.ts`)

Converts `<@id>` / `<@!id>` / `<#id>` / `<@&id>` Discord mentions, channel
permalinks, and `{bot}` / `{user}` placeholders into LLM-readable labels.
Used by every contributor that emits text into context items. May fetch
guild members, channels, and roles from Discord; respects user privacy
levels (`FULL` privacy hides nicknames), blacklist status, and the
server's `personal_memories_enabled` config.

### `resolveRandomChoiceMacros` (`templates.ts`)

Rolls `{{random:a,b}}` / `{{random::a::b}}` / `{random:a,b}` / `{random::a::b}`
macros independently per occurrence. Used by SillyTavern preset imports.
Runs in the routing wrapper after all contributors complete (see stage 01).

### `toolPromptMacroResolver` (`src/utils/tools/toolPromptMacros.ts`)

Evaluates scoped `{{if capability:...}}` and `{{if tool:...}}` blocks, then
expands tool-name macros (`{short_term_memory_tool}`, `{sticker_tool}`,
`{memory_tool}`, etc.) into the actual function-call tool names for the active
provider. Tool predicates share the resolver's lazy availability lookup and
respect the per-turn Deliberate Tool Mode allowlist. The resolver is built once
at the top of the native builder and passed to contributors that emit
tool-reference text.

### `history.ts` utilities

A grab-bag utility module split between two consumers:

- **Used by `dialogueHistory.ts`** (stage 11):
  `buildMediaAttributionText`, `buildMediaDescription`,
  `formatMessageTimestamp`, `getLastImageOccurrenceIndices`,
  `getRenderedImageMessageIdsWithinWindow`,
  `isCountedRenderedImageAttachment`, `MEDIA_IMAGE_MESSAGE_LIMIT`,
  `pushDialogueHistoryContextItem`.
- **Used by `participants.ts`** (stage 06): `getUserPresenceDetails` —
  formats Discord presence (online/idle/dnd, activities like Playing /
  Listening on Spotify / Watching / Competing) into a human-readable
  status string.
- **Re-exported from the public barrel:** `formatTimestampInline` is
  exposed via `src/utils/text/contextBuilder.ts` for external callers.

## Extension points

The native builder itself is **a fixed-order contributor sequence** — there
is no current registration mechanism for adding new contributors. The order
matters (prompt at top, dialogue history at bottom) and changing it without
the LLM noticing is unlikely.

A future plugin extension for "add a new contributor" would likely take the
form of either:

- (a) Named insertion points (`afterServerInfo`, `beforeDialogueHistory`)
  where a plugin's `ContextContributor` registers. → plugin plan candidate.
- (b) Pre/post hooks on the whole native build, less granular. The plugin
  emits its own context items and the runner appends them at the configured
  position.

The individual contributors *do* have plugin-relevant seams — see each
per-stage doc's "Extension points" section. Today's most plugin-relevant
seams are the memory-type contributors (stages 03, 07, 09) and the
asset-type contributors (stages 04, 05).
