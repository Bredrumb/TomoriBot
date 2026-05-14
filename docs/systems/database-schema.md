<!-- ARCH-ALIGNMENT: prereq-phase-5.5b -->

# 5. Database Schema and Data Model

This document summarizes the current PostgreSQL schema used by TomoriBot.

## Schema Sources

- Main schema: `src/db/schema.sql`
- RAG schema: `src/db/schema_rag.sql` (loaded only when RAG is enabled)

## Data Access Boundary

The Phase 2 repository layer lives under `src/utils/db/repositories/`. Repositories group reads/writes by domain (`UserRepository`, memory repositories, `ConfigRepository`, `PersonaRepository`, `ServerRepository`, `LlmRepository`, `ToolRepository`, `RagRepository`, and `ImportExportRepository`) and implement the shared `IRepository<TExport>` contract.

Application code imports the repository facade rather than raw DB entry points. The former public DB god files (`dbRead.ts`, `dbWrite.ts`, `dataExport.ts`, and `dataImportV2.ts`) have been removed. Repository SQL is split into domain-owned modules under `src/utils/db/repositories/*Sql.ts`; `repositoryReadSql.ts` and `repositoryWriteSql.ts` remain only as compatibility barrels during the Phase 6 cleanup window.

## Main Tables (Current)

### Core identity/config

- `servers`
- `tomoris`
- `tomori_configs`
- `persona_configs`
- `users`

### Model registries

- `llms`
- `image_diffusion_models`
- `video_generation_models`
- `embedding_models`

### Presets and prompts

- `tomori_presets`
- `system_prompt_presets`

### Memory and expression data

- `server_memories`
- `personal_memories`
- `conditioning_history`
- `server_emojis`
- `server_stickers`

### Permissions/privacy/routing

- `personalization_blacklist`
- `personal_spotlights`
- `personal_spotlight_personas`
- `channel_persona_whitelist`
- `channel_whitelist`
- `role_whitelist`

### Ops and reliability

- `cooldowns` (UNLOGGED)
- `reminders`
- `error_logs`
- `opt_api_keys`
- `api_key_rotation`
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
- `serverwide_quotas`
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

- `tomoris` now supports multiple personas per server (`is_alter` flag).
- `persona_lineage_id` supports cross-server memory identity matching.
- Persona names are constrained unique per server (case-insensitive, trimmed).
- `persona_configs.reward_conditioning_enabled` and `persona_configs.punish_conditioning_enabled` are persona-scoped prompt-injection toggles for conditioning memory.

### Server config scoping

