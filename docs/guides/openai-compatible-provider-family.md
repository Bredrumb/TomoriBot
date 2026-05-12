# OpenAI-Compatible Provider Family

This guide is the concrete refactor blueprint for adding multiple new providers that expose an OpenAI-style chat API.

Use this guide together with:

- `docs/ai/providers.md`
- `docs/guides/adding-new-provider.md`

## Why This Exists

TomoriBot already has one practical OpenAI-compatible provider:

- `src/providers/custom/`

It also has another provider that speaks an OpenAI-like message shape but is not a good generic base:

- `src/providers/openrouter/`

`custom` is the highest-ROI extraction starting point for vendors such as:

- DeepSeek
- Z.ai
- some NVIDIA NIM chat endpoints

It is **not** the right base for:

- Vertex AI, because auth/config is Google Cloud-oriented rather than simple API-key + base URL
- Codex CLI, because that is better treated as a local tool/client integration than an `LLMProvider`

## Current Reality

The useful split in TomoriBot is:

- `ProviderInfo.featureSupport`: app-level feature support
- `llms` rows: per-model chat/runtime capability flags such as `has_tools`, `sees_images`, `supports_structoutput`
- `image_diffusion_models`: native image generation inventory
- `embedding_models`: embedding inventory

That means a provider can be:

- chat-only
- chat + tools
- chat + tools + vision
- chat + embeddings
- chat + native image generation

without pretending it supports everything.

Important existing behavior:

- setup/provider switching already tolerates providers with no image models or embedding models by storing `NULL` in `tomori_configs.diffusion_model_id` and `tomori_configs.embedding_model_id`
- embedding execution is already routed by the selected embedding model's provider, not strictly by the active chat provider
- image generation is still gated by the active LLM provider

## Refactor Goal

The goal is **not** to make every new provider inherit `custom` directly.

The goal is to extract a reusable OpenAI-compatible family layer from `custom`, then let multiple concrete providers consume it.

First target consumers:

1. `custom`
2. `deepseek`
3. `zai`
4. `nvidia`

Deferred or separate work:

1. `openrouter` migration into the shared family
2. `vertex` provider
3. `codex-cli` integration

## Non-Goals

Do not try to solve all of this in the first extraction:

- OpenRouter capability probing and parameter-drop retry logic
- OpenRouter reasoning block preservation
- OpenRouter assistant-image role workaround
- Google/Vertex auth flows
- cross-provider native image generation routing

Those are separate problems.

## Recommended Extraction Boundary

Extract the **stream/tool/message-format** layer first.

Do **not** start by forcing a single abstract provider class for everything.

The high-value shared pieces are:

- OpenAI-style message assembly from `StructuredContextItem[]`
- OpenAI-style tool schema conversion
- OpenAI-style SSE stream parsing
- streamed tool-call accumulation
- shared image-part conversion for providers that accept `image_url`
- shared sanitized request logging
- baseline OpenAI-compatible HTTP error parsing

Keep these provider-owned:

- `providerInfo.ts`
- base URL
- auth header shape
- API key validation strategy
- provider display name / aliases
- provider-specific locale namespace
- request parameter policy
- feature flags in `ProviderInfo.featureSupport`
- optional runtime capability implementations such as embeddings or structured output
- provider-specific structured-output, image-generation, embedding, and cost helpers when they make vendor-specific HTTP requests

Shared files should stay generic. If a helper contains vendor-specific endpoints, prompt shaping, or response parsing, it belongs in `src/providers/{providerName}/`.

Current examples:

- `src/providers/openrouter/openrouterStructuredOutput.ts`
- `src/providers/deepseek/deepseekStructuredOutput.ts`

User-facing reminder:

- when adding a new provider in this family, also update `/help api-key` choices and localized provider instructions

## File Layout

Recommended new shared folder:

```text
src/providers/openaiCompatible/
  openaiCompatibleTypes.ts
  openaiCompatibleMessageBuilder.ts
  openaiCompatibleSse.ts
  openaiCompatibleErrorFormatter.ts
  openaiCompatibleStreamAdapter.ts
  openaiCompatibleToolAdapter.ts
```

