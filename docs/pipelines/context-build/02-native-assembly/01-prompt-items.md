---
title: "02.1: Prompt Items"
---

The top of the context list — the LLM's identity framing.

**File:** `src/utils/text/context/templates.ts:94-197`

## Mission

Emit up to four `system`-role items that frame the LLM's identity for this
turn: the humanizer block (base behavioral rules), the persona prompt (the
persona's distinctive instructions), and the tomori-attributes block (the
personality bullets). Multi-persona turns can also add public attributes from
other personas triggered by the same message. For impersonation turns, emits a single
impersonated-user prompt instead.

## Input

Subset of `BuildContextParams` plus carried state — see signature in
`templates.ts:94-108`. Notable fields:

- `botName`, `tomoriAttributes`, `publicPersonaAttributes`, `personaPrompt`
- `tomoriConfig.system_prompt`, `tomoriConfig.personal_memories_enabled`
- `isUserImpersonation`, `impersonatedIdentityName`, `impersonatedUserPrompt`
- `suppressDefaultSystemPrompt` — set by the routing wrapper when a preset
  is active and `system_prompt` is empty (preset fully controls the prompt)
- `toolPromptMacroResolver`, `convertMentions` (shared helpers)

## Output

`Promise<StructuredContextItem[]>` — up to four items:

| Condition | Item | Metadata tag |
|---|---|---|
| Not impersonation, `system_prompt` present OR `!suppressDefaultSystemPrompt` | Humanizer (system prompt or `DEFAULT_SYSTEM_PROMPT`) | `SYSTEM_HUMANIZER_RULES` |
| Not impersonation, `personaPrompt` present | Persona prompt | `SYSTEM_PERSONA_PROMPT` |
| Impersonation, `impersonatedUserPrompt` present | Impersonated user prompt | `SYSTEM_HUMANIZER_RULES` |
| Not impersonation | `tomoriAttributes.join("\n")` | `SYSTEM_PERSONALITY` |
| Not impersonation and other triggered personas have public attributes | Owner-grouped public attributes | `SYSTEM_PUBLIC_PERSONA_ATTRIBUTES` |

All emitted items are `role: "system"`.

## Side effects

- **Tool-prompt macro expansion** — every emitted text passes through
  `toolPromptMacroResolver.expand(...)` so `{short_term_memory_tool}` etc.
  become provider-correct tool names.
- **Mention conversion** — every emitted text passes through
  `convertMentions(...)` for `<@id>` / `<#id>` / `{bot}` / `{user}`
  resolution. The `triggererName` argument is hardcoded to `"User"` here
  (the prompt items are persona-facing, not user-facing).
- **Owner-aware public attributes** — public attributes are converted one
  attribute at a time using the owning persona's name as `botName`, so `{bot}`
  never resolves to the active responder by accident.

## Invariants

After this stage runs:

- For non-impersonation turns with a non-empty `system_prompt` or attributes,
  at least one item is emitted.
- For impersonation turns, *only* the impersonated-user prompt is emitted
  (no persona prompt, no attributes, no humanizer fallback) — keeping the
  prompt strictly about the impersonated identity.
- When `suppressDefaultSystemPrompt` is true and `system_prompt` is empty,
  no humanizer item is emitted — the preset's reassembly is expected to
  provide the system framing.

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `DEFAULT_SYSTEM_PROMPT` constant | Internal — exported from `templates.ts` for callers that need to know what the fallback is, but not user-configurable directly. The `system_prompt` config column is the user-facing surface. |
| Tag emission (`SYSTEM_HUMANIZER_RULES`, `SYSTEM_PERSONA_PROMPT`, `SYSTEM_PERSONALITY`, `SYSTEM_PUBLIC_PERSONA_ATTRIBUTES`) | The tag scheme is the seam — preset reassembly relies on these tags to slot items into preset blocks. A plugin adding a new prompt-item kind would add a new `ContextItemTag` and document its slot ordering. |
| Impersonation prompt handling | Tightly coupled to chat pipeline's impersonation flow. A plugin adding a new "alternate identity" mode would extend here + chat pipeline stage 02. |

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `system_prompt` | Overrides `DEFAULT_SYSTEM_PROMPT` when present |
| `tomoriConfig` | `personal_memories_enabled` | Passed to `convertMentions` for blacklist/privacy behavior |
| `tomoriState` | `persona_prompt` | The persona's distinctive prompt |
| `tomoriState` | `attribute_list` | Personality bullets (joined with `\n`) |
| `ChatTurn` | `triggeredPersonaIds` | Limits public attribute exposure to the original matched persona set |

## Related docs

- Tool-prompt macros: covered in
  [native-assembly README](./README.md#shared-helpers-used-across-contributors).
- Mention conversion: covered in
  [native-assembly README](./README.md#shared-helpers-used-across-contributors).
- SillyTavern preset reassembly: → preset-routing stage
  [`01-preset-routing.md`](../01-preset-routing)
