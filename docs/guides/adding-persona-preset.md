---
title: "Adding a Persona Preset"
---

This guide covers how to add a new official persona preset to TomoriBot's seed data.

## Steps

1. Add a preset row to `src/db/seed/02_personas.sql` in the `persona_presets` table. Required fields:
   - `preset_lineage_id` — a stable identity anchor for this character. Reuse the same lineage ID
     across locale variants of the same character so they are treated as one canonical identity,
     and so applying the preset can stamp a consistent `persona_lineage_id` (memory scope) onto
     the persona.
   - Name, system prompt, and any default attributes.
   - `preset_attribute_public_flags` — boolean visibility flags aligned 1:1 with
     `preset_attribute_list`. The bundled Tomori rows derive these in the post-insert
     `official_attribute_flags` block; update that block if a new official preset needs
     public attributes. Pointer personas resolve these from the live preset row, and
     materialized copies store them in `persona_attributes.is_public`.

2. Add an optional avatar path (stored under `src/db/img/`). Preset application applies the avatar
   once to the guild (main persona) or uploads it to storage (alter) through `/config setup`,
   `/persona default`, and preset import without forking the pointer. Runtime pointer reads do not
   sync avatars from `preset_avatar_path`: existing personas keep their Discord guild avatar or
   stored `webhook_avatar_url` until the preset is applied again. Later `/server avatar` edits are
   treated as deliberate customization and materialize the persona before changing or resetting its
   avatar.

3. Validate via `/config setup`, `/persona default`, `/persona export`, and `/persona import`.
   Pointer personas should resolve the seeded values, reflect later seed edits after cache
   invalidation, and materialize on the first local content edit.

## Applying vs. Syncing

Applying an official preset is a **copy-on-write pointer** when the preset has
`preset_lineage_id`: setup/`/persona default` store `personas.is_pointer = true` plus
`preset_lineage_id`/`preset_language`, and runtime reads resolve preset-backed text/config content
from the live `persona_presets` row.

Avatars are not part of that live sync. `preset_avatar_path` is a source image for application time:
main personas are patched into Discord guild-member avatar state, while alter personas store an
uploaded avatar reference in `webhook_avatar_url`. Changing the seed avatar affects future
applications, not already-applied pointer personas.

The first local content edit materializes that persona into an independent copy while preserving
`persona_id` and `persona_lineage_id`. Memory/runtime writes do not materialize. Re-running
`/persona default` re-establishes the pointer and discards local preset-backed changes.

Native exports of pointer personas are self-contained copies that stamp `preset_lineage_id`.
Import re-links to an official pointer only when the exported content exactly matches a seeded
preset with the same lineage; customized files import as independent copies.

## Quality Gate

```bash
bun run check    # TypeScript strict mode
bun run lint     # Biome formatting
```

Then run a local seed against a dev database and verify the preset appears correctly under `/persona`.

## Related Docs

- [`docs/subsystems/persona-presets.md`](../subsystems/persona-presets) — preset identity and pointer behavior
- [`docs/pipelines/memory/`](../pipelines/memory/) — how persona conditioning flows into context