Recommended responsibility split:

- `openaiCompatibleTypes.ts`
  - shared OpenAI-compatible chunk/tool types
  - provider-family options such as `providerName`, `endpointUrl`, `supportsVision`, `supportsVideos`
- `openaiCompatibleMessageBuilder.ts`
  - convert Tomori context into OpenAI chat messages
  - include tool interaction history
  - handle image parts when the model supports them
  - keep sanitized logging helper here or beside it
- `openaiCompatibleSse.ts`
  - read SSE lines
  - parse `data:` payloads
  - normalize `[DONE]`
- `openaiCompatibleErrorFormatter.ts`
  - baseline HTTP/OpenAI-style error parsing
  - helpers for retryable vs non-retryable errors
- `openaiCompatibleStreamAdapter.ts`
  - shared `StreamProvider` implementation for common OpenAI-compatible vendors
  - tool-call accumulation
  - common finish-reason handling
  - shared speaker-boundary guard if retained
- `openaiCompatibleToolAdapter.ts`
  - generic OpenAI function schema conversion
  - global MCP integration shared across compatible vendors
  - guild MCP tool injection (per-guild remote servers registered via `/config mcp add`)

Concrete providers then stay small:

```text
src/providers/custom/
  customProvider.ts
  customStreamAdapter.ts
  customToolAdapter.ts
  providerInfo.ts

src/providers/deepseek/
  deepseekProvider.ts
  deepseekStreamAdapter.ts
  deepseekToolAdapter.ts
  providerInfo.ts

src/providers/zai/
  zaiProvider.ts
  zaiStreamAdapter.ts
  zaiToolAdapter.ts
  providerInfo.ts
```

The provider-local stream/tool adapters can be very thin wrappers around the shared family implementation.

## What To Extract From `custom`

Good first extraction candidates from `src/providers/custom/customStreamAdapter.ts`:

- OpenAI chunk type definitions
- SSE parsing loop
- message assembly
- tool-call accumulation
- finish-reason handling
- sanitized request logging
- shared image-to-`image_url` conversion

Good first extraction candidates from `src/providers/custom/customToolAdapter.ts`:

- OpenAI function declaration shape
- generic schema cloning
- tools array conversion
- MCP function export path
- common tool-result formatting

## What Not To Extract From `openrouter` Yet

`src/providers/openrouter/` is useful as a reference, but it should stay separate in phase 1.

Reasons:

- it has provider-specific capability cache usage
- it has parameter probe-drop retry logic
- it preserves `reasoning_details`
- it rewrites message role structure for images in assistant turns
- it has stricter request shaping for many upstream vendors

Those concerns are real, but they are not the minimum viable family base.

## Capability Rules For New Providers

When a vendor lacks a feature, do not emulate support unless the app path is actually wired.

Use these rules:

- If the provider has no native image generation:
  - `featureSupport.nativeImageGeneration = false`
  - do not seed rows in `image_diffusion_models`
  - `diffusion_model_id` may remain `NULL`
- If the provider has no embeddings:
  - `featureSupport.embeddings = false`
  - do not seed rows in `embedding_models`
  - `embedding_model_id` may remain `NULL`
- If only some chat models support tools/vision/structured output:
  - keep provider-level `supportsFunctionCalling` / `supportsImages` broad only when true in principle
  - keep the real runtime gating in `llms` per-model flags
- If the provider has a vendor API capability but TomoriBot has no runtime path:
  - keep the corresponding `featureSupport` flag `false`

## Partial-Capability Provider Strategy

For the first rollout, keep the current UX rule:

- text models are chosen from the active provider
- image models are chosen from the active provider
- embedding models are chosen from the active provider

This keeps setup simple and matches the current commands.

Later improvement:

- allow embedding models to be selected independently from the active chat provider

That second step is lower risk because embedding execution is already routed through the embedding model's own provider internally.

## Provider Mapping

### DeepSeek

Recommended initial scope:

- chat streaming
- tool calling where the specific model supports it
- thinking-mode tool continuation if `reasoning_content` replay is wired end-to-end
- JSON structured output and history extraction only if validated end-to-end
- native assistant-prefill support only if DeepSeek beta prefix completion is wired for prefill requests

