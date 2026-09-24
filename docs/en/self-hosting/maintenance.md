---
title: "Maintenance & Backups"
sidebar:
  order: 5
---

Day-to-day operation of a self-hosted instance: the maintenance scripts, how to update, and
how to back up and restore your database. These are host-side operations: you run them from a
shell, not from Discord. For the in-Discord, per-user export/import/delete flows, see
[Data Handling](/features/knowledge/data-handling/) instead.

If you're about to `git pull` a new version, read [Safe Migration](/self-hosting/safe-migration/) first:
it covers backing up *before* the on-boot migration runner touches your schema.

## Maintenance scripts

| Command | Description |
|---|---|
| `bun run setup` | Open the setup wizard for base install and optional modules. |
| `bun run update` | Back up first, then pull latest code and install dependencies. |
| `bun run backup` | Create a bundle in `backups/` with your DB dump and `.env`: contains all of your data. |
| `bun run restore-backup` | Restore `.env` and database from a bundle (`--latest` or `--from backups/<dir>`). |
| `bun run backup:personas` | Export ONLY personas (with server memories) across all servers; re-import via `/persona import`. |
| `bun run nuke-db` | Drop all tables (start the bot afterward to reinitialize). |
| `bun run purge-commands` | Clear all registered Discord slash commands. |
| `bun run rotate-keys` | Re-encrypt all encrypted fields to the current key version. |
| `bun run env-doctor` | Read-only check of your configuration: lists `.env` entries that nothing reads (names only, never values) and where each variable is used. |

`bun run backup` and `bun run update` require the PostgreSQL client tools (`pg_dump`, `psql`)
in your PATH.

## Updating

Stop the running bot first, then use the backup-first updater:

```sh
bun run update
```

This runs `bun run backup`, then `git pull --rebase --autostash`, then `bun install --frozen-lockfile`. The
backup bundle is written to `backups/` and includes both the database dump and `.env`. Add
`--skip-backup` to skip the pre-update backup. Manual fallback:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Running from `dist/`? Use `bun run update --build`. Running Docker Compose? Use
`bun run update --docker`.

### Removed environment variables

These variables tuned internal behavior: text and context heuristics, Discord component lifetimes,
cache lifetimes, command cooldowns, schema limits, and provider sampling defaults. They are now fixed
in code at their former defaults, so an old value in `.env` is ignored after upgrading. `bun run
env-doctor` lists any that remain in your `.env` as unread, and you can delete them. Settings that
depend on your host, network, credentials, or costs are still environment variables.

