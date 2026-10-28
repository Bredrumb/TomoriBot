---
title: "SillyTavern Preset System"
aiGenerated: true
---

SillyTavern presets are JSON configurations that control prompt node ordering, custom prompt
injections, depth-based chat insertions, and template macros. They alter how context blocks are
assembled without modifying underlying persona or server data.

## Flow and ownership

Context assembly under a SillyTavern preset uses a build-then-rearrange strategy coordinated across
three layers:

1. `src/utils/text/context/builder.ts`: checks for an active preset, builds native context, and
   passes it to preset reassembly. `contextBuilder.ts` exposes this entry point.
2. `src/utils/text/presetContextBuilder.ts`: decomposes native context blocks into tagged buckets and
   rebuilds the prompt according to the preset's declared node sequence.
3. `src/utils/text/stPresetEngine.ts`: expands variables and content macros. Reassembly then uses
   `toolPromptMacroResolver` for capability and tool conditionals, followed by mention conversion.

```
buildContext (contextBuilder.ts)
  │
  ├─► User Impersonation Active? ──► Native Context Assembly (presets bypassed)
  │
  └─► Active Preset Found in Cache (stPresetCache.ts)
        │
        ▼
buildContextNative (context/nativeBuilder.ts)
  │  Produces tagged blocks for reassembleWithPreset (presetContextBuilder.ts)
  │
  ├─► stPresetEngine.ts ───────────► Two-pass macro evaluation on custom preset nodes
  │                                  (Pass 1: branch selection and variables; Pass 2: value expansion)
  │
  ├─► Node Ordering Walk ──────────► Pulls tagged blocks at marker nodes (main, charDescription...)
  │                                  Inserts custom nodes at declared sequence positions
  │
  ├─► Automatic Flushing ──────────► Injects TomoriBot-only blocks (memories, emojis, STM)
  │
  └─► Depth Injection Merging ─────► Folds depth-injected nodes into existing history turns
        │
        ▼
Final Assembled Context to Provider Adapter
```

### Build-then-rearrange strategy

The routing wrapper invokes `buildContextNative()` to produce candidate context items labeled with
`metadataTag`, then passes them to `reassembleWithPreset()`.
Items are partitioned into consumable tag buckets. The preset builder walks the active preset's
`node_order`, consuming items from matching buckets at marker nodes and inserting custom text
nodes at their declared positions.

### Marker-to-tag mapping

Preset marker nodes pull items from specific native context buckets:

| Marker identifier | ContextItemTag | Native block |
|---|---|---|
| `main` | `SYSTEM_HUMANIZER_RULES`, `SYSTEM_CHANNEL_PROMPT` | System prompt and channel prompt overrides |
| `charDescription` | `SYSTEM_PERSONA_PROMPT` | Persona prompt |
| `charPersonality` | `SYSTEM_PERSONALITY` | Personality attributes |
| `dialogueExamples` | `DIALOGUE_SAMPLE` | Sample dialogue turns |
| `chatHistory` | `DIALOGUE_HISTORY` | Live conversation history |
| `worldInfoBefore` | `KNOWLEDGE_LOREBOOK_BEFORE`, `KNOWLEDGE_SERVER_DOCUMENTS` | Lore entries placed before, then RAG document chunks |
| `worldInfoAfter` | `KNOWLEDGE_LOREBOOK_AFTER`, `KNOWLEDGE_SERVER_DOCUMENTS` | Lore entries placed after, then any documents not yet consumed |

Marker blocks move according to the preset layout. Specific native blocks are suppressed only when
explicitly replaced:

- The server-level system prompt and the default fallback are both omitted while a preset is active,
  so the `main` marker carries only a channel prompt override.
- The native `charDescription` block is skipped if a custom preset node expands the `{{description}}`
  macro.
- The native `charPersonality` block is skipped if a custom preset node expands the `{{personality}}`
  macro.

### TomoriBot-only block flushing

Context items that lack SillyTavern marker equivalents (server information, server memories, custom
emojis, stickers, active participants, short-term memories, and conditioning guidance) flush
automatically at anchor markers:

- Server information, memories, emojis, and stickers flush after `charPersonality`,
  `charDescription`, or `main`.
- Active users, short-term memory, and conditioning flush before `dialogueExamples` or `chatHistory`.
- The first world info marker consumes the document block. When a marker is missing, its lore
  placement block flushes with the dialogue group in before lore, documents, after lore order.
- After the node walk, reassembly flushes any unconsumed knowledge and participant groups, then
  appends remaining buckets. Omitting markers does not guarantee that these groups precede history.

## Depth injection contracts

Nodes configured with `injection_position: 1` target positions counting backwards from the end of the
conversation log:

- Depth 0 targets the final message in history (closest to the model's turn).
- Depth 1 targets the second-to-last message.
- Depth N targets the (N + 1)th history message from the end, clamped to the earliest history
  message when out of range. Injections are omitted when no history item exists.

### In-place message merging

To prevent role-alternation errors on strict providers such as Google Gemini and Anthropic, depth
injections merge directly into existing conversation turns as `[System: ...]` text parts. They do not
create standalone messages.

### Same-depth batching

All injections targeting the same depth index combine into a single `[System: ...]` container
ordered by `injection_order`. This avoids redundant wrapper prefixes and conserves prompt tokens.

## Template macro engine

The template engine in `src/utils/text/stPresetEngine.ts` processes custom preset nodes in two
sequential passes:

### Pass 1: Branch selection and variables

The engine strips comments, then walks enabled non-marker nodes in `node_order`. The shared tree in
`promptConditionals.ts` pairs both dialects' openers, `else`, and closers, so they can nest in either
direction. `renderStConditionals` selects Handlebars branches and collects `setvar` and `addvar`
declarations from their kept text in source order. Conditions see only declarations already visited,
including earlier declarations in the same node. The selected text is saved: evaluating it again
against the final variable map could select a different branch from the one whose declarations ran.

TomoriBot capability and tool blocks are re-emitted for the later async pass. Their branches keep
the existing variable-collection behavior because tool availability is not evaluated in this pass.

### Pass 2: Value expansion

The engine resolves `getvar` against the final variable map, then content and runtime macros,
random choices, dice rolls, compatibility placeholders, and trimming. Expanding a nonempty persona
description or personality in body text suppresses its native marker. Testing one in a condition
does not suppress that marker.

Reassembly then calls `toolPromptMacroResolver.expand` to select capability and tool branches and
expand tool names. `convertMentions` runs last for identity placeholders (`user`, `char`, and `bot`).
These passes operate on custom preset nodes; lorebook entries keep their identity-only conversion.

### Conditional contract

Conditions accept nested value macros or bare names such as `description` and `getvar::compact`.
Trimmed, case-insensitive empty text, `false`, and `0` are falsy; unknown macros in conditions resolve
empty. `#unless` inverts the result and requires `{{/unless}}`; `#if` requires `{{/if}}`.

Malformed blocks are omitted with warnings, and stray `else` or closers are dropped. An unclosed
Handlebars block ends at the node boundary; an unclosed TomoriBot block is omitted. Nesting beyond
32 levels leaves conditional syntax unrendered. Import auditing uses the same tree to report
malformed blocks and inspect macros in both branches and conditions.

### Runtime values and ceilings

`context/builder.ts` captures one clock reading per preset build and passes it with the configured
model, provider, and server UTC offset. All five temporal macros use that reading and offset, and
resolve empty when time awareness is off. They use English display formats; ISO forms use
`YYYY-MM-DD` and `HH:mm`. The [macro catalog](/features/integrations/sillytavern-support/#preset-macros)
lists the author-facing values and prompt-cache placement advice.

`model` reports the configured codename, so randomizer picks and provider fallback models are not
reflected. Supporting an effective model requires threading the resolved request model through
`BuildContextParams`. `char_version` is recognized but empty until a second card metadata field
warrants shared storage. `scenario` is empty because import folds it into personality attributes.

## Caching and database persistence

Active presets are cached in memory via `src/utils/cache/stPresetCache.ts` using the numeric
`server_id` as the cache key:

- **Cache TTL:** 10 minutes (`CACHE_DURATION_MS`).
- **Invalidation:** Evicted immediately upon preset activation, deactivation, node toggling, or
  preset deletion. Preset mutation methods in `PresetRepository.ts` invalidate the preset cache after
  successful writes; domain operations also refresh assembled persona state.
- **Negative caching:** Missing presets cache as `null` to prevent repeated database queries on
  servers operating under native context assembly.

Preset records persist across two relational tables:

- `st_presets`: stores unique preset names per server, raw JSON payloads, and active status flags.
- `st_preset_nodes`: stores individual prompt nodes, structural markers, user toggles, ordering
  indices, and injection depth coordinates.

## Parity and operational boundaries

TomoriBot adapts SillyTavern presets to its architecture:

- **Single-character focus:** Contexts model one active persona per turn. Multi-character group RP
  macros (`{{group}}`) are unsupported.
- **Dynamic knowledge retrieval:** `worldInfoBefore` and `worldInfoAfter` carry activated lorebook
  entries and retrieved document chunks. Keyword activation runs in native assembly, so the buckets
  hold only the entries that activated this turn.
- **Regex post-processing:** SillyTavern output regex scripts are unsupported; provider responses
  stream directly to Discord without regex transforms.
- **HTML tags:** Discord does not render HTML markup. Preset nodes containing HTML tags raise a
  `hasHtmlWarning` flag during diagnostics but are not stripped.
- **Assistant prefill:** Custom assistant nodes become model-role context items and remain subject to
  provider request normalization. Terminal sample dialogue blocks receive a user-side separator.
  Explicit assistant prefill follows the separate [strict completion policy](/architecture/subsystems/strict-chat-completion/); arbitrary preset nodes are not automatically valid prefills.

## Source pointers

- `src/utils/text/presetContextBuilder.ts`: Build-then-rearrange orchestration, tag bucket
  consumption, and depth injection merging.
- `src/modules/lorebooks/runtime/contextItems.ts`: Activated lore blocks and identity conversion.
- `src/utils/text/stPresetEngine.ts`: `resolvePresetMacros` for branch selection, variables, and value expansion.
- `src/utils/tools/promptConditionals.ts`: the shared tree and `renderStConditionals`.
- `src/utils/tools/toolPromptMacros.ts`: capability and tool evaluation.
- `src/utils/db/repositories/PresetRepository.ts`: preset persistence and post-write invalidation.
- `src/utils/stPreset/stPresetOperations.ts`: Domain operations and database mutations.
- `src/utils/stPreset/stPresetImportParser.ts`: SillyTavern JSON validation and node extraction.
- `src/utils/cache/stPresetCache.ts`: In-memory preset caching and cache invalidation.
- `src/utils/text/contextBuilder.ts`: Context pipeline entry point and native bucket generation.
