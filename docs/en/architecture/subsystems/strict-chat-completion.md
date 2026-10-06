---
title: "Strict Chat-Completion Compatibility"
---

# Strict Chat-Completion Compatibility

Some provider APIs require message shapes that others merely tolerate. TomoriBot normalizes three
of these behind one shared seam so any provider path (built-in or a custom-endpoint proxy) can
front a strict backend (e.g. Claude behind an OpenAI-shaped proxy, or a DeepSeek/Z.ai-style
"continue this turn" backend).

The shared helpers live in [`src/providers/utils/strictChatCompat.ts`](../../src/providers/utils/strictChatCompat.ts).

## The three normalizations

| Normalization | Toggle? | What it does |
|---|---|---|
| **Role alternation** | `strict_role_alternation` | Merge consecutive same-role turns into one, and prepend a synthetic leading `user` turn when the first dialogue turn is `assistant`. Tool-bearing turns (top-level `tool_calls`/`tool_call_id`) act as merge boundaries so their wiring is never dropped. |
| **Prefix completion** | `supports_prefix_completion` | Set `prefix: true` on the trailing assistant prefill turn so the backend continues it (DeepSeek / Z.ai vendor extension). |
| **Media relocation** | *(always-on, not a toggle)* | Peel media off `assistant` turns into a following `[System: …]` `user` turn with sender attribution; the `assistant` role cannot carry media in input history across OpenAI/Anthropic/Gemini-shaped APIs. |

### Orthogonality (why two toggles, not one)

Role alternation and prefix completion pull in opposite directions and must stay independent:

- A Claude-via-proxy backend wants role alternation enabled and prefix completion disabled (it does
  not understand `prefix: true` and may hard-error on it).
- A DeepSeek/Z.ai/vLLM-style continue backend wants prefix completion enabled, and usually does
  not need role alternation.

A single bundled "strict mode" boolean would force the wrong combination on one group.

### Assistant prefill (a capability, not a normalization)

`supports_assistant_prefill` records whether the model continues a trailing assistant turn at all.
It is separate from prefix completion: prefix completion means the backend needs the `prefix: true`
marker, while this flag means the backend accepts the trailing turn instead of rejecting it with a
400 (Claude 4.6 and later, Gemini 3.5 Flash-Lite and later) or restarting its answer (most
OpenRouter hosts). The prefill resolver in
[`src/utils/chat/assistantPrefill.ts`](../../src/utils/chat/assistantPrefill.ts) reads it per
generation attempt; NovelAI and prefix-completion backends count as able regardless of the column.
The exception is DeepSeek, which rejects `prefix: true` in a request that also carries `tools`
("Function call should not be used with prefix"). While Tool Use is on there, the resolver reports a
`tools` blocker: a server prefill is skipped and a `/respond` prefill is sent as an instruction.
Unlisted models default to `false`, so a new model never receives a prefill until its seed row is
flipped after a probe (`plans/prefill-probe.ts`). Moving `~` aliases stay `false`, because the model
behind one can drop support without the row changing. See
[Chat build context](/architecture/pipelines/chat/06-per-turn/01-build-context/) for how the
resolver applies it.

### Media relocation is always-on

Media relocation runs unconditionally in every provider path, regardless of either toggle; a
custom endpoint with both toggles OFF still gets it. It was already unconditional before this
seam existed; do not gate it. The canonical wording is shared across all providers:

```
[System: The following image was sent by {name}.]
[System: The following images were sent by {name}.]
```

When no sender is available, the fallback is the same canonical sentence without the name:

```
[System: The following image was sent]
[System: The following images were sent]
```

The sender comes from `StructuredContextItem.sender`, populated from each
`SimplifiedMessageForContext` row's `personaName` / `authorName` before provider serialization.
Relocation runs on that neutral representation first, so multi-persona histories can attribute
each relocated image to the persona that actually sent it, including image-only turns where parsing
a leading `{Name}:` text label would fail.

When relocation clones or splits a structured item, it also preserves hidden participant metadata,
including `conversationUsers` and `participantTargetIndex`. Provider normalization never reparses
participant prompt prose to recover mention, tool-target, or copied-identity candidates.

Anthropic and OpenRouter previously used a single per-request name
(`[System: This image was sent by {botName}.]`) for every relocated image. That could mislabel
images sent earlier by other personas. The OpenAI-compatible family previously used the generic
`[System: The previous assistant message included ...]` wording. The current wording intentionally
supersedes the plan-07 byte-identical golden-body bar for the media notice only; role alternation
and prefix-completion goldens remain unchanged.

## Resolution: column-is-truth (D4)

