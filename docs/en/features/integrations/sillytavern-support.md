---
title: "SillyTavern Support"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Import SillyTavern character cards and prompt presets into Discord with TomoriBot. Bring your existing characters to your server."
sidebar:
  order: 2
aiGenerated: true
---

TomoriBot can import two assets from [SillyTavern](https://github.com/SillyTavern/SillyTavern):
Prompt Manager presets (which control prompt structure) and character cards (the character definition).
If you have never used SillyTavern, you can safely skip this page.

## Character Card Import

Bring an existing SillyTavern character into Discord with `/persona import`. It accepts:

- **PNG cards** with embedded `chara` or `char` metadata.
- **v2-style JSON** cards with root-level properties (`name`, `description`, `first_mes`).
- **v3 JSON** cards (`spec: "chara_card_v3"` with a nested `data` object).
- **`.charx` archives** (Character Card V3 packages).

A `.charx` file is a ZIP archive containing a `card.json` definition. TomoriBot imports the
character text from `card.json` and skips bundled asset files (icons, sprites, audio, video).
You can set an avatar in `/config` > Persona > Identity & Personality and add sprites in
`/config` > Persona > Sprites.

If an uploaded file is a valid SillyTavern card without TomoriBot metadata, the import
converts it automatically. You can also pass a card to `/persona generate` to create a fresh
persona inspired by the character.

Imports are validated before saving (default limits: 5,000 characters per text field, 200
attributes, 100 sample dialogues per side, 100 trigger words). For field mapping and
conversion mechanics, see the
[card-support architecture](/architecture/integrations/sillytavern/card-support/).

:::tip
A card's Character Book becomes that persona's [lorebook](/features/knowledge/lorebooks/). Disabled entries stay disabled. Re-importing the card replaces the persona's whole lorebook, including entries you added yourself.
:::

## Prompt Presets
<!-- anchor: prompt-presets -->

A SillyTavern Prompt Manager preset controls the order and layout of the prompt sent to the
model. Open `/config` > Plugins > SillyTavern Presets to import presets, toggle individual
nodes, switch active presets, or restore default formatting.

:::tip
Importing a preset with a name that already exists replaces that preset, including the nodes you had toggled on or off, and activates the new one. Give each variant a different name if you want to keep both.
:::

### What a Preset Controls

- Prompt ordering and marker placement
- Custom prompt nodes
- Post-history and depth-injection nodes
- Initial enabled state for imported nodes

### What a Preset Does Not Replace

A preset structures prompt layout; it does not replace the text sources that fill it:

- System instructions and persona fields: `/config` > Behavior > General Behavior,
  `/config` > Persona > Advanced, and `/config` > Persona > Identity & Personality.
- Live chat history, retrieved document context, and activated lorebook entries.
- Automatic context: server memories, emoji and sticker data, participant lists, and
  short-term memories.

### How Native Blocks Map

Native blocks map directly to TomoriBot prompt components:

- `main`: the channel prompt override, when configured
- `charDescription`: `/config` > Persona > Advanced
- `charPersonality`: `/config` > Persona > Identity & Personality
- `dialogueExamples`: `/config` > Persona > Identity & Personality
- `chatHistory`: live channel message history
- `worldInfoBefore` and `worldInfoAfter`: lorebook entries for that placement, then retrieved document context

### System Prompt Rule

When an imported preset is active, it fully controls the system prompt. TomoriBot's built-in
prompt and any custom prompt from `/config` > Behavior > General Behavior are not sent, and the
system prompt buttons there are locked. Your custom prompt is kept, and it comes back when you turn
the preset off in `/config` > Plugins > SillyTavern Presets.

### Conditional instructions

Use Handlebars blocks to include instructions only when a value is present:

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

A bare name such as `description` means `{{description}}`. You can also put value macros directly
inside a condition, as in `{{#if {{input}}}}`. Empty text, `false`, and `0` are false after spaces
are trimmed and case is ignored. Unknown macros in conditions count as empty.

Blocks can nest, including TomoriBot's `{{if capability:web_search}}` and `{{if tool:web_search}}`
blocks. Close `#if` with `{{/if}}` and `#unless` with `{{/unless}}`. A malformed block (such as a second
`else` or the wrong closer) is omitted. A Handlebars block without a closer ends at the end of its
node. Stray `else` and closers are dropped. More than 32 nested blocks leave the conditional syntax
unrendered. Import notes report these problems.

`{{setvar::key::value}}` stores text; `{{addvar::key::value}}` appends it. A declaration in an untaken
Handlebars branch has no effect. Conditions see declarations earlier in the node order, including
earlier in the same node. Plain `{{getvar::key}}` text sees the final value after all enabled nodes
have been visited. Tool and capability conditions run afterward, so they do not control variable
assignment.

### Preset macros
<!-- anchor: preset-macros -->

| Macro | Value |
|---|---|
| `{{user}}` | The member who triggered the reply |
| `{{char}}`, `{{bot}}` | The active persona's name |
| `{{personality}}` | Persona attributes |
| `{{description}}` | Persona prompt |
| `{{scenario}}` | Empty: card scenarios are folded into persona attributes |
| `{{mesExamples}}` | Sample dialogue text |
| `{{lastChatMessage}}`, `{{input}}` | The most recent user message in the supplied conversation |
| `{{time}}` | Server time, such as `3:45 PM` |
| `{{date}}` | Server date, such as `October 28, 2026` |
| `{{weekday}}` | English weekday name, such as `Wednesday` |
| `{{isotime}}` | Server time in `HH:mm` format, such as `15:45` |
| `{{isodate}}` | Server date in `YYYY-MM-DD` format, such as `2026-10-28` |
| `{{model}}` | Configured model id; per-turn randomizer picks and fallback models are not reflected |
| `{{provider}}` | Configured provider id: `google`, `openrouter`, `novelai`, or `custom` |
| `{{char_version}}` | Empty: character card versions are not stored |

Temporal macros share one clock reading per prompt and use the server's numeric UTC offset.
Daylight saving follows the offset you set. A member's personal timezone does not affect them.
When time awareness is off, all five temporal macros are empty and a condition testing one is false.
Keep temporal macros in late or depth-injected nodes: a changing value such as `{{time}}` invalidates
the provider prompt cache for everything after it.

`{{random: A, B}}` and `{{random::A::B}}` choose an item; `{{roll:2d6}}` rolls dice. `{{// notes}}`
removes a comment and `{{trim}}` trims the node's surrounding whitespace. These macros and
conditionals apply to preset instructions. Lorebook entries expand only `{{user}}`, `{{char}}`, and
`{{bot}}`.

### Compatibility Notes

- Nodes disabled in `prompt_order` remain inactive until enabled in `/config` > Plugins > SillyTavern Presets. Empty and comment-only nodes are never sent.
- Block order is literal: placing `chatHistory` ahead of `dialogueExamples` places chat history first in the prompt.
- Post-history injections merge into existing conversation history rather than sending as standalone messages.
- Regex post-processing, preset-defined sampling parameters (temperature, top-p), and layered presets are not supported. Legacy text-completion presets import with ST-only blocks dropped.

In `/help`, choose `Plugins`, then `SillyTavern Presets`, for the Discord guide. For internal
preset processing, see the
[preset-system architecture](/architecture/integrations/sillytavern/preset-system/).
