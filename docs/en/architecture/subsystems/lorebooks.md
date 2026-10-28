---
title: "Lorebooks"
aiGenerated: true
---

`src/modules/lorebooks/` owns authored lore storage, import mapping, the `/memories` Lorebooks panel,
a pure activation function, and the two prompt blocks that native assembly and preset routing place.
Persona cards and workspace memory backups carry lore separately from episodic memories.

## Storage and ownership

`persona_lorebook_entries` belongs to a server. A NULL `persona_lineage_id` means Serverwide; a
lineage id means Persona scope. Lineage has no foreign key because no table owns a unique lineage,
and lore must survive persona removal and re-import. Deleting the server cascades its lore.

`db/repositories.ts` is the only SQL owner. `loadEnabledForScope` loads enabled Serverwide and Persona
entries together; `listScope` reads exactly one scope, including disabled entries. Mutations require
the server, lineage (or NULL), and entry id together. An edit cannot move an entry between scopes.
Channel ids remain attached to the entry through edits and replacement. Callers resolve channels
against the owning Discord server before writing; the repository validates snowflake syntax.
Unresolved legacy channel names stay in `legacy_channel_scope_tags` under the lorebook entry id.
The shared startup backfill resolves them into channel ids. Until resolution, readers admit every
channel, matching the existing memory and document behavior. Reads and exports carry the pending
names as optional `legacy_channel_tags`; editing channels can clear them deliberately.

Writes validate through `db/types.ts`. A scope holds up to 250 entries. Insert and persona replacement
lock the server row before counting or deleting, so concurrent writes cannot exceed that limit.
Replacement validates the entire batch first and commits deletion and insertion in one transaction.
Oversized batches are rejected in full. An empty batch deliberately clears that lineage.

Runtime read failures return an empty list. Panel reads return `status: "unavailable"` on a database
or row-validation failure, so callers can distinguish failure from an empty scope. Counts return NULL
on failure and otherwise use a map keyed by lineage, with NULL for Serverwide. Write results
distinguish invalid input, a full scope, a missing entry, and a database failure where applicable.
Callers must inspect the result before showing success or replacing displayed state.

There is no cache: runtime retrieval uses one indexed query per turn. Add caching only if profiling
shows this query contributes to turn latency, with invalidation inside every successful repository write.

## Panel and permissions

`/memories` > `Lorebooks` uses the `memories` route namespace and `v1` wire version. The fourth
category shares the Documents scope switcher and the Memories lineage picker; because persona lore is
lineage-owned, its picker groups personas that share a lineage. Scope lineage `0` is the Serverwide
sentinel and every routed operation maps it back to a NULL lineage before calling the repository.

Every member can read either scope. Only `canManage` writes, and every routed write re-resolves the
scope, rejects a lineage that is not present on the server, and checks the permission again. A stale
route for a removed persona or deleted entry repaints a safe scope with a changed-state receipt
instead of writing. Modal opens are acknowledged by the modal itself; button and modal-submit writes
are deferred before the read, then repaint after the write or failure.

`discord/panelSection.ts` owns the tab body and its add, edit, activation, and import modals.
`discord/operations.ts` owns write authorization, field validation, and the preservation rule below.
Each entry select page holds 23 entries so the Add and Import options fit Discord's 25-option cap.

Edits keep activation fields and stored channel ids the member did not change. Unresolved legacy
channel names survive a content or activation edit when the submitted channel set matches the stored
one; changing the channel selection clears them deliberately. Before opening an edit modal, stored
channel ids are filtered to channels that still exist in the guild, so a deleted channel cannot make
Discord reject the modal. Channel submissions are filtered against the guild again: a syntactically
valid snowflake from another server is refused with a receipt and no write.

`imports/` accepts a SillyTavern world info file or a Character Book through one JSON carrier.
An import appends entries that are not already present, or replaces the scope when the member checks
the replace box. The append is one locked transaction, so a batch that would exceed 250 entries is
refused whole. Parsing is limited to 2 MB. Conversion reports skipped entries, unsupported keys,
ignored settings, and collapsed placement; the route logs the four counts and adds skipped entries to
the receipt's skipped total. No file content enters logs.

## Migration and rollback

Migration `123_lorebook_entries_from_tagged_memories.sql` moves only server memories with nonempty
cleaned keyword tags. Channel-only memories and all documents remain in their existing stores.
Personal memories and their tags are unchanged. Server memory writes no longer persist keyword tags;
the old column remains available for rollback.

Migrated entries keep their server, persona lineage, content, timestamps, channel ids, and legacy
channel markers. They scan five recent messages. When memory tagging was off, they become Always On
to preserve every-turn visibility. Keyword entries therefore scan fewer messages than the old
whole-history tag filter. The migration locks the source and destination tables and backs up every
original memory before deleting it, within one atomic block. A rerun skips recorded source ids.
Rows exceeding lorebook limits abort the entire block, so an operator must resolve those rows before
retrying. No entry or key is truncated to make a migration fit.

Stop the bot and run `bun run migrate:down 123` to preview rollback, then
`bun run migrate:down 123 --yes` to execute the matching `.down.sql`. Keep this checkout until the
command finishes, then switch to the rollback code before restarting, because startup reapplies
pending migrations. Rollback restores the migration-time snapshot,
including original memory ids, tags, attribution, timestamps, and channel markers. Edits to migrated
lore are discarded; deleting migrated lore does not prevent its original memory from returning.
Only migration-created lore entries are removed. Newly authored lore and other scopes remain.
Deleted users or personas become NULL attribution, and deleted servers are skipped. An occupied
original memory id aborts rollback before overwriting anything. Back up post-migration edits before
rolling back. Keep `lorebook_migration_123_backup` until rollback is no longer needed.

