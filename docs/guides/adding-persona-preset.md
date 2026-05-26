---
title: "Adding a Persona Preset"
---

This guide covers how to add a new official persona preset to TomoriBot's seed data.

## Steps

1. Add a preset row to `src/db/seed.sql` in the `persona_presets` table. Required fields:
   - `preset_lineage_id` — a stable UUID for this character. Reuse the same lineage ID across
     locale variants of the same character so sync treats them as one canonical identity.
   - Name, system prompt, and any default attributes.

2. Add an optional avatar path (stored under `src/db/img/`).
   - Avatar sync happens after Discord is ready — not during `seed.sql` — because main persona
     avatars require a Discord API update and alter avatars require storage.
   - Use a new file path for the first shipped avatar replacement that must reach older installs
     without hash metadata. After `avatar_source_hash` is recorded for an install, same-path
     image edits are detectable.

3. Validate via `/persona import` and verify persona cache behavior (cache should reflect the
   seeded values after import).

## Notes on Updating Existing Presets

When editing an existing official preset, update only the seeded row. Servers with an automatic
preset baseline receive the new canonical content on the next seed run for fields they have not
locally edited or removed. Appended local attributes, trigger words, and sample dialogues are
preserved across seed updates.

## Quality Gate

```bash
bun run check    # TypeScript strict mode
bun run lint     # Biome formatting
```

Then run a local seed against a dev database and verify the preset appears correctly under `/persona`.

## Related Docs

- [`docs/subsystems/persona-presets.md`](../subsystems/persona-presets) — preset lineage model, sync behavior, avatar sync timing
- [`docs/pipelines/memory/`](../pipelines/memory/) — how persona conditioning flows into context
