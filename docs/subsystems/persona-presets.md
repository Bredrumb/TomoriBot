# Persona Presets

Official persona presets are seeded from `src/db/seed.sql` into `persona_presets`. They are the canonical definitions for bundled characters such as Tomori/Rose, Temari, Aphel, Lilya, and Nerine.

This page covers the sync behavior for servers that already use those presets.

## Data Model

### `persona_presets`

Official preset rows carry a stable `preset_lineage_id`.

- Reuse the same `preset_lineage_id` across locale variants of the same character.
- Do not change a character's `preset_lineage_id` just because text, triggers, sample dialogue, or avatar art changed.
- New official characters need a new stable `preset_lineage_id`.

`preset_lineage_id` is related to, but not the same operational concern as, `personas.persona_lineage_id`:

- `preset_lineage_id` identifies the official preset family for sync.
- `persona_lineage_id` scopes memory/conditioning identity.
- New official preset applications use the preset lineage when creating or replacing that persona.
- Legacy bootstrapping does not rewrite existing `persona_lineage_id`, because that would move memory scope.

### `persona_preset_sync_state`

`persona_preset_sync_state` records the official preset baseline for a persona.

Key columns:

- `persona_id`: the persona being synced.
- `preset_lineage_id` + `preset_language`: which official preset row to mirror.
- `sync_mode`: content sync mode. `auto` means seed updates may rebase preset text fields.
- `base_snapshot`: previous official text baseline used to detect local edits, including `attribute_public_flags`.
- `avatar_sync_mode`: avatar-only sync mode. `auto` mirrors official avatar updates; `manual` preserves a server's explicit avatar override.
- `avatar_source_path`: preset avatar path last used as baseline.
- `avatar_source_hash`: SHA-256 hash of the preset avatar image last applied or initialized.
- `avatar_synced_at`: last successful automated avatar sync time.

Content and avatar sync modes are intentionally separate, so a server can keep receiving text preset updates while preserving a custom avatar.

## Applying Presets

### `/config setup`

Setup creates the main persona from the selected official preset, records `persona_preset_sync_state`, and applies the preset avatar to the bot's Discord guild avatar when running in a guild.

Main persona avatars are not stored as a copied DB asset during setup. Discord stores the guild avatar after TomoriBot patches the guild member avatar.

### `/persona default`

For the main/default target, `/persona default` replaces the main persona's official preset-backed fields, records a fresh sync baseline, and patches the bot's Discord guild avatar.

For `type=alter`, `/persona default` creates an alter persona, records a sync baseline, uploads a copy of the preset avatar through avatar storage, and stores the resulting reference in `personas.webhook_avatar_url`.

### Import/export cards

Native Tomori preset exports include `attribute_public_flags`, aligned 1:1 with `attribute_list`. Older Tomori preset files that do not have this field remain valid; import normalizes them to all-private flags before writing `persona_attributes`.

`/persona generate` emits the canonical six generated attributes and marks only the generated Appearance attribute public. `/persona create` emits an explicit all-private flag array because its single freeform description is not guaranteed to be an appearance-only field. SillyTavern card conversion also defaults converted attributes to private because ST cards do not carry Tomori public visibility metadata.

## Text Sync

Text sync runs as part of `seed.sql`.

Before upserting current seed rows, `seed.sql` snapshots the previous `persona_presets` rows into a temporary table. This lets one deploy both change the seed content and migrate existing users from the old baseline.

The seed then bootstraps sync state for clear legacy matches by:

- matching `persona_lineage_id` to `preset_lineage_id`;
- matching current persona content to the old or new official preset;
- using locale preference to choose between localized variants.

For personas in `sync_mode = 'auto'`, seed rebases these fields:

- `personas.attribute_list`
- `persona_attributes.attribute_text`
- `persona_attributes.is_public`
- `personas.sample_dialogues_in`
- `personas.sample_dialogues_out`
- `persona_configs.trigger_words`
- `persona_configs.persona_prompt`

Array fields preserve append-only local additions. If a server's current value still starts with the previous official baseline, TomoriBot replaces that prefix with the new official baseline and keeps the local tail. Attribute visibility flags follow the same split: official prefix flags come from the new preset, while locally appended attributes keep their current visibility.

Edits/removals are preserved. If a field no longer matches the old baseline prefix, that field is left unchanged.

Official Tomori presets mark their first appearance-style attribute public. Public attributes can be shown to other personas triggered by the same message; all other seeded attributes remain private unless edited.

## Avatar Sync

Avatar sync cannot happen in `seed.sql`, because it needs Discord API calls for main personas and avatar storage uploads for alters. It runs after Discord `clientReady`.

The startup sync job:

1. Loads personas with `sync_mode = 'auto'` and `avatar_sync_mode = 'auto'`.
2. Joins them to the current official preset by `preset_lineage_id + preset_language`.
3. Reads the preset avatar file and computes its SHA-256 hash.
4. Compares current `preset_avatar_path`/hash with the stored avatar baseline.
5. Applies the avatar if the path or known hash changed.

Main persona sync patches the bot's guild avatar through Discord's guild-member avatar API.

Alter persona sync uploads a fresh copied avatar to storage, updates `personas.webhook_avatar_url`, invalidates the persona cache, and deletes the old stored avatar reference when possible.

DM pseudo-servers do not have a Discord guild avatar to patch. The sync job records or updates avatar baseline metadata without trying a guild avatar update.

## Manual Avatar Overrides

User-driven avatar changes mark only avatar sync as manual:

- `/server avatar` for main or alter personas sets `avatar_sync_mode = 'manual'`.
- Persona imports for the main persona also set `avatar_sync_mode = 'manual'`.

This does not disable text preset sync. A server can customize the avatar and still receive official text changes.

## Editing Official Presets

For text-only changes, edit the official row in `src/db/seed.sql`. Existing servers in `sync_mode = 'auto'` receive the change on the next seed run for fields that still match the old baseline or only have appended additions.

For avatar changes:

- Prefer adding a new image file under `src/db/img/` and updating `preset_avatar_path` for the first avatar rollout after this sync system ships.
- After `avatar_source_hash` has been recorded for existing installs, same-path image edits are detectable.
- If an install has no prior avatar hash and the file path does not change, TomoriBot can only initialize the baseline; it cannot prove that the image changed.

The runtime knobs are:

- `PRESET_AVATAR_SYNC_ENABLED`: default `true`; operational kill switch.
- `PRESET_AVATAR_SYNC_DELAY_MS`: delay between guild avatar updates to reduce Discord rate-limit risk.
- `PRESET_AVATAR_SYNC_API_TIMEOUT_MS`: timeout for each Discord avatar PATCH.
- `PRESET_AVATAR_SYNC_MAX_PER_RUN`: maximum avatar baselines to evaluate per startup, `0` for unlimited.