- `tomori_configs.server_id` is the primary modern scope.
- `tomori_configs.tomori_id` remains as a nullable legacy pointer.
- `tomori_configs.message_fetch_limit` stores the per-server context fetch cap (default `80`, configurable via `/config message-fetch-limit`).
- `tomori_configs.thinking_level` stores the active text provider's mirrored reasoning preference (`auto`, `none`, `low`, `medium`, `high`) as managed through `/config samplers`.
- `tomori_configs.llm_stop_strings` and `tomori_configs.llm_stop_speaker_pattern_enabled` store server-wide stop-string settings applied to every text provider. The speaker-pattern flag defaults to `false`, so `\n{Name}:` generation stops are opt-in.
- `tomori_configs.welcome_channel_disc_id` stores the single configured join-welcome channel per server.
- `tomori_configs.thought_log_channel_disc_id` stores the optional server-scoped channel where provider reasoning summaries are posted after successful streamed chat turns.
- `tomori_configs.autoch_persona_overrides` stores optional per-channel persona assignments for configured auto-trigger channels. Each entry is a JSON object with `channel_disc_id` and `tomori_id`; missing entries fall back to the main persona.
- `tomori_configs.crosschannel_blocklist_ids` stores the server-scoped channel blocklist for tool-driven `cross_channel_message` dispatch. Blocking a forum/media parent also blocks visits into threads under that parent.
- `tomori_configs.welcome_prompt` stores the required additional greeting instruction shown in `/server welcome-channel set`.
- `tomori_configs.welcome_persona_id` stores the selected welcome persona; `NULL` means random persona selection per join.
- `tomori_configs.tool_notice_hidden_keys` stores the hidden notice-embed key registry used by `/config notice-embeds visibility`, covering both tool progress notices and selected public command notice embeds.
- `tomori_configs.nai_style_tags` stores server-wide NovelAI style/quality tags prepended to every `generate_image_nai` prompt.
- `tomori_configs.nai_negative_tags` stores server-wide NovelAI negative tags; an empty array falls back to the `NAI_IMAGE_NEGATIVE_PROMPT` env value.
- `tomori_configs.diffusion_model_id` stores the active standard image generation model; `NULL` means standard image generation is disabled until a model is explicitly selected again.
- `tomori_configs.nai_diffusion_model_id` stores the dedicated NovelAI image-model selection for `generate_image_nai`; `NULL` means NovelAI image generation is disabled until a NovelAI model is explicitly selected again.
- `tomori_configs.nai_sampler`, `nai_steps`, `nai_scale`, `nai_noise_schedule`, and `nai_cfg_rescale` store optional server overrides for NovelAI image generation params; `NULL` means use the env fallback.
- `tomori_configs.vision_llm_id` stores the dedicated vision model for non-vision chat models; `NULL` means no vision tool is available. When set, the `analyze_image` tool is exposed so non-vision models can delegate image analysis to this model.
- `tomori_configs.llm_logit_biases` stores server-wide logit-bias entries as raw text/token-ID input plus tokenizer-specific cached resolutions. Raw text stays canonical so entries can be refreshed when `llm_id` changes.
- `tomori_configs.videogen_enabled` gates both slash-command and tool-driven video generation exposure. The DB default is `false`, so video generation starts disabled until explicitly enabled.
- `tomori_configs.video_model_id` stores the active server-scoped video generation model selection; `NULL` means video generation is disabled until a model is explicitly selected again.
- `tomori_configs.context_note` stores the server-wide author's note injected into conversation history at inference time. Acts as a fallback when the active persona has no persona-specific note.
- `tomori_configs.context_note_depth` stores the injection depth for the global note: `0` = bottom of fetched history (most recent), `N` = N messages from the bottom, clamped to top if it exceeds the actual count.
- `tomoris.context_note` stores a per-persona author's note. Takes priority over `tomori_configs.context_note` at inference when non-null.
- `tomoris.context_note_depth` stores the injection depth for the persona-specific note, using the same semantics as `tomori_configs.context_note_depth`.

### NovelAI profile tags

- `tomoris.nai_tags` stores per-persona NovelAI character tags.
- `tomoris.nai_char_ref_url` stores the persisted persona reference image URL/path used by the `/novelai character-reference` workflow.
- `users.nai_char_tags` stores per-user NovelAI character tags keyed by Discord snowflake (`users.user_disc_id`).
- `users.nai_char_ref_url` stores the persisted user reference image URL/path keyed by Discord snowflake.

### User personalization

- `users.impersonation_prompt` stores the global user-owned prompt used during `/bot impersonate` user impersonation replies.

### Personal spotlight routing

- `personal_spotlights` stores one user-scoped spotlight row per `server_id + user_id + channel_disc_id`.
- `personal_spotlights.auto_trigger_tomori_id` stores the optional persona automatically triggered for that user in that channel.
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

- rows are keyed by `server_id + channel_disc_id + tomori_id`
- if a persona has one or more rows, that persona is only eligible in those channels
- if a persona has no rows, that persona remains eligible in all channels
- thread checks inherit parent-channel entries when evaluating a restricted persona

### API key security

Encrypted columns are stored as `BYTEA` with key version tracking:

