<!-- ARCH-ALIGNMENT: prereq-phase-3 -->

# 8. AI Provider System

TomoriBot uses a provider abstraction so chat logic stays provider-agnostic.

For the step-by-step contributor workflow, see
`docs/guides/adding-new-provider.md`.

## Provider Interface

Interface source: `src/types/provider/interfaces.ts`

All providers implement `LLMProvider`, including:

- `getInfo()`
- `validateApiKey()`
- `formatErrorDescription()`
- `getTools()`
- `createConfig()`
- `streamToDiscord()`
- `getDefaultModel()`

## Stream Adapter Contract

Provider streaming is normalized through `StreamProvider` and `BaseStreamAdapter` in `src/types/stream/interfaces.ts`.

Concrete adapters extend `BaseStreamAdapter` directly when they own a provider-specific wire format:

- `src/providers/google/googleStreamAdapter.ts`
- `src/providers/openrouter/openrouterStreamAdapter.ts`
- `src/providers/novelai/novelaiStreamAdapter.ts`
- `src/providers/vertex/vertexStreamAdapter.ts`
- `src/providers/anthropic/anthropicStreamAdapter.ts`

OpenAI-compatible providers extend `src/providers/openaiCompatible/openaiCompatibleStreamAdapter.ts`, which itself extends `BaseStreamAdapter`. That keeps the common OpenAI-compatible request and SSE behavior in one family adapter while preserving provider-specific overrides for endpoint URL resolution, headers, sampling controls, thinking controls, and custom tool parsing.

`BaseStreamAdapter` centralizes adapter metadata, protected raw/error lifecycle hooks, and raw chunk/error wrapping only. Provider subclasses remain responsible for context assembly, request payloads, native stream parsing, function-call extraction, and localized error descriptions.

## Current Providers

Provider folders under `src/providers/`:

- `google` (`GoogleProvider`)
- `openrouter` (`OpenrouterProvider`)
- `novelai` (`NovelaiProvider`)
- `custom` (`CustomProvider`)
- `deepseek` (`DeepseekProvider`)
- `nvidia` (`NvidiaProvider`)
- `zai` (`ZaiProvider`)
- `zaicoding` (`ZaicodingProvider`)
- `vertex` (`VertexProvider`)
- `vertexexpress` (`VertexexpressProvider`)
- `anthropic` (`AnthropicProvider`)

## Provider Factory

Factory: `src/utils/provider/providerFactory.ts`

Important behavior:

- Providers are auto-discovered by scanning `src/providers/*`.
- Loading is lazy (constructor class loaded on first use).
- Aliases are supported from provider metadata.
  - examples: `gemini` -> `google`, `or` -> `openrouter`, `nai` -> `novelai`
- `ProviderFactory.getProviderByName()` can resolve a provider directly when a full `TomoriState` is not available.

## Provider Metadata

Static provider metadata is defined in each provider folder:

- `src/providers/google/providerInfo.ts`
- `src/providers/openrouter/providerInfo.ts`
- `src/providers/novelai/providerInfo.ts`
- `src/providers/custom/providerInfo.ts`
- `src/providers/deepseek/providerInfo.ts`
- `src/providers/nvidia/providerInfo.ts`
- `src/providers/zai/providerInfo.ts`
- `src/providers/zaicoding/providerInfo.ts`
- `src/providers/vertex/providerInfo.ts`
- `src/providers/vertexexpress/providerInfo.ts`
- `src/providers/anthropic/providerInfo.ts`

OpenAI-compatible family internals shared by `custom`, `deepseek`, `nvidia`, `zai`, and `zaicoding` live in:

- `src/providers/openaiCompatible/`

Registry helpers live in `src/utils/provider/providerInfoRegistry.ts`.

`providerInfoRegistry.ts` auto-discovers every `src/providers/*/providerInfo.ts` file at module load using Bun's `Glob` scanner. Adding a provider folder with a valid `providerInfo.ts` no longer requires editing a central `providerInfos` array or provider-name type union.

Use these helpers instead of hardcoding provider names in commands/tools:

- `normalizeProviderName()`
- `getStaticProviderInfo()`
- `providerSupportsFeature()`
- `resolveProviderFeatureImplementation()` (temporary runtime routing for shared feature handlers)

