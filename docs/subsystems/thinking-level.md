---
title: "Thinking Level"
---

This page describes how TomoriBot's provider-scoped `thinking_level` preference works today.

Use this page to verify:

- the default
- what each level means
- how Tomori maps the general levels to provider-specific request fields
- which providers currently ignore the setting

## Scope

`thinking_level` is a **provider-scoped saved preference** controlled by:

- `/config samplers thinking_level:<value>`
- `/config samplers provider:<saved-provider> thinking_level:<value>`

Current values:

- `auto`
- `none`
- `low`
- `medium`
- `high`

Default:

- `auto`

Storage:

- `saved_provider_configs.thinking_level`
- `server_model_configs.thinking_level` (deprecated Phase 1.5 mirror; drop scheduled for step #14.5)

That means the active value is:

- visible in `/tool status`
- reflected in `/tool prompt snapshot`
- preserved in provider snapshots and restored by `/config provider switch`

## Important Rule

`thinking_level` is a **provider-agnostic preference**, not a guaranteed vendor feature.

Tomori only applies it when the active provider/model exposes a verified request-side reasoning or thinking control.

If a provider/model does not support a stable request-side control in Tomori, the setting is ignored for that request.

## Shared Semantics

These are the meanings Tomori uses before mapping to vendor-specific fields:

| Level | Meaning |
| --- | --- |
| `auto` | Let the provider/model use its default or automatic behavior. |
| `none` | Disable thinking if possible, otherwise use the provider's lowest safe setting. |
| `low` | Ask for light reasoning effort. |
| `medium` | Ask for balanced reasoning effort. |
| `high` | Ask for the strongest available reasoning effort. |

## Current-Turn Override

Tomori already has a per-turn `forceReason` flag used by some flows.

Current implementation rule:

- if `forceReason = true` and stored `thinking_level` is `auto` or `none`, Tomori upgrades the effective level for that request to `high`
- this does **not** rewrite the stored config

## Numeric Budget Defaults

When a provider accepts a numeric reasoning budget, Tomori maps `low` / `medium` / `high` using these env vars:

- `THINKING_LEVEL_BUDGET_LOW_TOKENS=1024`
- `THINKING_LEVEL_BUDGET_MEDIUM_TOKENS=4096`
- `THINKING_LEVEL_BUDGET_HIGH_TOKENS=8192`

These are Tomori defaults, not vendor defaults.

## Provider Mapping

This section describes the mapping implemented in `src/utils/provider/thinkingControl.ts`.

### Google / Vertex / Vertex Express

Tomori splits Gemini behavior by model family:

- Gemini 2.5 family: uses numeric `thinking_budget`
- Gemini 3 / 3.1 family: uses enum-like `thinking_level`

Tomori behavior:

| Model family | `auto` | `none` | `low` / `medium` / `high` |
| --- | --- | --- | --- |
| Gemini 2.5 | `thinkingBudget: -1` | Flash/Flash-Lite: `0`; Pro: `128` | uses env budget defaults, clamped to vendor minimums |
| Gemini 3 / 3.1 | omit thinking config | Flash: `MINIMAL`; Pro: `LOW` | `LOW` / `MEDIUM` / `HIGH` |

Important implementation notes:

- Gemini 2.5 Pro cannot be fully disabled, so Tomori maps `none` to the minimum safe budget instead of pretending it can turn thinking off.
- Gemini 2.5 Flash-Lite has a higher positive minimum than Flash, so Tomori clamps upward when needed.
- Gemini 3 Pro does not get a true disable path in Tomori; `none` becomes the lowest supported level.

### Anthropic

Tomori uses adaptive thinking for supported Claude 4.6 / 4.7 models.

Currently mapped:

- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-opus-4-7`

Tomori behavior:

| Level | Anthropic request |
| --- | --- |
| `auto` | `thinking: { type: "adaptive" }` |
| `none` | `thinking: { type: "disabled" }` |
| `low` | `thinking: { type: "adaptive" }` + `output_config: { effort: "low" }` |
| `medium` | `thinking: { type: "adaptive" }` + `output_config: { effort: "medium" }` |
| `high` | `thinking: { type: "adaptive" }` + `output_config: { effort: "high" }` |

Additional behavior:

- when adaptive thinking is active, Tomori omits sampling params that Anthropic rejects in that mode
- unsupported Anthropic models currently ignore `thinking_level`

### OpenRouter

Tomori maps `thinking_level` to OpenRouter's reasoning-effort control.

Tomori behavior:

| Level | OpenRouter request |
| --- | --- |
| `auto` | omit `reasoning` |
| `none` | `reasoning: { effort: "none" }` |
| `low` | `reasoning: { effort: "low" }` |
| `medium` | `reasoning: { effort: "medium" }` |
| `high` | `reasoning: { effort: "high" }` |

Tomori does not currently send numeric reasoning budgets through OpenRouter.

### DeepSeek

Tomori treats the two DeepSeek chat model modes differently:

- `deepseek-chat`: optional request-side thinking enable
- `deepseek-reasoner`: reasoning model by identity

Tomori behavior:

| Model | `auto` / `none` | `low` / `medium` / `high` |
| --- | --- | --- |
| `deepseek-chat` | omit thinking flag | `thinking: { type: "enabled" }` |
| `deepseek-reasoner` | no extra toggle; model stays reasoning-oriented | no extra toggle; model stays reasoning-oriented |

Additional behavior:

- when DeepSeek thinking is active, Tomori removes incompatible sampling fields
- Tomori does not currently expose a numeric DeepSeek reasoning budget because no verified stable budget field is wired here

### Z.ai / Z.ai Coding

Tomori maps `thinking_level` to Z.ai's documented thinking enable/disable flag.

Tomori behavior:

| Level | Z.ai request |
| --- | --- |
| `auto` | omit `thinking` |
| `none` | `thinking: { type: "disabled" }` |
| `low` / `medium` / `high` | `thinking: { type: "enabled" }` |

Additional behavior:

- when Z.ai thinking is active, Tomori removes `temperature`, `top_p`, `frequency_penalty`, and `presence_penalty`
- Tomori does not currently send a numeric Z.ai thinking budget

### Custom Endpoint

Tomori only auto-maps `thinking_level` for **Ollama-style OpenAI endpoints** in the custom provider path.

Detection heuristic:

- endpoint hostname contains `ollama`, or
- endpoint port is `11434`

Tomori behavior for detected Ollama endpoints:

| Level | Custom request |
| --- | --- |
| `auto` | omit `reasoning_effort` |
| `none` | `reasoning_effort: "none"` |
| `low` | `reasoning_effort: "low"` |
| `medium` | `reasoning_effort: "medium"` |
| `high` | `reasoning_effort: "high"` |

### NovelAI GLM

Tomori maps `thinking_level` to the GLM prompt directive:

| Level | Prompt directive |
| --- | --- |
| `auto` | follow `NAI_GLM_THINKING_ENABLED` env behavior |
| `none` | `/nothink` |
| `low` / `medium` / `high` | `<think></think>` |

This is a prompt-format control, not a numeric reasoning budget.

## Currently Not Auto-Mapped

Tomori intentionally does **not** auto-send a generic request-side thinking control for:

- KoboldCpp
- llama.cpp
- generic vLLM custom endpoints

Reason:

- Tomori did not wire a stable universal request parameter for those backends
- their reasoning controls are often backend-template-specific, startup-flag-driven, or GUI-configured instead of safely generic at the request body level

So the current implementation is conservative: no invented payload fields.

## Future Provider Requirement

When adding a new provider, the implementation should now explicitly decide one of these:

1. map `thinking_level` to the vendor's verified request-side reasoning control
2. intentionally no-op and document why the provider does not use it

Do not silently ignore the feature without documenting the decision.

See also:

- [`../guides/adding-new-provider.md`](../guides/adding-new-provider)

## Official Source Links

These are the vendor docs used for the current mapping:

- Google / Vertex / Vertex Express thinking: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking>
- Anthropic adaptive thinking: <https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking>
- Anthropic effort: <https://platform.claude.com/docs/en/build-with-claude/effort>
- Anthropic extended thinking: <https://platform.claude.com/docs/en/build-with-claude/extended-thinking>
- OpenRouter reasoning tokens: <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>
- DeepSeek thinking mode: <https://api-docs.deepseek.com/guides/thinking_mode>
- Z.ai thinking mode: <https://docs.z.ai/guides/capabilities/thinking-mode>
- Ollama OpenAI compatibility: <https://docs.ollama.com/openai>
- Ollama thinking: <https://docs.ollama.com/capabilities/thinking>
- vLLM reasoning outputs: <https://docs.vllm.ai/en/latest/features/reasoning_outputs.html>

## Notes on Inference

Some vendor docs describe capabilities and constraints, but not Tomori's exact five-level mapping.

Where that happened, Tomori makes a conservative implementation choice:

- prefer vendor-documented request fields
- clamp to documented minimums instead of inventing unsupported disables
- avoid sending undocumented generic fields to local/custom backends
