---
title: "NovelAI Provider Limitations"
aiGenerated: true
---

NovelAI text models accept text prompts and return streamed text. They do not accept image or
video input or support function calling. The provider and stream adapter advertise no function
calling, `getTools()` returns an empty list, and prompt inspection omits tool schemas.

NovelAI image generation uses a separate pipeline. It remains available through dedicated commands
and through image tools called by a text provider that supports function calling.

## Prompt and context constraints

GLM uses a chat template with role tags; Kayra and Erato use story-format prompts with speaker
labels. The adapter assembles system instructions, persona content, memories, and dialogue into
these formats. It does not inject tool guides or tool interaction history.

`SYSTEM_INSTRUCTION_TAGS_BASE` in `src/providers/novelai/promptRenderers.ts` selects the system
instruction blocks. Server emoji and sticker inventories are absent from that list. The short-term
memory summary remains in context, while `buildShortTermMemoryContext` omits tool-usage directives
for NovelAI.

The adapter estimates token usage from the final prompt and clamps the requested output length
against the model's context limit. Kayra and Erato use the cached subscription context allowance
when available, keyed by the selected request credential. Generation warms that entry during
budgeting and recalculates from the original context when rotation changes the key. Allowance
values and lookup-failure defaults are inherited policy pending model/tier verification. This
estimate does not guarantee that an oversized prompt fits.

## Incomplete GLM responses

GLM sentence buffering emits text through the last sentence boundary and withholds an incomplete
trailing fragment. If the response is empty, the provider attaches the fragment as
`naiContinuationPrefill`, which the chat retry appends to the next prompt. Thinking blocks are
captured for thought logs and stripped from visible output.

## Source pointers

- `src/providers/novelai/providerInfo.ts`: Provider capabilities.
- `src/providers/novelai/novelaiProvider.ts`: Tool list and continuation metadata.
- `src/providers/novelai/novelaiStreamAdapter.ts`: Prompt assembly, context estimates, and stream guards.
- `src/providers/novelai/promptRenderers.ts`: Story and GLM rendering, ATTG metadata, and tag admission.
- `src/utils/text/context/memories.ts`: Short-term memory context.
- `src/utils/text/promptInspection/assemble.ts`: Prompt inspection tool admission.
