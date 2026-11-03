---
title: "NovelAI Text Models"
sidebar:
  order: 4
aiGenerated: true
---

NovelAI image models work out of the box once configured. Text models need special handling and
context formatting to keep background information separate from dialogue. NovelAI's
[Chat Format guide](https://docs.novelai.net/en/text/chatformat/) describes the story-style approach
used for Kayra and Erato; GLM and Xialong use separate chat templates. The filtering and polishing
below are TomoriBot's adaptations.

## Sampling presets

Switching text models applies matching defaults. Change presets for Kayra, Erato, or Xialong in
`/config` > `Models` > `Text Samplers & Parameters`; GLM uses model defaults. Later sampler edits
remain active.

## Context and settings

Omitted settings stay saved for other providers.

| Content or setting | NovelAI handling |
|---|---|
| Persona attributes, sample dialogue, conversation, and memories | Kept, including visible personal and short-term memories. Privacy and memory-tag filters still apply. |
| System, persona, and channel prompts; context notes; humanizer rules; conditioning; SillyTavern instructions | Omitted. Xialong uses NovelAI's system prompt; GLM, Kayra, and Erato have no system block. |
| Status, time/channel/server info, documents, and emoji/sticker/sprite inventories | Omitted. |
| Memory-tool nudges | Omitted, including nudges built before a personal override or fallback. |
| ATTG metadata and quality stars | ATTG means Author, Title, Tags, and Genre. Xialong puts metadata first in its persistent information and defaults to 4 stars. Erato uses configured stars; Kayra omits stars. |
| Response prefills | Kept when allowed by the prefill controls. |
| Tools and media | No text-model tool calls or image/video input. Separate image-generation commands remain available. |
| Token limits | Counted locally with room reserved for replies. Configured reply length takes priority over preset length and may be reduced to fit. |

Known foreign speaker labels and standalone `---` or `***` lines stop output, even with the shared
speaker-stop setting off. The responding persona's names, aliases, and sprite labels remain allowed.
The local guard preserves code; literal API stops can still match inside generated code.

## Context trimming

Memories use up to 20% of the context window, with older entries removed first. If the prompt still
does not fit, TomoriBot trims it in this order:

| Order | Content removed | Content protected |
|---|---|---|
| 1 | Extra sample dialogue | One available sample exchange |
| 2 | Memories, older entries first | No minimum |
| 3 | Old conversation history | Up to two recent history exchanges |

Persona attributes, ATTG metadata, and the current turn also stay protected. Generation fails if the
protected context cannot fit. Trimming leaves saved memories and messages unchanged.

`/tool prompt snapshot` shows the final prompt, token counts, reply cap, and trimming report.

## Text polishing and Discord delivery

Polishing changes only the copy of history, memories, and sample dialogue sent to all four NovelAI
models, before token counting. Saved text and other providers are unchanged; grammar is not rewritten.

- **Text is properly capitalized**: Latin sentence and line starts are capitalized; known persona
  names use their configured casing.
- **Prose lines receive punctuation**: Missing final periods are added while existing punctuation,
  line breaks, and blank lines stay in place.
- **Formatted prose is polished**: `*kisses juno*` becomes `*Kisses Juno.*`. Bold, underline,
  strikeout, and spoilers follow the same rules; inline emphasis keeps its casing except for names.
- **Code and markup are preserved**: Code, URLs, mentions, Discord markup, lists, headings,
  blockquotes, tables, and separators keep their contents or structure.
- **Non-prose starts and endings are respected**: Lines starting with code fences, URLs, mentions,
  emoji, or non-Latin letters skip sentence formatting. Emoji, kaomoji, code, and link endings gain
  no extra period.
- **Long-term memories use plain contents**: Added owner labels, database IDs, and tag prefixes are
  omitted; resolved names remain.
- **Generated history annotations are removed**: Reply references, reaction metadata, and
  administrative notices are omitted. Gestures become actions; scenes and summaries lose their
  system wrapper. Literal user text containing `System:` is retained.
- **Prefills stay exact**: Explicit response prefills and continuation fragments are unchanged.
- **Discord delivery follows your settings**: The humanizer still controls casing, punctuation,
  and message splitting. Later history is polished again; lost punctuation cannot be recovered exactly.
