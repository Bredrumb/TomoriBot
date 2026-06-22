---
title: "Database Schema and Data Model"
---

This document summarizes the current PostgreSQL schema used by TomoriBot.

## Schema Sources

- Main schema: `src/db/schema.sql`
- RAG schema: `src/db/schema_rag.sql` (loaded only when RAG is enabled)

## Data Access Boundary

The Phase 2 repository layer lives under `src/utils/db/repositories/`. Repository classes implement the shared `IRepository<TExport>` contract:

| Repository | Domain |
|---|---|
| `ConfigRepository` | Server/persona config reads + writes, NAI presets |
| `ConditioningMemoryRepository` | Reward/punish conditioning history |
| `CooldownRepository` | Cooldown checks, cooldown writes, cleanup |
| `ErrorLogRepository` | Error log inserts (thin shim; avoids circular import with logger) |
| `ExportRepository` | All data export operations (personal, server, memories, settings) |
| `ImportRepository` | All data import operations + cache invalidation |
| `LlmModelRepository` | Global model catalog (text, embedding, diffusion, video) |
| `LlmOverrideRepository` | Channel/persona LLM override assignments + fallback refs |
| `LlmProviderRepository` | Saved provider configs, custom endpoints, OpenRouter registrations |
| `McpRepository` | MCP server configurations |
| `PersonalMemoryRepository` | User + persona lineage scoped personal memories |
| `PersonaUserBlockRepository` | Persona-scoped user mutes/blocks (`persona_user_blocks`) |
| `PersonaRepository` | Persona state loading + writes (`personas`, `persona_configs`) |
| `PersonaSpriteMessageRepository` | Sprite message → label mappings (`persona_sprite_messages`) |
| `PersonaSpriteRepository` | Persona sprite rows (`persona_sprites`) |
| `PresetRepository` | TomoriBot preset export/import + SillyTavern preset CRUD + ST card conversion |
| `QuotaRepository` | Image, text, and video generation quota tracking |
| `RagRepository` | RAG document and chunk storage |
| `ServerMemoryRepository` | Server-wide shared memories |
| `ServerRepository` | Server identity: setup, emojis/stickers, webhooks, blacklist |
| `ServerScheduleRepository` | Reminder + random-trigger scheduling |
| `ShortTermMemoryRepository` | Short-term per-channel/user conversation memory |
| `SpeechRepository` | Speech (TTS/STT) server configuration |
| `StatRepository` | Buffered usage-stat counters + read/aggregation (`stat_counters`) |
| `ToolRepository` | Tool configurations and API key status |
| `UserRepository` | User registration, privacy, personalization, spotlight |
| `WhitelistRepository` | Channel, persona, and role whitelist rules |

Application code imports repository instances from `src/utils/db/repositories/index.ts`. That file re-exports repository instances and a small set of shared types; it contains no free functions. The former public DB god files (`dbRead.ts`, `dbWrite.ts`, `dataExport.ts`, `dataImportV2.ts`) have been removed.

### SQL convention

All SQL is inlined as `private` methods directly on the owning Repository class. Separate `*ReadSql.ts` / `*WriteSql.ts` sibling files are forbidden — `checkRefactorIntegrity.ts` will flag any surviving SQL sibling at gate time. If inlining SQL pushes a Repository file past ~1,000 lines, that signals the domain is too broad: **split the Repository itself** (e.g. `LlmRepository` → `LlmModelRepository` + `LlmProviderRepository` + `LlmOverrideRepository`) rather than externalising SQL. Size is the signal; the split must follow a coherent domain boundary.

## Main Tables (Current)

### Core identity/config

- `servers`
- `personas`
- `persona_configs`
- `users`

### Server config normalization (Phase 6 Step #14 — complete)

`tomori_configs` was split across 14 command-aligned tables and dropped (migration `008_drop_tomori_configs.sql`):

- `server_chat_configs` — `/config humanizer`, `/config message-fetch-limit`, `/model` parameters, `cascade_limit`, `match_limit`, `context_note`, `context_note_depth`
- `server_notice_embeds_configs` — `/config notice-embeds visibility`
- `server_member_permissions_configs` — `/server member-permissions`; `/capabilities manage` also writes `self_teaching_enabled` and `personal_memories_enabled`
- `server_channel_scope_configs` — `/server rp-channels`, `/server private-channels`, `/server crosschannel-blocklist`, thought-log channel
- `server_welcome_configs` — `/server welcome-channel`
- `server_trigger_behavior_configs` — `/server always-reply`, `/server deliberate-trigger-mode`, cooldown settings (`ServerScheduleRepository`)
- `server_auto_trigger_configs` — `/server auto-trigger` channels + threshold (`ServerScheduleRepository`)
- `server_capabilities_configs` — `/capabilities manage` feature/tool toggles, `/capabilities toggle`
- `server_novelai_imagegen_configs` — `/novelai` image parameters, `/config image-tags` defaults, `nai_diffusion_model_id`
- `server_nsfw_configs` — `/nsfw` jailbreak toggles
- `server_speech_configs` — `/speech` Chatterbox parameters, `chatterbox_turbo_enabled`, `chatterbox_cfg_weight`, `chatterbox_exaggeration`
- `server_byok_configs` — `/server user-byok`
- `server_memory_configs` — `/memory tagging` settings (`ServerMemoryRepository`)
- `server_model_configs` — active model-selection FKs (`llm_id`, `embedding_model_id`, `diffusion_model_id`, `video_model_id`, `vision_llm_id`) plus runtime credential/thinking mirrors and Phase 3 inline custom endpoint fields that remain on the active assembled server config