Runtime capability resolution lives in:

- `src/types/provider/featureInterfaces.ts`
- `src/utils/provider/providerCapabilityResolver.ts`

`ProviderInfo.featureSupport` is the source of truth for app-level feature gating such as:

- native image generation
- embeddings
- structured output
- preset generation
- expression initialization
- live token counting
- conversation compaction
- history extraction

`ProviderInfo.featureImplementations` is provider-owned metadata for shared feature executors that still live outside the provider folder, such as native media generation and live token counting. A provider declares only the implementations it actually uses:

```ts
featureImplementations: {
  imageGeneration: "example",
  liveTokenCounting: "example",
}
```

The registry builds the feature implementation map from discovered provider info. Core orchestration code must not branch on hardcoded provider names; use provider metadata, API-family helpers, provider methods, or capability resolvers instead.

Rule:

- If a command only needs to know whether a provider supports a feature, use `providerSupportsFeature()`.
- If a command needs to execute a provider-owned runtime feature, resolve the optional capability from the provider instance instead of checking `provider === "google"` inline.

## Model Source of Truth

- Text models are stored in table `llms`.
- Provider code intentionally uses DB/cache-backed defaults, not hardcoded static model lists.
- Use `src/db/seed.sql` for maintained model inventory.

## Capability Resolution

### OpenRouter

- Startup cache fetch from `https://openrouter.ai/api/v1/models`
- cache module: `src/utils/cache/openrouterCapabilityCache.ts`
- arbitrary OpenRouter text, embedding, image, and video model codenames can now be registered per server via `/openrouter model add` or per user via `/personal openrouter-model add`
- those registrations stay under the normal `openrouter` provider; they are not `custom_endpoints`
- legacy picker selection of `other-model` is now only a migration notice path pointing users at the new registration commands, while already-configured legacy `other-model` selections still keep runtime compatibility during rollout
- OpenRouter provider can override stale DB capability flags with API capabilities at runtime.
- OpenRouter Gemini-family chat models (`google/gemini-*`) also force-enable Tomori's YouTube tool exposure at runtime, so stale `sees_youtube` DB flags do not hide `process_youtube_video`.
- Tool support primarily follows the OpenRouter `tools` parameter, with a fallback for models whose OpenRouter description explicitly advertises native function/tool calling even when `supported_parameters` is incomplete.
- `tool_choice` is treated as optional and is only sent when the OpenRouter capability cache says the active model supports it.
- `supported_parameters` from the OpenRouter cache is also used to gate optional request params such as `logit_bias`.
- `/config logit-bias` now stores raw text as the source of truth and caches tokenizer-specific token IDs per model family.
- Model changes refresh those cached tokenizations instead of forcing users to re-enter the same words.
- Runtime still only sends `logit_bias` when the active OpenRouter model reports support for it.
- See `docs/ai/logit-bias.md` for the storage format, refresh triggers, and tokenizer-family design.

### Gemini and NovelAI token limits

- static lookup maps:
  - `src/utils/cache/geminiCapabilityCache.ts`
  - `src/utils/cache/novelaiCapabilityCache.ts`
- used for context/token budgeting behavior.

## Multimodal Context Throttles

- `MEDIA_CONTEXT_WINDOW` limits how many recent messages can carry full media parts in context.
- `MEDIA_IMAGE_MESSAGE_LIMIT` further limits how many of those recent messages may include non-emoji, non-sticker image payloads.
- Messages outside those limits still keep text and system hints, so the model knows media exists without loading every image into provider payloads.

## Custom Endpoint Notes

Phase 3 promotes custom endpoints into labeled provider entries instead of a single anonymous `custom` slot.