Command cooldowns are the exception to "fixed": the per-category `COOLDOWN_*` names and
`DEFAULT_COMMAND_COOLDOWN` are replaced by one multiplier, `COMMAND_COOLDOWN_SCALE` (default `1`;
`0` turns cooldowns off). To keep a tuned cooldown, divide your old value by its fixed value
below: `COOLDOWN_PERSONA=1000` becomes `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>All 177 removed variables and their fixed values</summary>

| Variable | Fixed value |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | none (it was never read) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | one below `BRAVE_IMAGE_DISCORD_LIMIT_MB` (`7` by default) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; a server can still change it in `/config` (Tool Context under Experimental Behavior) |
| `DISCORD_TYPING_KEEPALIVE_INTERVAL_MS` | `8000` |
| `DOCUMENT_CHUNK_OVERLAP` | `200` |
| `DOCUMENT_CHUNK_SIZE` | `1000` |
| `DOCUMENT_MAX_RESULTS` | `6` |
| `DOCUMENT_MIN_SIMILARITY` | `0.5` |
| `EMOJI_PENALTY_LOOKBACK` | `3` |
| `EMOJI_PENALTY_THRESHOLD` | `1` |
| `EMOJI_RUN_PREFIX_LENGTH` | `3` |
| `EMOJI_STICKER_CACHE_TTL_MINUTES` | `10` |
| `EMOJI_UNIQUE_LOOKBACK` | `5` |
| `ENHANCED_CONTEXT_STASH_MAX_ENTRIES` | `16` |
| `ENHANCED_CONTEXT_STASH_TTL_MS` | `300000` |
| `EXPRESSION_DESC_MAX_LENGTH` | `500` |
| `EXPRESSION_INIT_BATCH_DELAY_MS` | `1000` |
| `EXPRESSION_INIT_MAX_CHUNK_RETRIES` | `3` |
| `FALLBACK_NOTICE_BUTTON_TIMEOUT_MS` | `86400000` |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` |
| `FORWARD_CHAIN_MAX_DEPTH` | `3` |
| `GENERATE_SCENE_MAX_CYCLES` | `10` |
| `GIF_JPEG_QUALITY` | `80` |
| `GIF_MAX_KEYFRAMES` | `10` |
| `GUILD_MCP_CONFIG_CACHE_TTL_MINUTES` | `5` |
| `HELP_COST_EST_OUTPUT_LONG` | `500` |
| `HELP_COST_EST_OUTPUT_SHORT` | `80` |
| `HELP_COST_EST_OUTPUT_TYPICAL` | `220` |
| `HISTORY_EXTRACTION_WINDOW_SIZE` | `40` |
| `HISTORY_INCHARACTER_RAG_MAX_RESULTS` | `16` |
| `HUMANIZER_COMMA_FLUSH_PROBABILITY` | `0.2` |
| `HUMANIZER_COMMA_REMOVE_PROBABILITY` | `0.4` |
| `HUMANIZER_EMPHASIS_FLUSH_PROBABILITY` | `0.5` |
| `IMAGE_CONTEXT_JPEG_QUALITY` | `85` |
| `IMAGE_MIN_SIZE_BYTES` | `5120` |
| `IMAGE_REFERENCE_TINY_MAX_BYTES` | `950000` |
| `IMAGE_TAG_MAX_TAGS` | `100` |
| `IMAGE_TAG_MAX_TAG_LENGTH` | `200` |
| `KEY_ROTATION_ERROR_COOLDOWN_MS` | `300000` |
| `KEY_ROTATION_RATE_LIMIT_COOLDOWN_MS` | `60000` |
| `MARKDOWN_TABLE_BUTTON_TIMEOUT_MS` | `7200000` |
| `MARKDOWN_TABLE_CACHE_TTL_MINUTES` | `120` |
| `MARKDOWN_TABLE_RENDER_MAX_HEIGHT` | `5000` |
| `MARKDOWN_TABLE_RENDER_MAX_WIDTH` | `1400` |
| `MATRIX_EMBED_CHUNK_MAX_CHARS` | `3500` |
| `MATRIX_LINK_CACHE_TTL_MINUTES` | `5` |
| `MATRIX_MAX_TRACKED_SENT_EVENTS` | `500` |
| `MATRIX_TYPING_TIMEOUT_MS` | `60000` |
| `MAX_ATTRIBUTES` | `10` |
| `MAX_ATTRIBUTE_LENGTH` | `2000` |
| `MAX_FLUSH_COUNT` | `40` |
| `MAX_SAMPLE_DIALOGUES` | `15` |
| `MAX_SAMPLE_DIALOGUE_LENGTH` | `2000` |
| `MAX_TRIGGER_WORDS` | `10` |
| `MCP_STDIO_DIAGNOSTIC_MAX_CHARS` | `8192` |
| `MCP_TOOL_SNAPSHOT_MAX_NAMES` | `100` |
| `MCP_TOOL_SNAPSHOT_NAME_MAX_CHARS` | `128` |
| `MEDIA_MAX_DIMENSION` | `768` |
| `MEDIA_SIZE_LIMIT_BYTES` | `1048576` |
| `MEMORY_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `MEMORY_NOTICE_PREVIEW_LIMIT` | `600` |
| `NAI_CFG_RESCALE` | `0.0`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | built-in text |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_SCALE` | `5`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_STEPS` | `23`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_INPAINT_PADDING` | `0.15` |
| `NAI_INPAINT_STRENGTH` | `1.0` |
| `NAI_KAYRA_CHARS_PER_TOKEN` | `3.5` |
| `NAI_KAYRA_CONTEXT_LIMIT` | `8192` |
| `NAI_TOOL_FAILURE_RETRY_THRESHOLD` | `3` |
| `NVIDIA_IMAGE_CFG_SCALE` | `3.5` |
| `NVIDIA_IMAGE_STEPS` | `30` |
| `OPENROUTER_CATALOG_REFRESH_MIN_INTERVAL_MS` | `60000` |
| `OPENROUTER_CATALOG_TTL_MS` | `21600000` |
| `OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS` | `2` |
| `OPENROUTER_MIN_OUTPUT_TOKENS` | `256` |
| `OPENROUTER_OUTPUT_SAFETY_FACTOR` | `0.9` |
| `PARTICIPANT_ENRICHER_TIMEOUT_MS` | `1500` |
| `PARTICIPANT_SOURCE_TIMEOUT_MS` | `1500` |
| `PERSONAL_SPOTLIGHT_CACHE_MAX_ENTRIES` | `2000` |
| `PERSONAL_SPOTLIGHT_CACHE_TTL_MINUTES` | `5` |
| `PERSONA_IMPORT_NOW_BUTTON_TIMEOUT_MS` | `840000` |
| `PERSONA_SPRITE_CACHE_TTL_MINUTES` | `10` |
| `PERSONA_SPRITE_MAX_INSTRUCTIONS_LENGTH` | `300` |
| `PERSONA_SPRITE_MESSAGE_CACHE_TTL_MINUTES` | `120` |
| `PERSONA_SPRITE_PROMPT_MAX_COUNT` | `20` |
| `PERSONA_USER_BLOCK_CACHE_TTL_SECONDS` | `60` |
| `PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS` | `120000` |
| `PRESET_GENERATION_MAX_OUTPUT_TOKENS` | `16384` |
| `PRESET_MAX_ATTRIBUTES` | `200` |
| `PRESET_MAX_IMAGE_TAGS` | `200` |
| `PRESET_MAX_SAMPLE_DIALOGUES` | `100` |
| `PRESET_MAX_STRING_LENGTH` | `5000` |
| `PRESET_MAX_TRIGGER_WORDS` | `100` |
| `RAG_AVAILABILITY_REPROBE_INTERVAL_MS` | `300000` |
| `REACTION_CONTEXT_MAX_API_CALLS_PER_TURN` | `20` |
| `REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE` | `4` |
| `REACTION_CONTEXT_MAX_USERS_PER_REACTION` | `5` |
| `RELEASE_CARD_WEBP_QUALITY` | `90` |
| `REMINDER_DELIVERY_MAX_RETRIES` | `5` |
| `REMINDER_DELIVERY_RETRY_DELAY_MS` | `60000` |
| `RESET_CONFIRMATION_TIMEOUT_MS` | `60000` |
| `SCHEDULED_WORK_RECONCILE_INTERVAL_MS` | `60000` |
| `SEND_FAILURE_RETRY_MINUTES` | `15` |
| `SETUP_DRAFT_MAX_ENTRIES` | `200` |
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; a server can still change it in `/config` (short-term memory settings) |
| `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` | `10` |
| `SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS` | `3` |
| `SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH` | `1500` |
| `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS` | `24` |
| `SHORT_TERM_MEMORY_TTL_HOURS` | `12` |
| `SPRITE_GROUP_CONTINUITY_TTL_MINUTES` | `10` |
| `STARTUP_GRACE_PERIOD_MINUTES` | `3` |
| `STATS_CARD_THEME_ACCENT` | `#e7322a` |
| `STATS_CARD_THEME_BG` | `#1d100e` |
| `STATS_CARD_THEME_SURFACE` | `#2c1815` |
| `STATS_CARD_W` | `1080` |
| `STATS_DASHBOARD_TIMEOUT_MS` | none (it was never read) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | none (it was never read) |
| `TEST_POSTGRES_DB` | none (it was never read) |
| `THINKING_LEVEL_BUDGET_HIGH_TOKENS` | `8192` |
| `THINKING_LEVEL_BUDGET_LOW_TOKENS` | `1024` |
| `THINKING_LEVEL_BUDGET_MEDIUM_TOKENS` | `4096` |
| `TIME_AWARENESS_NOTE_DEPTH` | `3` |
| `TIME_AWARENESS_REUNION_CLAIM_TTL_MS` | `240000` |
| `TIME_AWARENESS_REUNION_DAYS` | `7` |
| `TIP_BUTTON_TIMEOUT_MS` | `86400000` |
| `TOMORI_STATE_CACHE_TTL_MINUTES` | `10` |
| `TRANSFER_SNAPSHOT_MAX_ENTRIES` | `200` |
| `TRANSFER_SNAPSHOT_TTL_MINUTES` | `15` |
| `USER_CACHE_TTL_MINUTES` | `30` |
| `VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS` | `8192` |
| `VISION_CAPTION_MAX_OUTPUT_TOKENS` | `2048` |
| `VOICE_TRANSCRIPT_CACHE_TTL_MINUTES` | `120` |
| `WEBHOOK_ERROR_COOLDOWN_MS` | `600000` |
| `WEBHOOK_FAILURE_RETRY_MINUTES` | `15` |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | `60` |
| `WELCOME_DELAY_MS` | `60000` |

