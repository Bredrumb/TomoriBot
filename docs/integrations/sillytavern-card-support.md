<!-- ARCH-ALIGNMENT: prereq-phase-5.5a -->

# 21. SillyTavern Card Import Support

This document describes how `/persona import` handles SillyTavern character cards from either:

- PNG files with embedded `chara` / `char` metadata
- legacy v2-style root-level JSON cards
- `chara_card_v3`-style JSON exports

## Overview

TomoriBot now supports three relevant import paths:

1. **Native Tomori preset path** (`TomoriPreset` metadata)  
2. **SillyTavern PNG fallback path** (`chara`/`char` metadata)
3. **SillyTavern JSON fallback path**:
   - legacy v2-style cards with root-level fields such as `name`, `description`, and `first_mes`
   - v3 cards with `spec: "chara_card_v3"` and a nested `data` object

If Tomori metadata is missing, or the uploaded file is a compatible SillyTavern v2/v3 JSON card, import proceeds through the same SillyTavern conversion flow.

## Metadata Detection

PNG extraction supports text chunk variants:

- `tEXt`
- `zTXt`
- `iTXt`

Detected PNG metadata keys:

- `chara`
- `char`

Decoded PNG payloads can be:

- direct JSON text, or
- base64-encoded JSON text

## Conversion Flow

Converter: `src/utils/db/sillyTavernImport.ts`

Input:

- decoded SillyTavern PNG metadata JSON, or
- parsed SillyTavern JSON file

Output:

- `PresetExportData` compatible with Tomori import pipeline

Validation:

- Tomori and converted SillyTavern imports both pass through the preset Zod schema before insert.
- The schema is the import safety boundary. Defaults are 5000 characters per imported string, 200 attributes, 200
  NovelAI tags, 100 sample dialogue entries per side, and 100 trigger words.
- Admins can tune those defaults with the `PRESET_MAX_*` env vars in `.env.optional.example`.
- Runtime memory environment limits such as `MAX_ATTRIBUTE_LENGTH` and `MAX_SAMPLE_DIALOGUE_LENGTH` apply to live
  slash-command edits, not preset imports.

Name handling:

- character name first letter is capitalized (e.g. `isaac` -> `Isaac`)

## Field Mapping

Imported into `personas` and `persona_configs`:

- `name` -> `persona_nickname`
- `description` -> `attribute_list` (no `"Description"` prefix)
- `personality` -> `attribute_list` (section-labeled)
- `scenario` -> `attribute_list` (section-labeled)
- `system_prompt` -> `attribute_list` (section-labeled)
- `post_history_instructions` -> `attribute_list` (section-labeled)
- `extensions.depth_prompt.prompt` -> `attribute_list` (section-labeled)
- `character_book.entries[].content` (enabled only) -> `attribute_list` (section-labeled)
- `mes_example`, `first_mes`, `alternate_greetings` -> sample dialogues
- generated default trigger words (from character name) -> `trigger_words`

Not imported:

- `creator_notes`
- `creatorcomment`
- `tags`
- `creator`
- `spec` / `spec_version`

## Unpaired Sample Dialogue Handling

Many SillyTavern cards contain bot-only examples without a user turn.

Tomori stores paired arrays, so unpaired entries use an internal sentinel value:

- `__TOMORI_UNPAIRED_SAMPLE__`

Behavior at runtime (`src/utils/text/contextBuilder.ts`):

1. If input side is sentinel, Tomori **does not inject** a user sample turn.
2. It still injects the model sample response.
3. If any unpaired sample exists, Tomori inserts a spacer message before live conversation history:

`[System: Above are only examples of how {{char}} acts and talks. Use them as reference for a completely new scene that starts now.]`

## Placeholder Support

Tomori now supports both styles during template replacement:

- Single-brace: `{user}`, `{bot}`, `{char}`
- Double-brace: `{{user}}`, `{{char}}`, `{{bot}}`

So SillyTavern placeholders can be kept as-is.

## Failure / Debug Fallback

If SillyTavern card data is detected but conversion fails:

- `/persona import` returns an ephemeral warning embed
- attaches the decoded / parsed payload as `.txt` for inspection

## Avatar Fallback for JSON Cards

SillyTavern JSON cards typically do not include an avatar image attachment.

For `type: alter` imports without an avatar image:

- Tomori stores the current main persona avatar as the new alter's `webhook_avatar_url` fallback
- the public success embed explicitly says the fallback happened and why
- the embed also points users to `/server avatar` if they want to change it

For `type: main` imports without an avatar image:

- personality data is still imported normally
- nickname updates still run
- avatar changes are skipped and the current main persona avatar remains in place

This preserves the debug workflow for unsupported edge-card formats.

## Relevant Files

- `src/commands/persona/import.ts`
- `src/utils/image/pngMetadata.ts`
- `src/utils/db/sillyTavernImport.ts`
- `src/utils/text/contextBuilder.ts`
- `src/utils/text/processors/mentionProcessor.ts`
- `src/types/preset/presetExport.ts`