- registration and in-place updates happen through `/config custom-endpoint add|edit` and `/personal custom-endpoint add|edit`
- endpoints are stored in `custom_endpoints`, keyed by `(server_id | user_id, label, capability)`
- the saved credential row is namespaced per label as an internal provider ID such as `custom:s42:ollama-local` or `custom:u7:lmstudio`
- custom endpoints can now be registered independently for `text`, `embedding`, `image`, `video`, `speech`, and `transcription`
- text and embedding use the OpenAI-compatible path; image and video route through either OpenAI-compatible image/video endpoints or ComfyUI workflow dispatch; speech uses `tts-clone` or `elevenlabs`; transcription uses `openai-compatible-transcription` or `elevenlabs-transcription`
- ComfyUI workflow dispatch now supports placeholder replacement inside uploaded API-format JSON before queueing, including prompt/model/aspect placeholders, derived width/height, video duration/resolution/audio flags, and indexed reference-image payload placeholders such as `{TOMORI_PROMPT}` and `{TOMORI_REFERENCE_IMAGE_1_DATA_URL}`
- text-capability custom endpoints can declare `has_tools`, `sees_images`, `sees_videos`, and `supports_structoutput`, which drive picker visibility and request shaping
- `/config model text|embedding|image|video|vision` shows each registered custom label as its own provider choice when that capability is available
- `/config model speech` and `/config model transcription` switch the active server-scoped speech/STT endpoint by updating the default row in `custom_endpoints`
- `/config custom-endpoint edit` and `/personal custom-endpoint edit` first ask which registered endpoint row to replace, then merge any provided slash-command fields over that row while keeping omitted fields unchanged
- legacy inline fields on `tomori_configs` and saved-provider rows (`custom_endpoint_url`, `custom_model_name`, `custom_num_ctx`) remain for backward compatibility during rollout, but new registrations write through the labeled `custom_endpoints` table
- conversation compaction, history extraction, persona preset generation, and image-analysis helpers all resolve through the effective custom endpoint metadata when a custom label is active
- `/config logit-bias` entries are still stored in config snapshots, but Tomori does not auto-tokenize plain-text entries for custom endpoints
- `thinking_level` still only maps to generic OpenAI-compatible reasoning controls where the target backend accepts them; backend-specific knobs remain adapter-specific

Maintenance:

- `bun run audit-legacy-provider-paths` reports remaining legacy `other-model`, legacy inline `custom`, and fully orphaned labeled custom-provider bundles
- `bun run cleanup-legacy-provider-paths` deletes only fully orphaned labeled custom-provider bundles after an explicit confirmation prompt

## Anthropic Provider Notes

`anthropic` uses Anthropic's native Messages API directly for Claude models.

- chat models are streamed through the provider-owned SSE adapter
- supported Claude 4.6/4.7 models use adaptive thinking via `thinking: { type: "adaptive" }`
- the `thinking_level` option in `/config samplers` maps to Anthropic `output_config.effort` (`low` / `medium` / `high`) when adaptive thinking is supported
- `None` maps to `thinking: { type: "disabled" }`
- adaptive thinking omits sampling params that Anthropic rejects in that mode
- per-provider sampler values are configured with `/config samplers`; Anthropic-specific request omission still happens automatically when the API rejects a combination
- Anthropic models that reject sending `temperature` and `top_p` together still only receive one sampling control at a time at the API boundary:
  - if `top_p` is customized away from the shared default while temperature remains at the shared default, Tomori sends `top_p`
  - otherwise Tomori prefers `temperature` and omits `top_p`
- `top_k` remains independent and can still be sent with either of the above
- `/tool estimate cost` uses Anthropic's dedicated `/v1/messages/count_tokens` endpoint

## Vertex AI Provider Notes

`vertex` uses Vertex AI with host-side Application Default Credentials plus a saved `{project_id}::{location}` config value.

- broader Google Cloud / Vertex AI model surface than Express Mode
- supports chat streaming, tool calling, structured output, compaction, embeddings, preset generation, and native image generation
- seeded Vertex image rows mirror the Gemini image catalog used by the Google provider
- seeded Vertex rows include multimodal/video-capable Gemini and selected Vertex-hosted Gemma rows
- best fit for local/self-hosted deployments or a single deployment-level Google identity

## Vertex AI Express Provider Notes

`vertexexpress` uses Vertex AI Express Mode with a per-user API key.