- `tomori_configs.api_key` + `tomori_configs.key_version`
- `opt_api_keys.api_key` + `opt_api_keys.key_version`
- `api_key_rotation.api_key` + `api_key_rotation.key_version`
- `saved_provider_configs.api_key` + `saved_provider_configs.key_version`
- `saved_provider_configs.thinking_level` mirrors `tomori_configs.thinking_level` so provider switching can restore the previous provider-specific reasoning preference.
- `saved_provider_configs.fallback_model_refs` and `user_saved_provider_configs.fallback_model_refs` store ordered polymorphic fallback references as JSON objects shaped like `{type: "llm" | "custom_endpoint", id: number}`. The legacy `fallback_llm_ids` arrays remain during rollout for backward compatibility.
- `custom_endpoints` stores labeled self-hosted or proxy-backed endpoint registrations. Rows are scoped either to `server_id` or `user_id`, keyed by `(scope, label, capability)` through scoped partial unique indexes, and carry adapter metadata such as `api_style`, `endpoint_url`, `model_name`, capability flags, workflow JSON or speech/STT adapter options (`extra_config`), `is_default`, and whether auth is required.
- `voice_samples` stores server-scoped reference audio metadata for local speech cloning. `file_path` is a production S3/CloudFront URL or a local `data/voice-samples/` path. Phase 4 allows one uploaded local sample per server.
- `tomori_configs.chatterbox_turbo_enabled`, `chatterbox_cfg_weight`, and `chatterbox_exaggeration` store server-scoped Chatterbox speech settings. CFG weight and exaggeration are forwarded to local TTS clone endpoints but only affect the bundled Chatterbox server when Turbo is disabled.
- `tomoris.speech_voice_sample_id`, `tomoris.speech_voice_id`, and `tomoris.speech_voice_name` store per-persona voice assignment for local clone samples and provider-hosted voices. Legacy `elevenlabs_voice_*` columns are kept read-only for migration compatibility.
- `openrouter_model_registrations` scopes extra OpenRouter text `llms` rows to a specific `server_id` or `user_id`.
- `openrouter_embedding_model_registrations`, `openrouter_image_model_registrations`, and `openrouter_video_model_registrations` do the same for `embedding_models`, `image_diffusion_models`, and `video_generation_models`.
- All four backing model tables use `is_scoped_registration = true` on those extra rows so they stay hidden from global provider pickers unless joined through a matching registration for that owner.

### Logit bias snapshot storage

- `saved_provider_configs.llm_logit_biases` mirrors `tomori_configs.llm_logit_biases` so provider snapshots can restore both the original text entries and any cached tokenizer-family resolutions.
- This keeps `/config provider switch` compatible with text-first logit-bias UX across model changes while `/config provider add` can seed saved-provider defaults without disturbing the active text stack.

### Provider snapshot model storage

- `saved_provider_configs.video_model_id` mirrors the last saved video model for that provider so capability-specific cleanup and future migrations can reason about prior selections; Phase 1 provider switching does not automatically restore video model slots.
- `saved_provider_configs.provider` and `user_saved_provider_configs.provider` may now hold internal custom provider IDs (`custom:s<server_id>:<label>` / `custom:u<user_id>:<label>`) so labeled custom endpoints can coexist side-by-side without colliding with each other or with classic providers.

## Migration Style

Schema is idempotent and startup-safe:

- `CREATE TABLE IF NOT EXISTS`
- helper functions like `add_column_if_not_exists` and `drop_column_if_exists`
- guarded `DO $$ ... $$` blocks for conditional constraint/index/column changes

Startup schema execution is shared through `src/utils/db/initializeDatabase.ts`. The bot entry point and
`bun run vl-db` both use this path, so fresh-install validation exercises the same schema, optional RAG schema,
ST preset schema, and seed data load as runtime startup.

### Adding Columns — Always Use `seed.sql`

`seed.sql` runs on **every startup** during app initialization. This means any `add_column_if_not_exists` call placed there is automatically applied to existing databases on the next restart — no separate one-off migration script needed.

**The rule:** whenever you add a column to any table, add the corresponding `add_column_if_not_exists` line to `seed.sql`. Group by table under a clearly labeled comment block (e.g. `-- Ensure all required columns exist in tomori_configs table`).

```sql
-- Ensure all required columns exist in tomori_configs table
SELECT add_column_if_not_exists('tomori_configs', 'my_new_flag', 'BOOLEAN', 'false');
```

One-off `scripts/maintenance/add*.ts` migration scripts are **not necessary** for column additions and should be avoided — they require manual execution and are easily forgotten. The `seed.sql` approach is self-applying and idempotent.

## Operational Notes

- `cleanup_expired_cooldowns()` is defined in schema and used by startup cleanup + optional pg_cron.
- Quota cleanup helpers exist for old image/text/video quota rows (`cleanup_old_image_quotas()`, `cleanup_old_text_quotas()`, `cleanup_old_video_quotas()`).
- RAG tables are intentionally separate so local development can run without pgvector unless enabled.
- `bun run vl-db` creates a disposable database on the configured local PostgreSQL server, validates fresh schema/seed initialization twice, smoke-tests backup/restore and DB maintenance scripts, runs `nuke-db` against only that disposable DB, and verifies re-initialization afterward.
