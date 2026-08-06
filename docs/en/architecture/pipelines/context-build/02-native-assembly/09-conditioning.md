---
title: "02.9: Conditioning"
---

Reward/punish reinforcement memory — what the bot has been thanked for and
what it has been corrected on.

**File:** `src/utils/text/context/templates.ts:280-352`

## Mission

When reward and/or punish conditioning is enabled for the persona, load
recent grouped conditioning entries from `conditioningMemoryRepository` and
emit them as a `system`-role context item describing past
behaviors — "do this again" vs. "avoid this." Each line names the action,
the users who triggered the conditioning, the reason text, and a count
suffix when repeated.

## Input

- `client`, `guildId`
- `serverId: number` — the internal server primary key (not the Discord ID)
- `personaLineageId: number` — must be ≥ 0
- `botName`
- `personalMemoriesEnabled` (passed to `convertMentions`)
- `rewardEnabled: boolean`, `punishEnabled: boolean`
- `convertMentions`

## Output

`Promise<StructuredContextItem | null>` — `null` if neither
reward nor punish has any visible groups. Otherwise one `system`-role item
tagged `KNOWLEDGE_SERVER_CONDITIONING`.

Content shape:

```
## Rewarded Behaviors
Here are past things {botName} did that got rewarded for. Strive to do them again:
- [{botName} was thanked by <@111>, <@222>. Reason: `helpful with debugging`] (3 times)
- [{botName} was praised by <@333>. Reason: `kept the joke going` with `said something punny`]

## Punished Behaviors
Here are past things {botName} did that got punished for. Avoid doing them again:
- [{botName} was corrected by <@444>. Reason: `gave wrong info about pricing`]
```

## Side effects

- **DB read (per type)** —
  `conditioningMemoryRepository.loadGroupsForPersona(serverId, personaLineageId, type)`
  for `"reward"` and/or `"punish"`.
- **Past-participle resolution** — `getConditioningContextPastParticiple(type, actionKey)`
  resolves the verb form ("thanked," "corrected," etc.) for each action
  kind.
- **Mention conversion** — assembled text passes through `convertMentions`;
  user mentions are rendered with display names.

## Invariants

After this stage runs:

- Returns `null` if both reward and punish are disabled, or if both
  produce zero visible groups.
- Each enabled type contributes at most
  `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` groups (see
  `src/utils/conditioning/conditioning.ts`).
- Groups with empty `reasonText` are filtered out (no information value).
- Skipped *upstream* in `nativeBuilder.ts` when: `isUserImpersonation` is
  true, `tomoriState.persona_lineage_id < 0`, or neither
  `reward_conditioning_enabled` nor `punish_conditioning_enabled` is set.

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriState` | `reward_conditioning_enabled` | Show "Rewarded Behaviors" section |
| `tomoriState` | `punish_conditioning_enabled` | Show "Punished Behaviors" section |
| `tomoriState` | `persona_lineage_id` | Scopes groups to this lineage |
| Constant | `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | Per-type cap |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| Action verb table (`getConditioningContextPastParticiple`) | Localized via the conditioning helper; a plugin adding a new action kind extends the verb map there. |
| `conditioningMemoryRepository` | The repository is the seam — a plugin adding a new reinforcement-type (e.g. neutral observations) would extend it. |
| Grouping algorithm | Currently groups by `actionKey + userDiscIds` + optional `actionText`; the grouping logic lives in the repository, not this contributor. |
| Section heading text | Hardcoded English here; localization would extend. → plugin plan candidate if locale-aware conditioning is needed. |

This contributor is a **conditioning-specific instance of the "memory
type" plugin category** (alongside stages 03 and 07). A plugin replacing or
extending it would do so via the memory-type registration mechanism (when
that exists).

## Related docs

- Conditioning system: → no dedicated doc;
  `src/utils/conditioning/conditioning.ts` helper only
- Conditioning tools (reward/punish actions): tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- Server memories (parallel): [`03-server-memories.md`](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/)