</details>

### Removed TTS local server variables

The TTS local servers under `servers/tts/` lost their shared fallbacks, per-engine limits, and
authentication settings. An old value in `.env` or your shell is ignored, so check the rows below
that change behavior rather than only restating a default.

- **Ports:** `TOMORI_TTS_PORT` is gone because one value in `.env` put every launched server on the
  same port. Each engine reads its own variable instead: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT`
  (8012, or 8014 in voice-design mode), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015),
  `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017), and `MOSS_TTS_PORT` (8018).
- **Authentication:** the servers no longer check a bearer token or refuse a non-loopback bind.
  If you set `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY`, or
  `COSYVOICE3_BEARER_TOKEN`, the endpoint now accepts requests without it. Read
  [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) before binding
  off loopback.
- **Installer pins:** the Fish Speech runtime commit and the CosyVoice runtime and model revisions are
  fixed in the installers. Updating them means editing the pin in the script.

<details>
<summary>All removed TTS local server variables</summary>

| Variable | Now |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | removed; any `TOMORI_TTS_HOST` is accepted |
| `COSYVOICE3_BEARER_TOKEN` | removed; no authentication |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | pinned in the installer |
| `COSYVOICE3_RUNTIME_COMMIT` | pinned in the installer |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | removed; a rerun checks out the installer's pins |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | removed; any `TOMORI_TTS_HOST` is accepted |
| `FISH_S2_API_KEY` | removed; no authentication |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS` applies (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | pinned in the installer |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | removed; a rerun checks out the installer's pin and refreshes the model |
| `FISH_S2_UPDATE_MODEL_REVISION` | use `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | pinned in the installer |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | removed; any `TOMORI_TTS_HOST` is accepted |
| `TOMORI_TTS_API_KEY` | removed; no authentication |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Fish) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` for Irodori-TTS) |
| `TOMORI_TTS_PORT` | the engine's own port variable |
| `TTS_CLONE_TIMEOUT_MS` | use `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | removed; no authentication |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Backups & restore