### Persona config normalization (Phase 6 Step #14 — complete)

`personas` persona-specific config columns were extracted to 4 tables (steps #14.2–#14.6 complete):

- `persona_context_note_configs` — per-persona context note + depth
- `persona_voice_configs` — `speech_voice_*` (`elevenlabs_voice_*` dropped by migration 010, Phase 6 Step #14.2)
- `persona_imagegen_configs` — `physical_appearance_tags`, `nai_char_ref_url`
- `persona_textgen_configs` — NovelAI ATTG author/title/tags/genre/stars

### User personalization normalization (Phase 6 Step #14 — complete)

`users` personalization columns are being extracted to one table:

- `user_personalization_configs` — `shortterm_cache_crossserver_opt_in`, `physical_appearance_tags`, `nai_char_ref_url`, `impersonation_prompt`, `personal_dtm`

### Model registries

- `llms`
- `image_diffusion_models`
- `video_generation_models`
- `embedding_models`

### Presets and prompts

- `persona_presets`
- `system_prompt_presets`

### Memory and expression data

- `server_memories`
- `personal_memories`
- `conditioning_history`
- `server_emojis`
- `server_stickers`
- `persona_sprites`
- `preset_sprites`

### Permissions/privacy/routing

- `personalization_blacklist`
- `persona_user_blocks`
- `personal_spotlights`
- `personal_spotlight_personas`
- `channel_persona_whitelist`
- `channel_whitelist`
- `channel_llm_overrides` (per-channel model override)
- `channel_prompt_overrides` (per-channel system prompt override)
- `role_whitelist`

### Ops and reliability

- `cooldowns` (UNLOGGED)
- `reminders`
- `error_logs`
- `opt_api_keys`
- `api_key_rotation` (config/credentials only)
- `api_key_rotation_runtime_state` (telemetry: usage, errors, cooldown — excluded from export)
- `persona_autoch_runtime_state` (autochat counters per persona — excluded from export)
- `saved_provider_configs`
- `user_saved_provider_configs`
- `custom_endpoints`
- `openrouter_model_registrations`
- `openrouter_embedding_model_registrations`
- `openrouter_image_model_registrations`
- `openrouter_video_model_registrations`

### Quota system

- `image_quota_configs`
- `image_quotas`
- `image_serverwide_quotas`
- `text_quota_configs`
- `text_quotas`
- `text_serverwide_quotas`
- `video_quota_configs`
- `video_quotas`
- `video_serverwide_quotas`

### Bridge integration

- `matrix_channel_links`

## Optional RAG Tables

When enabled (production, or non-production with pgvector detected):

- `documents`
- `document_chunks`

Also requires pgvector (`CREATE EXTENSION IF NOT EXISTS vector`).

## Notable Data Model Decisions

### Multi-persona

- `personas` now supports multiple personas per server (`is_alter` flag).
- `persona_lineage_id` supports cross-server memory identity matching.
- `persona_attributes` is the source of truth for ordered persona attributes and their `is_public` visibility flag. `personas.attribute_list` remains as a denormalized text-array mirror for older import/export and status surfaces. Native preset/card data stores aligned `attribute_public_flags`; missing flags from legacy files are normalized to all-private rows on import.
- Official rows in `persona_presets` carry `preset_lineage_id` as a stable identity anchor for each bundled character. Applying an official preset (`/config setup`, `/persona default`) creates a copy-on-write pointer when possible: `personas.is_pointer = true`, with `personas.preset_lineage_id` and `personas.preset_language` resolving the live `persona_presets` row. The first local content edit materializes the persona into an independent copy while preserving `persona_id` and `persona_lineage_id`.
- `persona_presets.preset_attribute_public_flags` stores boolean visibility flags aligned to `preset_attribute_list`; official appearance attributes are public by default. Pointer personas resolve these flags from the live preset row, while materialized/imported copies store them in `persona_attributes.is_public`.
- `persona_sprites` stores named sprite avatars for render-modifier labels such as `Tomori (mad):`. Rows are keyed by `(persona_id, sprite_key)`, cascade with the persona, and store `avatar_url` as either a production public object URL or a local development path under `data/avatars/servers/{serverDiscId}/personas/{personaId}/sprites/`. The `is_identity` boolean (default `false`, added in migration `029`) controls webhook rendering: ordinary sprites show the clean persona name, while identity sprites show the decorated `sprite (Persona)` name directly in Discord (DID alter style). `/persona sprites add` (with the **Save as Identity** checkbox), `/persona sprites edit` (metadata plus optional image replacement), and `/persona sprites remove` are the owner commands. `/persona sprites export` and `/persona sprites import` move a persona's whole sprite set between servers as a `.zip` (manifest + images); import overwrites same-key rows and rejects the batch if it would exceed the per-persona cap.
- `preset_sprites` stores the official, SHARED sprite set for bundled characters, keyed by `(preset_lineage_id, preset_language, sprite_key)` and seeded from the persona catalog (migration `032`). Its `avatar_url` is a shared object-storage reference under the immutable `presets/` prefix (uploaded once, used by every server). Pointer personas resolve their sprites live from here via `PersonaSpriteRepository.listForPersona()`; materialization copies these rows into `persona_sprites` by reference (shared URL, no byte duplication). The per-persona delete paths never delete `presets/` images. See [persona-presets](persona-presets) and [multi-persona](multi-persona).
- `persona_sprite_messages` maps a sprite-rendered webhook message (`message_disc_id` PK) to the `sprite_name` it displayed. Sprite messages show the clean persona name in Discord; context rebuilding uses this mapping to recover the decorated `Name (sprite):` label for the model. Rows are immutable, cascade with the persona, and are pruned after `PERSONA_SPRITE_MESSAGE_RETENTION_DAYS` (default 30) via an opportunistic write-path prune.
- Persona names are constrained unique per server (case-insensitive, trimmed).
- Exactly one non-alter persona (`is_alter = false`) per server is enforced by partial unique index `personas_one_main_per_server ON personas(server_id) WHERE is_alter = false` (added in Phase 6 Step #14.6, migration `012`). This hardens the invariant that was previously enforced only at the command layer.
- `persona_configs.reward_conditioning_enabled` and `persona_configs.punish_conditioning_enabled` are persona-scoped prompt-injection toggles for conditioning memory.

### Server config scoping

`tomori_configs` was dropped in Phase 6 Step #14 (migration `008`). Per-server configuration is now owned by 14 command-aligned split tables. Column mapping for notable fields:

- `server_chat_configs.message_fetch_limit` stores the per-server context fetch cap (default `80`, configurable via `/config message-fetch-limit`).
- `server_chat_configs.match_limit` and `server_chat_configs.cascade_limit` store the per-message persona trigger cap and the session cascade limit respectively.
- `server_chat_configs.llm_stop_strings` and `server_chat_configs.llm_stop_speaker_pattern_enabled` store server-wide stop-string settings applied to every text provider. The speaker-pattern flag defaults to `false`, so `\n{Name}:` generation stops are opt-in.
- `server_chat_configs.llm_logit_biases` stores server-wide logit-bias entries as raw text/token-ID input plus tokenizer-specific cached resolutions. Raw text stays canonical so entries can be refreshed when `llm_id` changes.
- `server_chat_configs.context_note` stores the server-wide author's note injected into conversation history at inference time. Acts as a fallback when the active persona has no persona-specific note.
- `server_chat_configs.context_note_depth` stores the injection depth for the global note: `0` = bottom of fetched history (most recent), `N` = N messages from the bottom, clamped to top if it exceeds the actual count.
- `server_chat_configs.model_randomizer_enabled` (BOOLEAN, default `false`) toggles the per-turn text model randomizer (`/config model-randomizer`). When `true`, each generation turn randomly promotes one member of the pool (primary model + configured fallbacks) to lead the attempt list; the rest stay as failover. Enabling is gated on ≥1 configured fallback so the pool always has ≥2 members. See [generation-turn pipeline](../pipelines/chat/06-per-turn/03-run-generation-turn).
- `server_model_configs.thinking_level` stores the active text provider's mirrored reasoning preference (`auto`, `none`, `low`, `medium`, `high`). This is a deprecated Phase 1.5 mirror; it remains on the active runtime config while provider-specific snapshots live in `saved_provider_configs`.
- `server_model_configs.diffusion_model_id` stores the active standard image generation model; `NULL` means standard image generation is disabled until a model is explicitly selected again.
- `server_model_configs.vision_llm_id` stores the dedicated vision model for non-vision chat models; `NULL` means no vision tool is available. When set, the `analyze_image` tool is exposed so non-vision models can delegate image analysis to this model.
- `server_model_configs.video_model_id` stores the active server-scoped video generation model selection; `NULL` means video generation is disabled until a model is explicitly selected again.
- `server_channel_scope_configs.thought_log_channel_disc_id` stores the optional server-scoped channel where provider reasoning summaries are posted after successful streamed chat turns.
- `server_channel_scope_configs.crosschannel_blocklist_ids` stores the server-scoped channel blocklist for tool-driven `cross_channel_message` dispatch. Blocking a forum/media parent also blocks visits into threads under that parent.
- `channel_prompt_overrides` (`(server_id, channel_disc_id)` PK) stores the optional per-channel system prompt set by `/server channel-prompt`. `channel_prompt_mode` is `append` (the prompt is injected as a distinct `SYSTEM_CHANNEL_PROMPT` block after the server system prompt) or `replace` (the prompt takes over the system-prompt slot). Persona prompt and persona attributes are never affected. Resolved per request via `getCachedChannelPrompt` (TTL cache with negative caching). Per-channel data is server-local and is not exported.
- `server_welcome_configs.welcome_channel_disc_id` stores the single configured join-welcome channel per server.
- `server_welcome_configs.welcome_prompt` stores the required additional greeting instruction shown in `/server welcome-channel set`.
- `server_welcome_configs.welcome_persona_id` stores the selected welcome persona; `NULL` means random persona selection per join.
- `server_auto_trigger_persona_overrides` (junction table, Phase 6 step #15) stores optional per-channel persona overrides for auto-trigger channels. Each row maps `(server_id, channel_disc_id)` → `persona_id` (FK to `personas(persona_id)` with `ON DELETE CASCADE`). Missing entries fall back to the main persona. The assembled config exposes these as `autoch_persona_overrides: [{channel_disc_id, persona_id}]` via a `JSON_AGG` subquery in `PersonaRepository`.
- `server_notice_embeds_configs.tool_notice_hidden_keys` stores the hidden notice-embed key registry used by `/config notice-embeds visibility`, covering both tool progress notices and selected public command notice embeds.
- `server_novelai_imagegen_configs.image_default_positive_tags` stores server-wide default positive image tags. `generate_image` injects them as prompt style guidance; NovelAI tag paths prepend them as trusted positive tags.
- `server_novelai_imagegen_configs.image_default_negative_tags` stores server-wide default negative image tags. NovelAI consumes them as the negative prompt, while standard image providers consume them only when the backend exposes a real negative-prompt channel.
- `server_novelai_imagegen_configs.nai_diffusion_model_id` stores the dedicated NovelAI image-model selection for `generate_image_nai`; `NULL` means NovelAI image generation is disabled until a NovelAI model is explicitly selected again.
- `server_novelai_imagegen_configs.nai_sampler`, `nai_steps`, `nai_scale`, `nai_noise_schedule`, and `nai_cfg_rescale` store optional server overrides for NovelAI image generation params; `NULL` means use the env fallback.
- `server_member_permissions_configs.self_teaching_enabled` and `server_member_permissions_configs.personal_memories_enabled` are exposed in `/capabilities manage` because they gate core bot behavior, but they remain in the member-permissions split table with the other teaching/privacy toggles.
- `server_capabilities_configs.videogen_enabled` gates both slash-command and tool-driven video generation exposure. The DB default is `false`, so video generation starts disabled until explicitly enabled.
- `server_capabilities_configs.user_blocking_enabled` gates the `block_user` and `unblock_user` built-in tools. The DB default is `true`.
- `persona_user_blocks` stores active persona-scoped mutes/blocks keyed by `(server_id, persona_id, user_disc_id)`, with `block_type` (`mute` or `block`), `reason`, and `expires_at`. Expired rows are ignored by repository reads. The table is intentionally separate from `personalization_blacklist`.
- `persona_context_note_configs.context_note` stores a per-persona author's note. Takes priority over `server_chat_configs.context_note` at inference when non-null.
- `persona_context_note_configs.context_note_depth` stores the injection depth for the persona-specific note, using the same semantics as `server_chat_configs.context_note_depth`.

### Server config export/import

`/server config export` and the legacy full-server export keep the historical flat JSON payload for file compatibility, but `serverConfigExportSchema` is now composed from per-table export slices in `src/types/db/dataExport.ts`. Each slice maps to one split config table, with explicit exclusions for non-portable Discord IDs, server-local model/provider pointers, encrypted credentials, legacy migration fields, and runtime state.

`ExportRepository.exportServerData()` reads the split tables directly and emits the flat composed shape. `ImportRepository.importServerConfig()` partitions that same flat payload back into split-table patch objects and writes through the typed `ConfigRepository.update*Config()` methods; all required and optional split-table update results must succeed before the import reports success and invalidates the Tomori state cache.

`scripts/checks/checkSchemaDrift.ts` validates export coverage per split config table rather than comparing against a `tomori_configs` mirror. It also verifies that `serverConfigExportSchema` is exactly the union of the per-table export slices and that every exported key is selected, emitted, and restored. Runtime-state tables such as `api_key_rotation_runtime_state` and `persona_autoch_runtime_state` remain explicitly excluded from export/import.

### Image tags and NovelAI references

- `personas.physical_appearance_tags` stores public per-persona physical appearance image tags configured by `/persona image-tags`.
- `personas.nai_char_ref_url` stores the persisted persona reference image URL/path used by the `/novelai character-reference` workflow.
- `users.physical_appearance_tags` stores public per-user physical appearance image tags keyed by Discord snowflake (`users.user_disc_id`) and configured by `/personal image-tags`.
- `users.nai_char_ref_url` stores the persisted user reference image URL/path keyed by Discord snowflake.

### User personalization

- `users.impersonation_prompt` stores the global user-owned prompt used during `/bot impersonate` user impersonation replies.

### Personal spotlight routing

- `personal_spotlights` stores one user-scoped spotlight row per `server_id + user_id + channel_disc_id`.
- `personal_spotlights.auto_trigger_persona_id` stores the optional persona automatically triggered for that user in that channel.
- `personal_spotlights.expires_at` is `NULL` for permanent spotlights and timestamped for timed spotlights.
- `personal_spotlight_personas` stores the selected allowed persona set for each spotlight row.
- Runtime reads `personal_spotlights` + `personal_spotlight_personas` together and intersects them with server whitelist rules, so personal spotlight never expands server-level access.

### Memory split

- `server_memories`: shared server-level memory
- `personal_memories`: user + persona lineage scoped memory
- `conditioning_history`: server + persona lineage scoped reward/punish reinforcement history

### Conditioning history

- `conditioning_history` stores behavioral reinforcement events from `/conditioning reward` and `/conditioning punish`.
- Rows are grouped logically by `server_id + persona_lineage_id + conditioning_type + action_key + reason_normalized`.
- The physical uniqueness constraint is further scoped by `user_id`, so repeated actions by the same user increment `count` while different users still aggregate at read time.
- Empty `reason_text` values are allowed and stored, but those rows are intentionally excluded from prompt injection.

### Cooldown storage

`cooldowns` uses explicit scope columns:

- `cooldown_type`
- `server_disc_id`
- `user_disc_id`
- `channel_disc_id`
- `command_category`
- `expiry_time`

`channel_whitelist` stores optional per-channel cooldown overrides:

- `cooldown_type` / `cooldown_length` both `NULL` -> inherit the server-wide cooldown
- `cooldown_type` / `cooldown_length` both set -> override the server-wide cooldown for that channel

`channel_persona_whitelist` stores persona-specific channel restrictions:

- rows are keyed by `server_id + channel_disc_id + persona_id`
- if a persona has one or more rows, that persona is only eligible in those channels
- if a persona has no rows, that persona remains eligible in all channels
- thread checks inherit parent-channel entries when evaluating a restricted persona

### API key security

Encrypted columns are stored as `BYTEA` with key version tracking:

- `server_model_configs.api_key` + `server_model_configs.key_version` *(deprecated Phase 1.5 runtime mirror; provider snapshot keys are canonical in `saved_provider_configs`)*
- `opt_api_keys.api_key` + `opt_api_keys.key_version`
- `api_key_rotation.api_key` + `api_key_rotation.key_version` (telemetry split to `api_key_rotation_runtime_state` by migration 014)
- `saved_provider_configs.api_key` + `saved_provider_configs.key_version`
- `saved_provider_configs.thinking_level` mirrors `server_model_configs.thinking_level` so provider switching can restore the previous provider-specific reasoning preference.
- `saved_provider_configs.fallback_model_refs` and `user_saved_provider_configs.fallback_model_refs` store ordered polymorphic fallback references as JSON objects shaped like `{type: "llm" | "custom_endpoint", id: number}`. The legacy `fallback_llm_ids` column was dropped by migration 011 (Phase 6 Step #14.5); `fallback_model_refs` is now the sole source of truth.
- `custom_endpoints` stores labeled self-hosted or proxy-backed endpoint registrations. Rows are scoped either to `server_id` or `user_id` and carry adapter metadata such as `api_style`, `endpoint_url`, `model_name`, capability flags, workflow JSON or speech/STT adapter options (`extra_config`), `is_default`, and whether auth is required. Uniqueness is `(scope, label, capability, COALESCE(model_name, ''))` via scoped partial unique indexes (migration 024), so one labeled connection may host **several models of the same capability** distinguished by `model_name` (at most one unnamed model per capability). `model_ref_id` links each row to the synthetic model it owns (`llms` / `embedding_models` / `image_diffusion_models` / `video_generation_models`, chosen by `capability`); the runtime uses it to resolve the active model back to its exact endpoint when a label hosts multiple models — see `resolveCustomEndpointForProvider(provider, capability, activeModelId)`. Text endpoints also carry `strict_role_alternation` and `supports_prefix_completion` (migration 025), synced to the synthetic `llms` row so the runtime resolves them uniformly with built-in providers — see [`subsystems/strict-chat-completion.md`](./strict-chat-completion). The same two columns exist on `llms`, where built-in providers seed the required defaults (anthropic → alternation; deepseek/zai/zaicoding → prefix), enforced by `bun run check-seed-catalogs`.
- `llms.input_price_per_million` and `llms.output_price_per_million` hold each model's official USD-per-million-token price (uncached standard rate), seeded from the typed catalog (`src/db/seed/catalog/models.ts`). Both are **nullable**: NovelAI / NVIDIA-free / `custom` / Gemma / `:free` rows are non-metered, and `gemini-3.5-pro` / `gemini-3-flash` stay NULL until Google publishes a rate. `/tool estimate cost` resolves price through `resolveModelPricing`:
  - **First-party providers** (google/vertex/vertexexpress/anthropic/deepseek/zai/zaicoding) are **DB-only** — the column is the sole source of truth. The old `HELP_COST_*` env constants and the Anthropic codename-sniffing tier guess were removed; a row with no price now reports **"pricing unavailable"** rather than billing a coarse fallback.
  - **OpenRouter** is priced **live-first** from the OpenRouter API cache (`getOpenRouterPricing`), which auto-updates with OpenRouter's rates. A catalog price on an OpenRouter row is only a **cache-miss fallback** — used solely when the live cache has no entry for that model. `other-model` (arbitrary user codename) stays NULL.
  - `bun run check-seed-catalogs` enforces that every active, billable first-party row carries both prices (`collectMeteredPriceViolations` in `modelSeed.ts`), excluding deprecated / Gemma / `isFree` / pricing-pending rows.

  Prices live on the row (not in code), so registering a model's cost is a one-line catalog edit re-seeded on boot. See the command at `src/commands/tool/estimate/cost.ts`.
- `voice_samples` stores server-scoped reference audio metadata for local speech cloning. `file_path` is a production S3/CloudFront URL or a local `data/voice-samples/` path. Phase 4 allows one uploaded local sample per server.
- `server_speech_configs.chatterbox_turbo_enabled`, `chatterbox_cfg_weight`, and `chatterbox_exaggeration` store server-scoped Chatterbox speech settings. CFG weight and exaggeration are forwarded to local TTS clone endpoints but only affect the bundled Chatterbox server when Turbo is disabled.
- `personas.speech_voice_sample_id`, `personas.speech_voice_id`, and `personas.speech_voice_name` store per-persona voice assignment for local clone samples and provider-hosted voices. The legacy `elevenlabs_voice_*` columns were dropped by migration 010 (Phase 6 Step #14.2); `speech_voice_id` is now the sole voice identifier.
- `openrouter_model_registrations` scopes extra OpenRouter text `llms` rows to a specific `server_id` or `user_id`.
- `openrouter_embedding_model_registrations`, `openrouter_image_model_registrations`, and `openrouter_video_model_registrations` do the same for `embedding_models`, `image_diffusion_models`, and `video_generation_models`.
- All four backing model tables use `is_scoped_registration = true` on those extra rows so they stay hidden from global provider pickers unless joined through a matching registration for that owner.

### Logit bias snapshot storage

- `saved_provider_configs.llm_logit_biases` mirrors `server_chat_configs.llm_logit_biases` so provider snapshots can restore both the original text entries and any cached tokenizer-family resolutions.
- This keeps `/config provider switch` compatible with text-first logit-bias UX across model changes while `/config provider add` can seed saved-provider defaults without disturbing the active text stack.

### Provider snapshot model storage

- `saved_provider_configs.video_model_id` mirrors the last saved video model for that provider so capability-specific cleanup and future migrations can reason about prior selections; Phase 1 provider switching does not automatically restore video model slots.
- `saved_provider_configs.provider` and `user_saved_provider_configs.provider` may now hold internal custom provider IDs (`custom:s<server_id>:<label>` / `custom:u<user_id>:<label>`) so labeled custom endpoints can coexist side-by-side without colliding with each other or with classic providers.
- Phase 6 Step #16 audited `saved_provider_configs` for runtime telemetry analogous to key-rotation counters/errors. None was found: `consecutive_failures` does not exist on this table, and the remaining fields are credentials or provider/model/sampler snapshots. No runtime-state split is pending for saved provider configs.

### Runtime state tables (Phase 6 Step #16)

Two runtime-state tables hold high-frequency telemetry that does not belong in identity or config rows. Both are **excluded from export** (drift-checker exemption list).

| Table | FK → | Holds | Added |
|---|---|---|---|
| `api_key_rotation_runtime_state` | `api_key_rotation(rotation_key_id)` | `usage_count`, `error_count`, cooldown timestamps | migration 014 |
| `persona_autoch_runtime_state` | `personas(persona_id)` | `autoch_counter`, `autoch_next_target` | migration 015 |

**`persona_autoch_runtime_state`** — FK column is `persona_id` (same pattern as `server_auto_trigger_persona_overrides`). Mutated on every message processed by the autochat tick via UPSERT (`ConfigRepository.incrementTomoriCounter`). ON DELETE CASCADE ensures runtime cleanup is atomic with persona deletion. New personas auto-initialize on first UPSERT; the state is also loaded during `PersonaRepository.loadTomoriState` and batch-loaded by `loadAllPersonasForServer`. `TomoriState.autoch_counter` and `TomoriState.autoch_next_target` are sourced from this table, not from `personas`.

### Stat tracking (usage telemetry, migration 035)

`stat_counters` is high-frequency usage telemetry and shares the runtime-state class: it cascades on its FKs and is **excluded from export** (same drift-checker exemption list as the `*_runtime_state` tables, even though its name omits the `_runtime_state` suffix because it is a per-day counter table, not a single-row state row). Owned by `StatRepository`. See `plans/stat-tracking.md` for the full design.

It is a **long/narrow, pre-aggregated counter table** — one row per `(server_id, user_id, persona_lineage_id, metric, metric_key, bucket)`, incremented by additive UPSERT, never an event log. A day of N events for one tuple is one row with `count = N`.

| Column | Notes |
|---|---|
| `server_id` / `user_id` | NOT NULL FKs (`ON DELETE CASCADE`). `user_id` is the internal users id, never the Discord snowflake. |
| `persona_lineage_id` | `BIGINT NOT NULL DEFAULT 0`. Cross-server persona anchor (mirrors `personal_memories` / `conditioning_history`). `0` sentinel = persona-agnostic metric. |
| `metric` / `metric_key` | Metric name + sub-key (command name, model id, hour, or `''`). Catalog: `src/constants/statMetrics.ts`. |
| `bucket` | Plain `DATE` (daily grain). Weeks/months/all-time compose via `SUM`; a future downsampling job needs no schema change. |
| `count` | `BIGINT` generic accumulator — events add 1, token metrics add the token delta. |

Key behaviors:

- **Buffered writes.** `StatRepository.recordStat(...)` accumulates deltas in an in-memory `Map` keyed by the PK tuple; `flush()` drains them as one additive UPSERT per distinct tuple (`count = count + EXCLUDED.count`). Flush triggers: interval (`STAT_FLUSH_INTERVAL_MS`), size cap (`STAT_FLUSH_MAX_BUFFER`), and graceful shutdown (`statRepository.shutdown()` from the SIGINT/SIGTERM handler). A hard crash loses only the unflushed buffer — accepted tradeoff for aggregate telemetry. Kill switch: `STAT_TRACKING_ENABLED`.
- **No mutating-column indexes.** Secondary indexes cover only the stable dimension columns; `count` / `last_at` are never indexed so hot counter rows keep Postgres HOT updates. "Top N" is sorted at read time.
- **Reads** (`getFavoritePersona`, `getTopCommands` / `getUnusedCommands`, `getModelBreakdown`, `getEstimatedCost`, `getActivityHistogram`, `getStreak`) are windowed by `bucket >= from` + `SUM` and hit the DB directly (no read cache in Phase 1). Read-existing wrappers (`getGenerationTotals`, `getConditioningTotals`) aggregate the quota / `conditioning_history` tables instead of double-tracking.
- **Instrumented chokepoints:** `command_used` (command dispatch), `message_sent` / `active_hour` / `model_used` / `tokens_in` / `tokens_out` / `emoji_used` / `sprite_shown` (post-turn effects), `tool_used` (single tool-dispatch chokepoint; per-tool breakdown via `metric_key`). `tokens_in` / `tokens_out` are **character-estimated** (the Track-A fallback shared with `/tool estimate cost` via `@/utils/text/tokenEstimate` — input from the built context, output from the response text; over-counts dense languages, for rough stats/cost only). `emoji_used` counts resolved `<:name:id>` tags scanned from the final persona text; `sprite_shown` is surfaced from the stream via `StreamResult.spritesShown` (the stream layer has no internal user id, so attribution happens post-turn). `sticker_used` is emitted at the tool-dispatch chokepoint alongside `tool_used`, keyed by the canonical resolved sticker name from the tool result (per-sticker breakdown; `tool_used` still counts the call). Still reserved (no dedicated emit): the split-out `web_search` / `memory_taught` / `reminder_set` metrics, currently captured under `tool_used` by name.

## Migration System (Phase 6+)

### Overview

TomoriBot has two complementary schema mechanisms:

| Mechanism | File | Runs | Purpose |
|---|---|---|---|
| Pre-schema legacy rename bridge | Selected rename migrations called by `initializeDatabase.ts` | Before static schema, only when legacy tables are detected | Preserve data for table renames where the latest static schema would otherwise create the target table first |
| Static schema init | `schema.sql`, `schema_rag.sql`, `schema_stpreset.sql`, typed seed catalogs (`src/db/seed/catalog/`) | Every boot (idempotent) | Baseline tables, functions, reference seed data |
| Migration runner | `src/db/migrations/NNN_*.sql` | Once per version (tracked) | Structural changes that cannot be idempotent (DROP, RENAME, table splits) |

`initializeDatabase.ts` first runs narrow legacy rename bridges for known table renames such as
`serverwide_quotas` -> `image_serverwide_quotas` and `tomoris` -> `personas` when the old tables are present.
This prevents the latest static schema from creating an empty target table before the rename can preserve existing
rows. The normal migration runner (`src/db/migrationRunner.ts`) is still called after the static schema files have
applied and records the migration as usual.

On a clean fresh install, `schema.sql` already represents the latest schema snapshot. Startup records all historical
migration names in `schema_migrations` without replaying their backfill/drop bodies, because those bodies depend on
legacy source tables that correctly do not exist in a fresh database.

Applied migrations are tracked in the `schema_migrations` table:

```sql
schema_migrations (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        UNIQUE NOT NULL,   -- e.g. "002_split_tomori_configs"
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

### File naming convention

```
src/db/migrations/
  001_baseline.sql                      ← marker migration (no executable SQL)
  001_baseline.down.sql                 ← paired rollback
  002_server_config_tables.sql          ← server_*_configs Stage A expand
  002_server_config_tables.down.sql
  003_persona_config_tables.sql         ← persona_*_configs Stage A expand
  003_persona_config_tables.down.sql
  004_user_personalization_configs.sql  ← user_personalization_configs Stage A expand
  004_user_personalization_configs.down.sql
  ...
```

- Names must match `NNN_description.sql` (3-digit zero-padded version, lowercase, underscores).
- Every up-migration **must** ship with a paired `.down.sql` rollback file.
- `bun run check-migrations` (also part of `bun run vl`) verifies pairing and fails CI if any rollback is missing.

### Running migrations manually

Migrations run automatically at bot startup via `initializeDatabase`. If you need to apply migrations without starting the bot (e.g. troubleshooting), invoke the script directly:

```sh
bun run scripts/db/migrate.ts
```

### Rollback discipline

- Every migration ships with either a paired `.down.sql` that reverses the change in one transaction, or a documented "if this fails, here's how to recover" runbook in the migration's PR description.
- For destructive migrations (`DROP COLUMN`, `DROP TABLE`): require a soak period of at least one release where the column/table is unused but still present, so rollback is a code revert rather than a data restore.
- Forward-only migrations on shared tables are not acceptable — they turn every deployment into a one-way door.

### When to use migrations vs. seed catalogs

Use **`src/db/seed/catalog/*.ts`** (idempotent, runs every boot through `initializeDatabase.ts`) for:
- Upserting lookup/reference data such as model catalogs, bundled persona presets, system prompts, and NovelAI presets
- Maintaining derived reference fields that must track the bundled seed rows on every startup

The catalog seeders render the same idempotent `INSERT … ON CONFLICT` upserts in code.
Startup order is models (`seedModelsFromCatalog`) → personas (`seedPersonasFromCatalog`)
→ preset sprites (`seedPersonaSpritesFromCatalog`) → preset avatars (`seedPersonaAvatarsFromCatalog`)
→ system prompts (`seedSystemPromptsFromCatalog`) → NovelAI presets (`seedNaiPresetsFromCatalog`).
The avatar seed (migration 033) uploads each persona's avatar once to the shared `presets/`
prefix and records `persona_presets.preset_avatar_shared_url` + `preset_avatar_hash`; pointer
alters live-resolve the URL and the main-avatar reconciler gates guild-avatar PATCHes on the
hash (`personas.applied_avatar_hash`). The order is enforced by `check-seed-catalogs`.
There are no startup seed `.sql` files; edit the typed catalog and the change is seeded on
the next boot. Invariants are validated on startup and via `bun run check-seed-catalogs`.
`seedPersonasFromCatalog()` also preserves the derived `official_attribute_flags` update
for official persona attribute visibility flags.

The persona upsert keys on the stable `(preset_lineage_id, preset_language)` pair, not on
`persona_preset_name`. `persona_preset_name` is a mutable, human-facing catalog label, so it
is a normal updated column: renaming a preset is a one-line edit to the catalog `name` field
that resolves to the existing lineage/language row and updates the label in place on the next
boot — no rename bridge or migration required. (Keying on the name would instead orphan the
old row, create a duplicate, and collide with `idx_persona_presets_lineage_language_unique`,
aborting the whole batch INSERT.)

Use a **numbered migration** for:
- Adding new columns that older installations need before or after a rollout
- `DROP COLUMN` / `DROP TABLE`
- `ALTER TABLE ... RENAME`
- Creating new tables that are part of a schema split
- One-time legacy data backfills or any change that should not rerun on every boot

### Static schema (idempotent baseline)

The static files are startup-safe:

- `CREATE TABLE IF NOT EXISTS`
- Helper functions: `add_column_if_not_exists`, `drop_column_if_exists`
- Guarded `DO $$ ... $$` blocks for conditional constraint/index/column changes

Startup schema execution is shared through `src/utils/db/initializeDatabase.ts`. The bot entry point and
`bun run db:lifecycle` both use this path, so fresh-install validation exercises the same schema, optional RAG schema,
ST preset schema, typed catalog seeds, and migration marker behavior as runtime startup.

## Operational Notes

- `cleanup_expired_cooldowns()` is defined in schema and used by startup cleanup + optional pg_cron.
- Quota cleanup helpers exist for old image/text/video quota rows (`cleanup_old_image_quotas()`, `cleanup_old_text_quotas()`, `cleanup_old_video_quotas()`).
- RAG tables are intentionally separate so local development can run without pgvector unless enabled.
- `bun run db:lifecycle` creates a disposable database on the configured local PostgreSQL server, validates fresh schema/seed initialization twice, smoke-tests backup/restore and DB maintenance scripts, runs `nuke-db` against only that disposable DB, and verifies re-initialization afterward.