Do not assume:

- embeddings
- native image generation

### Z.ai

Recommended initial scope:

- chat streaming
- tool calling
- vision if seeded models support it
- structured output if validated

Possible second pass:

- embeddings
- native image generation

### NVIDIA NIM

Current shipped scope:

- curated text/chat models only
- tool calling on seeded tool-capable rows only
- vision on seeded vision-capable rows only
- structured output and history extraction on the validated NVIDIA subset only
- provider-owned embeddings via `nv-embed-v1`
- provider-owned native image generation via NVIDIA's Stability endpoint

Important reminder:

- keep treating NVIDIA as a curated catalog, not a blanket claim that every NIM model behaves uniformly

### Vertex AI

Do not place this in the OpenAI-compatible family plan.

Even if you use Vertex's OpenAI-compatible endpoint, the project still needs a Google Cloud auth/config story that does not fit TomoriBot's current simple provider credential model.

### Codex CLI

Do not implement this as an `LLMProvider`.

If pursued, it should be one of:

- a local tool integration
- an MCP server bridge
- a separate OpenAI API provider if the actual goal is OpenAI coding models

## Rollout Order

### Phase 1: Extract Shared Family Helpers

- create `src/providers/openaiCompatible/`
- move common stream/tool/message helpers there
- keep behavior identical for `custom`

### Phase 2: Migrate `custom`

- make `custom` the first consumer of the shared family layer
- verify no behavior change

### Phase 3: Add `deepseek`

- provider folder
- static `providerInfo.ts`
- provider registry registration
- `llms` seed rows
- minimal validation + chat streaming + tool calling

Recommended DeepSeek MVP constraints:

- implement chat streaming only through the new OpenAI-compatible family layer
- support tool calling only for models explicitly seeded with `has_tools = true`
- if a DeepSeek thinking-mode tool loop requires replay fields, preserve and replay them only within the same turn
- set `featureSupport.nativeImageGeneration = false`
- set `featureSupport.embeddings = false`
- set `featureSupport.presetGeneration = false`
- set `featureSupport.conversationCompaction = false`
- set `featureSupport.expressionInitialization = false`
- enable `featureSupport.structuredOutput` only if the DeepSeek JSON Output runtime path is actually wired and validated
- enable `featureSupport.historyExtraction` only if provider-owned structured output is wired for DeepSeek
- if the app uses assistant prefills, implement DeepSeek beta prefix completion on that provider path instead of relying only on prompt wording
- do not add `image_diffusion_models` rows unless native image generation is implemented
- do not add `embedding_models` rows unless embeddings are implemented
- if `/tool estimate cost` should support DeepSeek, add a minimal non-streaming prompt-token probe and env-backed pricing defaults sourced from the official pricing page

Recommended provider-local files:

```text
src/providers/deepseek/
  providerInfo.ts
  deepseekProvider.ts
  deepseekStreamAdapter.ts
  deepseekToolAdapter.ts
```

Recommended seed scope:

- one default general chat model
- optionally one reasoning model
- per-model flags set conservatively from validated behavior, not vendor marketing copy

Recommended API-key validation strategy:

- perform a minimal non-streaming request against the configured default DeepSeek model
- keep provider-specific error formatting inside the DeepSeek provider
- do not assume every DeepSeek model supports tools or structured output

### Capability Checklist For Future OpenAI-Compatible Providers

When adding the next vendor in this family, verify these areas explicitly instead of assuming wire compatibility from the OpenAI-style endpoint.

- tool calls:
  - confirm per-model tool support before seeding `has_tools = true`
  - verify the exact assistant/tool message format and any strict-schema differences
- structured output:
  - confirm whether the provider supports true schema enforcement or only JSON-object mode
  - if it is JSON-object mode only, implement provider-owned prompt shaping and local validation
- reasoning or thinking mode:
  - check for replay-only fields like DeepSeek `reasoning_content`
  - preserve those fields only where the vendor requires them, usually within the same tool loop turn
