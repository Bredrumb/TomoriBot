---
title: "02.10: Sample Dialogues"
---

Few-shot example dialogues to anchor the LLM's voice.

**File:** `src/utils/text/context/templates.ts:199-278`

## Mission

Emit paired user/model context items from the persona's
`sample_dialogues_in` and `sample_dialogues_out` arrays. These act as
few-shot examples — the LLM sees `${user}: question` followed by
`${botName}: answer`, primes its persona voice. Skipped on impersonation
(samples are persona-flavored output examples) and when arrays are empty
or mismatched in length.

## Input

- `client`, `guildId`
- `triggererName`, `botName`
- `tomoriState` (provides `sample_dialogues_in`, `sample_dialogues_out`)
- `tomoriConfig.humanizer_degree`,
  `tomoriConfig.personal_memories_enabled`
- `isUserImpersonation`
- `uncensorInputOptions: { unicodeSpacesEnabled, sanitizeEnabled }`
- `convertMentions`

## Output

`Promise<StructuredContextItem[]>` — up to `2 × sample_dialogues_in.length`
items (one user + one model per pair, or just model if the user side is
`UNPAIRED_SAMPLE_DIALOGUE_SENTINEL`). Each tagged `DIALOGUE_SAMPLE`.

## Side effects

- **Humanizer transform** — when `humanizer_degree >= HumanizerDegree.HEAVY`,
  both user and model sample text passes through `humanizeString` (typo
  injection, casing tweaks). Mirrors the dialogue-history transform
  (stage 11).
- **Uncensor input transforms** — `applyUncensorInputTransforms` applies
  unicode-space injection and/or sanitization based on
  `uncensorInputOptions`.
- **Mention conversion** — every sample passes through `convertMentions`.
- **Model sample prefix** — `${botName}: ${output}` prefix is prepended
  to the model side so the LLM learns to emit the bot-name prefix in its
  responses.

## Invariants

After this stage runs:

- Returns `[]` if: impersonation, no `tomoriState`, empty arrays, or
  mismatched lengths between in/out.
- `UNPAIRED_SAMPLE_DIALOGUE_SENTINEL` on the user side skips the user
  item but still emits the model item (for "responses without a clear
  prompt" examples).
- Items are tagged `DIALOGUE_SAMPLE` so preset reassembly slots them
  before the real dialogue history (after which the LLM should "pivot"
  from sample voice to live conversation).

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriState` | `sample_dialogues_in`, `sample_dialogues_out` | The actual sample arrays |
| `tomoriConfig` | `humanizer_degree` | When HEAVY, applies humanizer to samples |
| `tomoriConfig` | `uncensor_unicode_space_enabled`, `uncensor_sanitize_enabled` | (Set upstream in `nativeBuilder`) Drives uncensor input transforms |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `UNPAIRED_SAMPLE_DIALOGUE_SENTINEL` | Defined in `src/types/preset/presetExport.ts`; coupled to SillyTavern preset import. |
| Bot-name prefix on model samples | Hardcoded `${botName}: ` — a plugin adding "no-prefix mode" would extend here. → plugin plan candidate. |
| Humanizer + uncensor integration | Inherited from chat pipeline config; if a plugin adds new sample-transform passes (e.g. style transfer), it would extend the per-item transform sequence here. |

**This is the simplest contributor in the pipeline** — it's a pure
formatter over two arrays. Most plugin-relevant work happens *upstream* in
how `sample_dialogues_in/out` get populated (via persona editor, import,
ST card conversion).

## Related docs

- Persona sample editing: → no dedicated doc; persona configuration
  command surface only
- Humanizer system: → folded into `dialogueHistory` (stage 11);
  `humanizeString` helper in `src/utils/text/processors/formatters.ts`
- Uncensor system: → no dedicated doc;
  `src/utils/text/uncensor.ts` helper only
- ST preset sample-dialogue handling:
  [`docs/en/architecture/integrations/sillytavern/preset-system.md`](../../../integrations/sillytavern/preset-system)