## Import and export

Persona exports carry optional `lorebook_entries` inputs without database ids. A present array
replaces the persona lineage's complete book, including hand-authored entries; an empty array clears
it. An absent array preserves existing lore. Replacement validates the complete batch before deleting
anything. A failed replacement keeps the previous book. Alter imports remove a newly created persona
if lore replacement fails. Lore survives normal persona removal through its lineage.

Workspace memory exports attach optional `lorebook_entries` to each mapped persona bucket and
`serverwide_lorebook_entries` to the bundle. The all-personas export includes lore-only and removed
persona lineages. Bucket mapping selects the destination lineage; Serverwide lore stays Serverwide.
Included books replace their entire scopes even with memory Merge. Absent books preserve existing
lore. Memories and books commit in one transaction, and failure leaves the import available to retry.
Legacy combined server exports use the same two arrays for the selected persona and Serverwide scope.

Older backups' keyword memories use the migration mapping, with the destination's memory-tagging
setting deciding Always On. Legacy `#channel` names stay channel markers and never count as keywords.
Converted entries are added without clearing an absent book and deduplicated on repeated imports.
Channel-only rows remain memories. Channel ids and pending names travel through workspace backups;
personal backup behavior stays unchanged.

## Activation contract

`runtime/activation.ts` accepts loaded rows, message text ordered oldest to newest, and the active
server, lineage, channel, optional parent channel, and channel-scoping switch. It returns admitted
rows in insertion order, breaking ties by entry id, without mutating the inputs. Both placements
share one budget; the returned rows retain `placement` 0 (before) or 1 (after) for a context consumer.

Enabled, server, lineage, and channel gates apply even to `constant` entries. Channel matching uses
the shared `channelScopeCandidates` and `channelScopeAdmits` helpers, including thread inheritance.
Turning channel scoping off bypasses only the channel gate. Constants bypass keys, secondary logic,
and chance. Keyword entries scan only their last `scan_depth` messages, normalize keys and text with
NFKC and lowercase, and apply secondary logic before rolling chance.

Latin, Cyrillic, Greek, and numeric keys require Unicode word boundaries; other keys use substring
matching. Combining marks and supplementary-plane letters count as word characters. Regex keys
remain inert because card keys are untrusted; supporting them requires a ReDoS-safe engine.

The default content budget is 8,000 JavaScript string characters across both placements. Titles and
rendered headings are outside this budget. An entry that does not fit is skipped, allowing a later
smaller entry to fit. `charBudget` and `random` can be injected; random draws follow the `Math.random`
contract of values in [0, 1). The caller groups the returned rows by `placement` and converts identity
macros.

## Prompt integration

`runtime/contextItems.ts` performs one `loadEnabledForScope` read per turn and passes the rows to the
same activation function. It emits at most two `system` blocks, tagged `KNOWLEDGE_LOREBOOK_BEFORE` and
`KNOWLEDGE_LOREBOOK_AFTER`, in that order. Each block opens with `## World Info` and gives every entry
a `###` heading. The shared budget covers both blocks. No cache sits between the query and the blocks.

Content passes through `convertMentions`, so `{{user}}`, `{{char}}`, and `{{bot}}` resolve to the
current names the same way stored memories do. Other macros and conditional blocks stay literal, and
random-choice resolution skips these blocks for the same reason.

Native assembly appends the blocks after server documents and before conditioning, sample dialogues,
and dialogue history. They sit outside the stable persona prefix because their content changes
whenever an entry activates. Channel scope follows `channel_memory_enabled`; while that switch is on,
an Always On entry still needs an admitted channel or parent channel.

Preset reassembly maps `worldInfoBefore` to the before block followed by documents, and
`worldInfoAfter` to the after block followed by documents. Documents are consumed at the first
world-info marker whatever its order, as before. With neither marker, the before block, documents, and
the after block flush before the first dialogue anchor, so lore still precedes chat history. A preset
with only one marker flushes the unclaimed block the same way.

Prompt inspection counts both blocks in the `memory` segment and labels them `Lorebook (Before)` and
`Lorebook (After)` with the `/memories` hint.

## Source pointers

- `src/modules/lorebooks/db/types.ts`: row and input schemas, normalization, constants, and limits.
- `src/modules/lorebooks/db/repositories.ts`: repository signatures, append and replace writes, and
  failure result unions.
- `src/modules/lorebooks/runtime/activation.ts`: matching, selection, and budget.
- `src/modules/lorebooks/runtime/contextItems.ts`: runtime read, the two prompt blocks, and identity
  conversion.
- `src/modules/lorebooks/imports/`: card, world info, and upload conversion plus legacy tag mapping.
- `src/modules/lorebooks/discord/panelSection.ts`: the Lorebooks tab and its four modals.
- `src/modules/lorebooks/discord/operations.ts`: write authorization, validation, and pending scope
  preservation.
- `src/utils/discord/memoriesPanelCatalog.ts`: the `lore-*` route actions and field encoding.
- `src/db/schema.sql`: table, scope index, and timestamp trigger.
- `tests/regression/db/lorebooks.regression.test.ts`: ownership, concurrent limits, append, and
  rollback.
- `tests/unit/modules/lorebooks.test.ts`: activation and input validation.
- `tests/unit/context/lorebookContextItems.test.ts`: activation through import conversion to the final
  preset context, prompt accounting, and identity and macro boundaries.
- `tests/unit/context/nativeLorebookPlacement.test.ts`: native order of documents, lore, and history.
- `tests/unit/context/presetContextBuilder.test.ts`: marker routing, marker order, and missing-marker
  flushes.
- `tests/unit/modules/lorebookUploads.test.ts`: world info and Character Book conversion.

Related: [Database schema](/architecture/subsystems/database-schema/).