- assistant prefills:
  - check whether native prefix completion requires a beta endpoint or message flag such as `prefix: true`
  - do not assume a trailing assistant message alone is enough
- live cost estimation:
  - prefer API-reported prompt token usage from a minimal probe request
  - use provider-specific pricing sources instead of copying another provider's assumptions
- image generation and embeddings:
  - only seed `image_diffusion_models` or `embedding_models` if the app runtime path is actually implemented
  - leave those provider feature flags off otherwise

### Phase 4: Add `zai`

- same pattern as `deepseek`
- enable only the features confirmed by seeded models and runtime wiring

### Phase 5: Add `nvidia`

- keep the supported model set small and curated
- wire provider-owned embeddings and native image generation only when the exact NVIDIA endpoint contract is implemented
- keep live token counting out of scope unless NVIDIA exposes a validated prompt-token measurement path

### Phase 6: Optional Embedding Decoupling

- allow `/config model embedding` to choose from any seeded embedding provider
- stop coupling embedding selection to the active chat provider

## Acceptance Criteria For The Refactor

The extraction is successful when:

- `custom` still works without behavior regression
- new OpenAI-compatible providers can be added without cloning large stream/tool files
- unsupported provider features fail cleanly
- provider metadata remains the source of truth for app-level feature gating
- per-model DB flags remain the source of truth for chat-model capability gating

The combined extraction + DeepSeek slice is successful when:

- `custom` still works without behavior regression
- `deepseek` is auto-discovered and registered in `providerInfoRegistry`
- `/config setup`, `/config provider add`, and `/config provider switch` can validate DeepSeek credentials
- `/config model text` shows the seeded DeepSeek models
- DeepSeek chat streaming works
- DeepSeek tool calling works only on seeded tool-capable models
- DeepSeek structured output works on seeded STRUCT-capable models
- DeepSeek history extraction works through the provider-owned structured output capability
- `deepseek-reasoner` tool continuation preserves and replays `reasoning_content` within the same turn
- `/bot respond` assistant prefills use DeepSeek beta prefix completion
- `/tool estimate cost` can return a live estimate for DeepSeek
- unsupported DeepSeek features fail cleanly rather than appearing partially available

## Files To Keep In View

- `src/providers/custom/customProvider.ts`
- `src/providers/custom/customStreamAdapter.ts`
- `src/providers/custom/customToolAdapter.ts`
- `src/providers/openrouter/openrouterStreamAdapter.ts`
- `src/utils/provider/providerInfoRegistry.ts`
- `src/utils/provider/providerCapabilityResolver.ts`
- `src/providers/utils/providerFeatureExecutors.ts`
- `src/commands/config/api-key/set.ts`
- `src/commands/config/model/image.ts`
- `src/commands/config/model/embedding.ts`
- `src/utils/db/repositories/LlmRepository.ts`

## Practical Recommendation

If you want the fastest route to shipping new vendors, do this:

1. Extract the shared OpenAI-compatible stream/tool/message layer.
2. Migrate `custom` first.
3. Add `deepseek`.
4. Add `zai`.
5. Add `nvidia` with a curated model inventory and provider-owned embedding/image helpers.

Do **not** block that work on Vertex AI or Codex CLI.

## Handoff Scope

If you want another agent to implement this in one pass, give it this bounded scope:

1. Implement Phase 1 and Phase 2.
2. Implement only the DeepSeek MVP described in Phase 3.
3. Do not start Z.ai, Vertex AI, or Codex CLI.
4. Preserve current `custom` behavior.
5. Run `bun run check` and `bun run lint`.

Recommended handoff prompt:

```text
Implement Phase 1 and Phase 2 from docs/guides/openai-compatible-provider-family.md, then implement only the bounded DeepSeek MVP from the same guide.

Constraints:
- preserve current custom-provider behavior
- keep OpenRouter untouched unless a tiny shared extraction is unavoidable
- seed DeepSeek text models conservatively
- do not implement DeepSeek embeddings or native image generation
- do not start Z.ai, Vertex AI, or Codex CLI

Validation:
- bun run check
- bun run lint
```
