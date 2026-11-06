---
title: "NovelAI"
sidebar:
  order: 4
aiGenerated: true
---

NovelAI connects text models (`GLM 4.6`, `Xialong`, `Kayra`, `Erato`) and anime image generation.
You can use NovelAI for both, or pair its image generation with another chat provider.

## Text models and subscription
<!-- anchor: text-models-and-subscription -->

`GLM 4.6` is the default text model. `Xialong` and `Erato` require an active Opus subscription.
Selecting `Xialong` checks your saved server or personal key; if you select it before adding a key,
the check runs when you add the key. The serving key's subscription determines the context
allowance. Server managers can check Opus generation allowance with `/novelai usage`.

NovelAI's [Chat Format guide](https://docs.novelai.net/en/text/chatformat/) describes the
story-style approach used for `Kayra` and `Erato`; `GLM 4.6` and `Xialong` use separate chat
templates. The filtering and polishing below are TomoriBot's adaptations.

## Sampling presets
<!-- anchor: sampling-presets -->

Switching text models loads `Carefree-Kayra`, `Erato-Shosetsu`, or `Default-Xialong` for the
selected model; `GLM 4.6` uses its own defaults. Switching resets temperature, top-k, top-p, and
min-p and enables those samplers for both server and personal model switches. Change presets or
samplers in `/config` > `Models` > `Text Samplers & Parameters`; later edits stay active, and
replacing a key on the same model preserves them.

## Context and settings
<!-- anchor: context-and-settings -->

Omitted settings stay saved in `/config` > `Behavior` > `General Behavior` for other providers.

| Content or setting | NovelAI handling |
|---|---|
| Persona attributes, sample dialogue, conversation, and memories | Kept, including visible personal and short-term memories. Privacy and memory-tag filters still apply. |
| Lorebooks | Kept as entry contents. Always On lore stays with persistent information; activated lore sits above the last four speaker turns. |
| System, persona, and channel prompts; context notes; humanizer rules; conditioning; SillyTavern instructions | Omitted. Xialong uses NovelAI's system prompt. |
| Status, time/channel/server info, documents, and emoji/sticker/sprite inventories | Omitted. |
| Memory-tool nudges | Omitted, including nudges built before a personal override or fallback. |
| ATTG metadata and quality stars | ATTG means Author, Title, Tags, and Genre. Xialong puts metadata first in its persistent information and defaults to 4 stars. Erato uses configured stars; Kayra omits stars. |
| Response prefills | Kept when allowed by the prefill controls. |
| Tools and media | No text-model tool calls or image/video input. Slash commands and separate image-generation commands remain available. |
| Token limits | Counted locally with room reserved for replies. Configured reply length takes priority over preset length and may be reduced to fit. |

Known foreign speaker labels and standalone `---` or `***` lines stop output, even with the shared
speaker-stop setting off. The responding persona's names, aliases, and sprite labels remain allowed.
The local guard preserves code; literal API stops can still match inside generated code.

## Context trimming
<!-- anchor: context-trimming -->

Memories and lore share up to 20% of the context window. Older memories leave first; undated entries
use their source order. Always On lore can also be trimmed. If the prompt still does not fit,
TomoriBot trims it in this order:

| Order | Content removed | Content protected |
|---|---|---|
| 1 | Extra sample dialogue | One available sample exchange |
| 2 | Memories and lore | No minimum |
| 3 | Old conversation history | Up to two recent history exchanges |

Persona attributes, ATTG metadata, and the current turn also stay protected. Generation fails if the
protected context cannot fit. Trimming leaves saved memories, lore, and messages unchanged.

`/tool prompt snapshot` shows the final prompt, token counts, reply cap, and trimming report.

## Text polishing and Discord delivery
<!-- anchor: text-polishing-and-discord-delivery -->

Polishing changes only the copy of history, memories, lore, and sample dialogue sent to all four NovelAI
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

## Image generation
<!-- anchor: image-generation -->

Assign a model to the `NovelAI Image` slot under `/config` > `Models` > `Switch Models`. Members
can generate images directly with `/novelai generate image`, or ask in chat when the active text
provider supports tool calling.

The `Default + Image Generation Expert` preset uses imageboard-style tags for NovelAI, with short
descriptions when needed for interactions or text placement. For scenes with multiple characters,
TomoriBot keeps shared scenery and camera directions separate from each character's appearance and
actions.

For readable speech, ask TomoriBot to include the exact dialogue. The NovelAI image tool places
character dialogue in a trailing `Text:` section automatically. V4 and V4.5 support English text;
V5 also supports Japanese and Chinese. Text on signs or screens can be described in the shared
scene prompt. Keep requested text short and avoid `no text` among positive tags. Placement and
typography (including vertical Japanese writing) are suggestions rather than guarantees.
