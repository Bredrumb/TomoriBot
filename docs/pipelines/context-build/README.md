# Context-Build Pipeline

Assembles the LLM-visible prompt — every system message, every memory, every
sample dialogue, every historical message — into a `StructuredContextItem[]`
list ready for a provider.

**Entry point:** `src/utils/text/contextBuilder.ts` (5-line barrel) →
`src/utils/text/context/builder.ts:buildContext()`

**Triggered by:** the chat per-turn stage
[`buildChatTurnContext`](../chat/06-per-turn/01-build-context.md), and any
other caller that needs an LLM prompt for a given persona + history snapshot
(import/export, snapshot tooling, structured-output flows).

## Read order

This folder is two-level. Read the top-level routing wrapper first, then walk
the native-assembly sub-folder top to bottom.

## Pipeline shape

```
buildContext(BuildContextParams)              ← routing wrapper
  │
  ├─ if SillyTavern preset active & not impersonation:
  │     buildContextNative(...)              ← native build runs first
  │     reassembleWithPreset(nativeOutput, presetData, ...)
  │     resolveRandomChoiceMacrosInBuildOutput(...)
  │     → preset-reassembled result
  │
  └─ else:
        buildContextNative(...)
        resolveRandomChoiceMacrosInBuildOutput(...)
        → native result

buildContextNative(BuildContextParams)        ← fixed-order assembly
  contextItems = []
  contextItems.push(...prompt items)          (01)
  contextItems.push(server info)              (02)
  contextItems.push(server memories)          (03)
  contextItems.push(server emojis)            (04)
  contextItems.push(server stickers)          (05)
  contextItems.push(participants)             (06)
  contextItems.push(...short-term memory)     (07)
  contextItems.push(server documents / RAG)   (08)
  contextItems.push(conditioning)             (09)
  contextItems.push(...sample dialogues)      (10)
  appendDialogueHistoryContext(...)           (11)
  → { contextItems, tailDirectives, lowerPriorityTailDirectives, uncensorDirective? }
```

## Stage index

| # | Stage | File | Mission |
|---|-------|------|---------|
| 01 | `buildContext` (routing) | [`01-preset-routing.md`](./01-preset-routing.md) | Decide native vs. preset-reassembly path. |
| 02 | `buildContextNative` (assembly) | [`02-native-assembly/`](./02-native-assembly/) | Fixed-order contributor assembly. |

## Cross-references

- **Producer:** the chat pipeline's per-turn
  [`buildChatTurnContext`](../chat/06-per-turn/01-build-context.md) constructs
  the `BuildContextParams` and consumes the returned `BuildContextResult`.
- **Consumer:** the [provider pipeline](../provider/) consumes `contextItems` as the LLM prompt; the
  chat pipeline appends `tailDirectives` from this pipeline alongside its own
  before passing to the provider.
- **SillyTavern presets:** preset reassembly lives in
  `src/utils/text/presetContextBuilder.ts` (called from the routing wrapper).
  See also [`docs/integrations/sillytavern/preset-system.md`](../../integrations/sillytavern/preset-system.md) for the user-facing system.
- **Tool prompt macros:** `{short_term_memory_tool}`, `{sticker_tool}`,
  `{memory_tool}`, etc. are expanded by `toolPromptMacroResolver` from
  `src/utils/tools/toolPromptMacros.ts`. Used across contributors.

## Output shape

```ts
type BuildContextResult = {
  contextItems: StructuredContextItem[];     // the LLM prompt
  tailDirectives: string[];                  // appended at chat-pipeline tail (impersonation, etc.)
  lowerPriorityTailDirectives: string[];     // inserted before latest dialogue pair (STM hint)
  uncensorDirective?: string;                // appended as separate tail item if active
  messageIdMap: MessageIdMap;                // compact ID ↔ Discord message ID
};
```

Tail directives are *collected* by the contributors (e.g. participants emits
the impersonation directive, short-term memory may emit the same-channel
memory directive) and surfaced via the return shape, not appended to
`contextItems` directly — the chat pipeline's per-turn stage 01 owns the
final tail-directive ordering.

## Plugin agnostic vs. plugin-relevant

This pipeline is the densest plugin-relevant surface in TomoriBot. Each
contributor is an architectural seam for a category the eventual plugin plan
will engage with:

- **Knowledge contributors** (memories, RAG documents, conditioning) — the
  "memory types" plugin category.
- **Asset contributors** (emojis, stickers) — the "server asset" plugin
  category.
- **Participant contributors** — Matrix bridge users and synthetic webhook
  users surface via dedicated maps; a new bridge plugin would emit
  participants here.
- **Dialogue contributors** (sample dialogues, dialogue history) — currently
  fixed; future plugins for "few-shot template providers" would extend here.

Each per-stage doc names its extension point. The pipeline-as-a-whole does
not (yet) expose a "register a new contributor" mechanism — that's
explicitly a plugin-plan candidate to define.
