---
title: "Lorebooks"
aiGenerated: true
---

`src/modules/lorebooks/` owns authored lore storage, import mapping, and a pure activation function.
Persona cards and workspace memory backups carry lore separately from episodic memories. The module
has no panel or prompt integration yet.

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
future rendered headings are outside this budget. An entry that does not fit is skipped, allowing a
later smaller entry to fit. `charBudget` and `random` can be injected; random draws follow the
`Math.random` contract of values in [0, 1). Placement and identity conversion belong to the consumer.

## Source pointers

- `src/modules/lorebooks/db/types.ts`: row and input schemas, normalization, constants, and limits.
- `src/modules/lorebooks/db/repositories.ts`: repository signatures and failure result unions.
- `src/modules/lorebooks/runtime/activation.ts`: matching, selection, and budget.
- `src/modules/lorebooks/imports.ts`: legacy tag separation and memory mapping.
- `src/db/schema.sql`: table, scope index, and timestamp trigger.
- `tests/regression/db/lorebooks.regression.test.ts`: ownership, concurrent limits, and rollback.
- `tests/unit/modules/lorebooks.test.ts`: activation and input validation.

Related: [Database schema](/architecture/subsystems/database-schema/).