The flags are stored as boolean columns on `llms` and `custom_endpoints`
([`src/types/db/schema.ts`](../../src/types/db/schema.ts), [`src/db/schema.sql`](../../src/db/schema.sql)).
At request time the active model's `llms` row is the source of truth: the adapter reads
`context.tomoriState.llm.strict_role_alternation` / `.supports_prefix_completion`:

- **Built-in providers**: Seeded with the required flag in the typed catalog
  ([`src/db/seed/catalog/models.ts`](../../src/db/seed/catalog/models.ts)): anthropic →
  alternation; deepseek/zai/zaicoding → prefix. `supportsAssistantPrefill` is set per measured
  model, and no provider-wide invariant covers it.
- **Custom endpoints**: Carry the user's toggle choices on the `custom_endpoints` row, synced to the
  endpoint's synthetic `llms` row (`upsertSyntheticCustomLlm`), so the runtime reads them the
  same way as built-ins.

A small request-time safety net: `providerRequiresAlternation` / `providerRequiresPrefixCompletion`
in `strictChatCompat.ts`: OR-combines with the column so a mis-seeded row can never make a
built-in emit an invalid body:

```ts
const enforceAlternation =
  providerRequiresAlternation(provider) || (llm?.strict_role_alternation ?? false);
const enablePrefix =
  providerRequiresPrefixCompletion(provider) || (llm?.supports_prefix_completion ?? false);
```

### Enforced by check-seed-catalogs (no UI guard)

Built-in `llms` rows have no capability-editing command surface, so there is no write/UI guard.
Instead the per-provider required-flag invariant runs at boot and in CI via
[`bun run check-seed-catalogs`](../../scripts/checks/checkSeedCatalogs.ts) → `collectStrictChatFlagViolations`
in [`modelSeed.ts`](../../src/db/seed/catalog/modelSeed.ts). It fails if any anthropic model lacks
`strictRoleAlternation`, or any deepseek/zai/zaicoding model lacks `supportsPrefixCompletion`. Keep
the `REQUIRED_*_PROVIDERS` sets in `modelSeed.ts` in lockstep with `providerRequires*` in
`strictChatCompat.ts`.

## Configuring a custom endpoint

The toggles appear under `Chat Completion Compatibilities` in the Text model modal opened from the
model dropdown on a `/providers` or `/personal providers` entry page. They are deliberately separate from
Text Capabilities: tool calling, image input, and structured output describe the model, while these
describe the backend's message parser.

The group is offered only where the request path can act on it, which is the `openai-compatible` api family
minus any flag that family already forces on. Custom endpoints resolve through the `custom` provider and so
keep every flag. Anthropic forces alternation, never reads prefix completion, and takes its prefill support
from the seed; DeepSeek, Z.ai, and Z.ai Coding force prefix completion, which also makes a prefill native,
so neither prefix toggle is offered there. OpenRouter is offered only Assistant Prefill, because a
user-registered OpenRouter codename has no seed row to declare it. The OpenRouter adapter does honor
strict alternation and prefix completion, but no seed row sets either for OpenRouter and the panel
does not offer them, so both stay off there. Google/Vertex and NovelAI are offered
none: the seed decides Gemini, and NovelAI continues a prefill by construction. Where a flag is not
offered, its stored value is preserved rather than rewritten, so nothing changes for a workspace that set it
before. `offeredChatCompatFlags` derives this from `apiFamily` plus `providerRequires*`, and the submit path
re-derives it rather than trusting the submission.

- **Strict Role Alternation**: enable when your proxy fronts a backend that requires strict
  user/assistant alternation and a leading user turn (e.g. Claude behind an OpenAI-shaped proxy).
- **Prefix Completion**: enable when your proxy fronts a backend that supports continuing a partial
  assistant turn (e.g. DeepSeek / Z.ai-style `prefix: true`, or vLLM/SGLang continue modes).
- **Assistant Prefill**: enable only when the model continues a reply started for it instead of
  rejecting the request or restarting the answer. Without it, a `/respond` prefill is sent as a
  written instruction and a server prefill is skipped.

The `/setup` custom endpoint step offers these flags (plus Verbatim Tool Calling) as checkboxes in its
model modal, and writes them to both the synthetic `llms` row and the `custom_endpoints` row.

All default OFF. With all OFF a custom endpoint behaves exactly as before (media relocation still
applies; no alternation merge; no `prefix: true`).

## Migration

`025_strict_chat_compat_flags` adds the two columns to both tables (defaulting OFF) and backfills
the built-in requirements: `strict_role_alternation = true` for `anthropic`, and
`supports_prefix_completion = true` for `deepseek`/`zai`/`zaicoding`. Fresh installs get the same
values from the seed catalog + `schema.sql`.

`095_assistant_prefill` adds `supports_assistant_prefill` to both tables (defaulting OFF) and
backfills the measured seed rows; the per-boot reseed keeps them authoritative afterwards.
