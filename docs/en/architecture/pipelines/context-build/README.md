---
title: "Context-Build Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Context Build"
  order: 200
aiGenerated: true
---

The context-build pipeline assembles system messages, memories, persona instructions, sample dialogues, and recent conversation turns into structured context items for an LLM provider.

The public entry point is `buildContext` in `src/utils/text/contextBuilder.ts`, which delegates to `src/utils/text/context/builder.ts`.

## Flow and routing

Context assembly follows a two-tier structure:

```
buildContext(BuildContextParams)
  │
  ├─ if SillyTavern preset active and not impersonation:
  │     buildContextNative(...)
  │     reassembleWithPreset(nativeOutput, presetData, ...)
  │     resolveRandomChoiceMacrosInBuildOutput(...)
  │     → preset-reassembled result
  │
  └─ else:
        buildContextNative(...)
        resolveRandomChoiceMacrosInBuildOutput(...)
        → native result
```

Native assembly always runs first. If a SillyTavern preset is active for the server and the current turn is not a user impersonation, the pipeline passes the native items into `reassembleWithPreset` in `src/utils/text/presetContextBuilder.ts` to arrange them into preset sections. Otherwise, the native build is returned directly.

Both paths finish by passing the assembled output through `resolveRandomChoiceMacrosInBuildOutput`, which resolves `{{random:a::b}}` and `{random::a::b}` choices across emitted text. Lorebook blocks are exempt because their content resolves identity macros only.

## Layout and terms

A speaker turn is a run of consecutive messages from one user or persona. A chat turn is one bot
response cycle, which may contain several tool-loop steps. The tail slot is the insertion point
above the last 4 speaker turns. When history is shorter, adjacent sample dialogues supply the
remaining turns; otherwise the slot sits above the earliest available turn.

History speaker changes follow author IDs, so shared or changed display names do not change the
count. Synthetic system notices do not count or interrupt a run. Adjacent example lines count by
speaker role, with consecutive persona-only examples forming one run.

`src/utils/text/context/promptLayout.ts` owns block order, system-message routing, preset flush
membership, and positional inserts. Contributors build content; the registry orders it and the
chat pipeline applies its insert rules after native or preset assembly. Page numbering follows
build stages, rather than prompt order.

The system zone contains persistent instructions, server knowledge, Always On lore, and conditioning.
Participant profiles and personal memories remain above history. The tail slot contains fresh or
cross-channel STM, activated lore, retrieved documents, presence, then the clock and channel line.
Configured STM depths may place content closer to generation. Context notes and existing nudges keep
their saved item-based depths.

The registry marks the last item above the slot as the cacheable-prefix boundary. Anthropic adapters
use it alongside the system-message end for cache breakpoints; provider normalization must preserve
that marker. Budget truncation retains the moved facts and reapplies their positions and the
boundary to the surviving history. Moving a context note deeper than the slot changes the prefix
every chat turn. Date spacers with relative wording such as "yesterday" also change at server-day boundaries.

## Stages

| Stage | Path | Purpose |
|---|---|---|
| 01 | [Preset Routing](/architecture/pipelines/context-build/01-preset-routing/) | Selects native fixed-order assembly or SillyTavern preset reassembly. |
| 02 | [Native Assembly](/architecture/pipelines/context-build/02-native-assembly/) | Assembles context items in a deterministic sequence. |

## Output contract

Directives and deferred short-term memory items pass through the return shape instead of appending directly to `contextItems`:

- `tailDirectives` hold instructions such as impersonation prefixes, stop requests, or manual system prompts.
- `lowerPriorityTailDirectives` hold guidance inserted before the latest dialogue pair.
- `uncensorDirective` holds stripped uncensor prompt injection text.
- `nudgeItem` and `memoryInjectionItems` provide short-term memory reminders and content blocks for registry-controlled positional insertion.
- `messageIdMap` maps compact media and reference IDs to Discord message IDs.

The chat pipeline's turn builder in [Build Context](/architecture/pipelines/chat/06-per-turn/01-build-context/) consumes this result, orders tail directives, and inserts positional items before passing the prompt to the [Provider Pipeline](/architecture/pipelines/provider/).

Media resolution runs per generation attempt after context build. The dialogue history contributor records capability-neutral `mediaDescriptors`, and `resolveMediaForModel` adapts attachments to the routed model's vision capabilities.

## Source pointers

- `src/utils/text/context/builder.ts`: routing wrapper and macro resolution.
- `src/utils/text/context/nativeBuilder.ts`: native assembly.
- `src/utils/text/context/promptLayout.ts`: ordering, zones, anchors, and prefix boundary.
- `src/utils/text/presetContextBuilder.ts`: SillyTavern preset rearrangement.
- `src/utils/text/context/types.ts`: build parameters and result contracts.