`bun run backup` creates a timestamped bundle in `backups/` (or your `TOMORI_BACKUP_DIR` if
overridden in `.env`) containing your entire PostgreSQL database plus `.env`. Restore the
latest bundle with:

```sh
bun run restore-backup --latest
```

Or restore a specific bundle:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` is a narrower export: persona presets and per-persona server
memories only, across all servers. It **must** be re-imported manually via `/persona import`
and **cannot** be used with `restore-backup` (that would cause primary-key conflicts).

TomoriBot also takes **automatic startup backups** in non-production environments, and a full
restore requires the `pgvector` extension to be present on the target database. Both are
covered in detail under [Safe Migration](/self-hosting/safe-migration/), along with a manual `pg_dump` /
`pg_restore` procedure if you prefer to drive the tooling directly.

## Docker Compose backups

Docker Compose supports automatic startup backups inside the app container. Bundles are
written to the host `backups/` directory because Compose mounts it into the container.

For a manual Docker backup:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

For a Docker restore:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Host-side scripts such as `bun run backup`, `bun run update`, and `bun run nuke-db` do not
automatically run through Docker. To run host scripts against the Compose database instead,
run them on the host with Bun plus the PostgreSQL client tools installed, and set:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Clean reinstall

`bun run nuke-db` drops all tables; starting the bot afterward reinitializes the schema,
seeds, and migrations from scratch. Use it together with a fresh `bun run backup` when you
want a clean slate you can still roll back from: never run it without a current backup.

## See also

- [Safe Migration](/self-hosting/safe-migration/): backing up before pulling, and the `pgvector` restore prerequisite
- [Data Handling](/features/knowledge/data-handling/): per-user, in-Discord export/import/delete
- [Setup Wizard](/self-hosting/setup-wizard/): the guided `bun run setup` install