- BYOK-friendly for deployed TomoriBot instances where each user brings their own Google key
- Express Mode requests use the global `aiplatform.googleapis.com` endpoint and do not require a saved `{project_id}::{location}` value
- the key should come from the Express Mode signup flow, or from a full Google Cloud project's Express-bound service-account key after upgrade
- a random standard Google Cloud API key can fail with `aiplatform.endpoints.predict` permission errors during validation
- limited to the Express Mode Gemini subset seeded in `llms` / `image_diffusion_models`
- supports chat streaming, tool calling, structured output, compaction, preset generation, and native image generation
- does not support embeddings, video input/output, or YouTube handling
- uses the same Google GenAI SDK family, but authenticates with `vertexai: true` plus `apiKey`

## DeepSeek Provider Notes

`deepseek` uses the shared OpenAI-compatible family layer for bounded text/chat support.

- text chat streaming is supported
- tool calling is only enabled for models explicitly seeded with `has_tools = true`
- JSON structured output is supported on seeded DeepSeek text models through DeepSeek JSON Output plus local Zod validation
- `deepseek-reasoner` tool continuation preserves DeepSeek `reasoning_content` within the same turn
- manual `/bot respond` prefills use DeepSeek beta prefix completion when the request ends with an assistant prefill
- history extraction is enabled through the provider-owned structured output capability
- `/tool estimate cost` supports DeepSeek using conservative cache-miss input pricing by default
- no native image generation rows are seeded
- no embedding rows are seeded
- provider-level feature flags remain disabled for native image generation, embeddings, and expression initialization
- preset generation is enabled: `json_object` mode with schema injected into the system prompt + Zod validation; `deepseek-reasoner` omits the `temperature` param
- conversation and roleplay compaction are enabled through the provider-owned structured output capability

## Z.ai Provider Notes

`zai` uses the shared OpenAI-compatible family layer for the GLM model family via `https://api.z.ai/api/paas/v4`.

- **Chat models**: `zai/glm-5.1`, `zai/glm-5` (default, reasoning), `zai/glm-4.7` (reasoning), `zai/glm-4.7-flash` (free), `zai/glm-4.6v` (vision), `zai/glm-4.6v-flash` (free vision)
- **Image generation**: `zai/glm-image` via dedicated images/generations endpoint; aspect ratio mapped to pixel sizes
- the `thinking_level` option in `/config samplers` maps to `thinking: { type: "enabled" | "disabled" }`
- active Z.ai thinking mode deletes temperature / top_p / frequency_penalty / presence_penalty from the request
- Tool streaming uses `tool_stream: true` flag when tools are present
- JSON structured output uses `response_format: { type: "json_object" }` with prompt-steered schema injection and Zod validation (same pattern as DeepSeek)
- Vision structured output supported on `glm-4.6v` and `glm-4.6v-flash`
- Output prefill uses `prefix: true` on the last assistant message (single endpoint, no beta URL)
- Model codenames stored with `zai/` prefix in DB (e.g., `zai/glm-5`), stripped to `glm-5` for API calls
- No img2img support — reference images are ignored with a user warning
- MCP vision: users can add `@z_ai/mcp-server` via `/config mcp add` for image/video analysis on non-vision models
- Conversation and roleplay compaction are enabled through the provider-owned structured output capability
- Preset generation is enabled: `json_object` mode with schema injected into the system prompt + Zod validation; reasoning models omit `temperature`

## Z.ai (Coding) Provider Notes

`zaicoding` uses the shared OpenAI-compatible family layer for the GLM family via `https://api.z.ai/api/coding/paas/v4`.

- **Chat models**: `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.7-flash`, `glm-4.6v`, `glm-4.6v-flash`
- **Image generation**: disabled; the coding endpoint is no longer treated as a native image generation provider
- Uses the same streaming, tool-calling, and structured-output pipeline as the general `zai` provider
- Intended for dedicated coding-endpoint access such as GLM Coding Plan workflows
- Conversation compaction and roleplay compaction delegate to the shared ZAI generators with the coding endpoint URL
- Preset generation delegates to the shared ZAI generator with the coding endpoint URL and the Zaicoding tool adapter

## NVIDIA NIM Provider Notes

`nvidia` uses the shared OpenAI-compatible family layer for chat/tool/vision on `https://integrate.api.nvidia.com/v1`.

