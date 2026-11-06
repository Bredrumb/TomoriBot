---
title: "02: Native Assembly"
sidebar:
  label: "Overview"
aiGenerated: true
---

Native assembly builds contributions and orders the completed blocks through
`src/utils/text/context/promptLayout.ts`. Contributor execution order allows RAG retrieval to overlap
other work. The registry defines emitted prompt order and system routing; the numbered pages follow
build stages and retain their URLs when the prompt order changes.

Persistent instructions, server knowledge, Always On lore, and conditioning enter the system zone.
Participant profiles and personal memories remain above history. Changing information is positioned
at the [tail slot](/architecture/pipelines/context-build/), after preset reassembly when applicable.

## Contributor index

| Contributor | Relationship |
|---|---|
| [Prompt items](/architecture/pipelines/context-build/02-native-assembly/01-prompt-items/) | Establishes system and persona instructions. |
| [Server info](/architecture/pipelines/context-build/02-native-assembly/02-server-info/) | Supplies the conversation's server context. |
| [Server memories](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/) | Reads persistent server knowledge for the active persona lineage. |
| [Server emojis](/architecture/pipelines/context-build/02-native-assembly/04-server-emojis/) and [stickers](/architecture/pipelines/context-build/02-native-assembly/05-server-stickers/) | Describe expressions available for output. |
| [Participants](/architecture/pipelines/context-build/02-native-assembly/06-participants/) | Resolves participant identity and personal context. |
| [Short-term memory](/architecture/pipelines/context-build/02-native-assembly/07-short-term-memory/) | Supplies recent memory and deferred refresh instructions. |
| [Verbatim tool definitions](/architecture/pipelines/context-build/02-native-assembly/07b-verbatim-tool-definitions/) | Adapts tool schemas for text-based calling. |
| [RAG documents](/architecture/pipelines/context-build/02-native-assembly/08-rag-documents/) | Retrieves relevant uploaded document excerpts. |
| [Lorebooks](/architecture/subsystems/lorebooks/#prompt-integration) | Splits Always On system content from activated tail-slot content. |
| [Conditioning](/architecture/pipelines/context-build/02-native-assembly/09-conditioning/) | Adds server-configured reinforcement. |
| [Sample dialogues](/architecture/pipelines/context-build/02-native-assembly/10-sample-dialogues/) | Shows persona response examples. |
| [Dialogue history](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/) | Supplies recent messages and capability-neutral media descriptors. |

## Output contract

Directives and deferred short-term memory items are kept out of `contextItems` so that the downstream chat pipeline can position them relative to assembled dialogue turns:

- `tailDirectives` receive the impersonation command directive (`Imitate <User>, start your message with <User>:`). `<User>` uses the history's resolved speaker label, and the stream cleaner strips that label as well as the webhook name.
- `uncensorDirective` receives cleaned uncensor text when enabled.
- `nudgeItem` holds the cadence-gated `update_short_term_memory` prompt.
- `memoryInjectionItems` holds content needing positional placement: fresh or cross-channel STM uses the tail slot or a closer configured depth; stale same-channel content uses its saved depth, with `-1` staying above history.

## Shared helpers used across contributors
<!-- anchor: shared-helpers-used-across-contributors -->

Several contributors import shared text and state utilities:

- **`convertMentions`** (`src/utils/text/context/mentionNormalizer.ts`): Normalizes `<@id>`, `<#id>`, `<@&id>`, and macro placeholders (`{bot}`, `{user}`) into readable names. It respects user privacy levels and blacklist settings. In dialogue message bodies, it preserves `{bot}` and `{user}` literals to avoid clobbering raw prompts.
- **`toolPromptMacroResolver`** (`src/utils/tools/toolPromptMacros.ts`): Evaluates `{{if capability:...}}` and `{{if tool:...}}` conditionals, and substitutes provider-specific tool function names (such as `{short_term_memory_tool}` or `{sticker_tool}`) based on active model capabilities and deliberate tool allowlists.
- **`history.ts`** (`src/utils/text/context/history.ts`): Provides media window filtering, timestamp formatting, image limit tracking (`MEDIA_IMAGE_MESSAGE_LIMIT`), and user presence formatting for participant cards.

## Source pointers

- `src/utils/text/context/nativeBuilder.ts`: `buildContextNative` pipeline orchestrator.
- `src/utils/text/context/mentionNormalizer.ts`: Discord mention normalization and placeholder substitution.
- `src/utils/tools/toolPromptMacros.ts`: tool name and capability macro evaluation.
- `src/utils/text/context/history.ts`: shared history filtering and presence formatting helpers.
