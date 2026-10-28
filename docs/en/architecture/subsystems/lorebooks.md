---
title: "Lorebooks"
aiGenerated: true
---

`src/modules/lorebooks/` owns authored lore storage and a pure activation function. The module has no
panel, import path, or prompt integration yet. Server and personal memories keep their existing behavior.

## Storage and ownership

`persona_lorebook_entries` belongs to a server. A NULL `persona_lineage_id` means Serverwide; a
lineage id means Persona scope. Lineage has no foreign key because no table owns a unique lineage,
and lore must survive persona removal and re-import. Deleting the server cascades its lore.

`db/repositories.ts` is the only SQL owner. `loadEnabledForScope` loads enabled Serverwide and Persona
entries together; `listScope` reads exactly one scope, including disabled entries. Mutations require
the server, lineage (or NULL), and entry id together. An edit cannot move an entry between scopes.
Channel ids remain attached to the entry through edits and replacement. Callers resolve channels
against the owning Discord server before writing; the repository validates snowflake syntax.

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
- `src/db/schema.sql`: table, scope index, and timestamp trigger.
- `tests/regression/db/lorebooks.regression.test.ts`: ownership, concurrent limits, and rollback.
- `tests/unit/modules/lorebooks.test.ts`: activation and input validation.

Related: [Database schema](/architecture/subsystems/database-schema/).