- **Chat models**: curated NVIDIA-hosted catalog rows only, seeded in `llms`
- **Embeddings**: `nv-embed-v1` via NVIDIA's embeddings endpoint
- **Image generation**: `stabilityai/stable-diffusion-3-medium` via NVIDIA's dedicated Stability endpoint
- Tool calling, vision, and structured output are gated conservatively by seeded per-model flags
- Structured output and history extraction are enabled only for the validated subset of NVIDIA text models
- Native image generation is text-to-image only right now; reference images are ignored with a warning
- `/tool estimate cost` does not support NVIDIA live token counting
- Conversation and roleplay compaction are enabled; the compact generator preprocesses images via `fetchAndOptimizeImage()`
- Preset generation is enabled: tries strict `json_schema` mode first, falls back to `json_object` + prompt steering on 400/422 errors with schema-related keywords

## Tool Integration Across Providers

Tools are provider-agnostic at registry level, then adapted per provider by each provider tool adapter.

- Google: `googleToolAdapter.ts`
- OpenRouter: `openrouterToolAdapter.ts`
- NovelAI: `novelaiToolAdapter.ts`
- DeepSeek: `deepseekToolAdapter.ts`
- Custom: `customToolAdapter.ts`
- NVIDIA NIM: `nvidiaToolAdapter.ts`
- Z.ai: `zaiToolAdapter.ts`
- Z.ai (Coding): `zaicodingToolAdapter.ts`
- Vertex AI: `vertexToolAdapter.ts`
- Vertex AI Express: `vertexexpressToolAdapter.ts`

All providers rely on centralized tool filtering via `getAvailableToolsWithMCP()`.

### MCP Adapter Registration (Critical)

Every provider that supports tool calling **must** register its tool adapter with
`registerMCPAdapter()` in `src/events/clientReady/02_registerMCPs.ts`.

This registration is required because tool **definition** and tool **execution** use
different resolution paths:

- **Definition path**: `getAvailableToolsWithMCP()` queries the `mcpManager` directly
  to build the tool list sent to the LLM. This works for any provider regardless of
  adapter registration.
- **Execution path**: `executeTool()` calls `isMCPFunction(functionName, provider)`,
  which looks up the provider's adapter in `ToolRegistry.mcpAdapters`. If no adapter
  is registered for the provider, MCP tool calls silently fall through to the built-in
  tool check and fail with "Tool not found in registry".

If you add a new provider with tool support and skip this registration, MCP tools
(e.g. `fetch`, `web-search`) will appear in the LLM's tool list but fail at execution
time. Built-in tools will still work because they resolve through a separate path.

## Provider Runtime Capabilities

Optional provider-owned runtime capabilities now live on provider classes instead of a central implementation switch table.

Current capability layer:

- capability interfaces: `src/types/provider/featureInterfaces.ts`
- typed resolver: `src/utils/provider/providerCapabilityResolver.ts`
- thin app-level wrappers: `src/providers/utils/providerFeatureExecutors.ts`
- shared schema/builders only: `src/providers/utils/structuredOutput.ts`
- shared compaction schema/builders: `src/providers/utils/compactCommon.ts`
- shared preset schema/prompt/type builders: `src/providers/utils/presetCommon.ts`
- provider-local structured output runtimes:
  - `src/providers/google/googleStructuredOutput.ts`
  - `src/providers/openrouter/openrouterStructuredOutput.ts`
  - `src/providers/deepseek/deepseekStructuredOutput.ts`
  - `src/providers/custom/customStructuredOutput.ts`

Google and OpenRouter currently own runtime execution for:

- embeddings
- structured output execution
- preset generation
- conversation compaction
- roleplay compaction
- history extraction (via structured output capability)

DeepSeek currently owns runtime execution for:

- structured output execution
- preset generation
- conversation compaction
- roleplay compaction
- history extraction (via structured output capability)

NVIDIA currently owns runtime execution for:

- embeddings
- structured output execution
- preset generation
- conversation compaction
- roleplay compaction
- history extraction (via structured output capability)
- native image generation

Custom currently owns runtime execution for:

- structured output execution
- preset generation
- conversation compaction
- roleplay compaction
- history extraction (via structured output capability)

ZAI and ZAI (Coding) currently own runtime execution for:

- structured output execution
- preset generation
- conversation compaction
- roleplay compaction
- history extraction (via structured output capability)
- native image generation

Live token counting for `/tool estimate cost` still uses a temporary legacy command path for Google, OpenRouter, DeepSeek, and the Z.ai family. NVIDIA intentionally does not implement live token counting.

Rule:

- Keep `providerSupportsFeature()` as the common early-gating helper.
- Put runtime execution on the provider instance when the feature is app-level and provider-specific.
- Keep provider-specific implementation code inside `src/providers/{providerName}/` or shared family internals.
- If a shared utility exists, keep it genuinely generic; provider-specific HTTP requests, prompt shaping, and response parsing should stay in the provider folder.
- `resolveProviderFeatureImplementation()` is now temporary legacy routing for the runtime paths that have not been migrated yet.

## Writing Provider-Aware Commands

When adding a new command or tool flow that depends on provider support:

1. Decide whether the command only needs static gating, or also needs runtime execution.
2. Add or reuse a `ProviderInfo.featureSupport` flag for the app-level feature.
3. In the command, fail early with `providerSupportsFeature(providerName, featureName)`.
4. If runtime execution is needed, resolve the provider-owned capability instead of switching on provider names.

Use this pattern:

- static gating only:
  - examples: hide/deny a feature before execution, validate setup, choose UI availability
  - use `providerSupportsFeature()`
- migrated runtime execution:
  - examples: embeddings, structured output, preset generation, compaction, history extraction
  - use `src/utils/provider/providerCapabilityResolver.ts` directly or a thin wrapper such as `src/providers/utils/providerFeatureExecutors.ts`
- legacy runtime execution:
  - examples: native image generation, live token counting
  - these still use `resolveProviderFeatureImplementation()` temporarily until migrated

Rules for command authors:

- Do not add new `provider === "google"` or `provider === "openrouter"` checks in commands for app-level features.
- Keep provider identity separate even when internals are shared across a family.
- If a provider does not implement the runtime capability, return a clean unsupported error near the command boundary.
- If a new feature will be reused by multiple commands, prefer adding a new optional capability interface over creating another central switch table.

Current command examples:

- `src/commands/server/initialize/expressions.ts`
- `src/commands/persona/generate.ts`
- `src/commands/tool/compact.ts`
- `src/commands/memory/history/import.ts`

## Intentional Exceptions

Some literal provider names are still correct and should remain explicit:

- flows that require a truly provider-specific optional credential
- direct vendor-specific capabilities that are not abstracted yet
- remaining legacy runtime paths such as native image generation and live token counting until they are moved onto provider capabilities

Example:

- NovelAI inpainting can optionally use a Google key for Gemini segmentation. That is intentionally a Google-specific integration, not a generic "Gemini-family" provider capability.

## Context Item Tag Routing (Important)

`ContextItemTag` in `src/types/misc/context.ts` controls whether a context block is injected as:

- provider system instruction
- conversation history

Use this mental model when adding new context blocks:

- system instruction tags (`SYSTEM_*`, `KNOWLEDGE_*`) are prompt-level guidance
- dialogue tags (`DIALOGUE_*`) are chat history items

Critical rule:

- If an instruction must appear in conversation history, inject with `DIALOGUE_HISTORY`
  and the correct role (`"user"`/`"model"`), not with `SYSTEM_*`/`KNOWLEDGE_*`.
- Generated media annotations such as `[System: This message contains an image...]`
  or media tool-use hints should be detached into their own synthetic `"user"`
  `DIALOGUE_HISTORY` item so assistant turns only carry speaker-authored content.

Why this matters:

- providers treat system instruction and history differently for behavior/token usage
- incorrect tagging can silently change response quality and tool behavior

## Provider Credential Commands

- `/config setup` for first-time setup
- `/config provider add` to save additional provider credentials without switching
- `/config custom-endpoint add` to register labeled custom endpoints
- `/config provider switch` to activate a saved provider or validate credentials for a first-time switch

`/config provider add` no longer configures custom endpoints directly. The legacy `Custom Endpoint` choice is only a redirect shim to `/config custom-endpoint add`.

Provider choice/model selection commands:

- `/config model text`
- `/config model image`
- `/config model embedding`
