---
title: "维护与备份"
sidebar:
  order: 5
---

自部署实例的日常运营：维护脚本、如何更新，以及如何备份和还原你的数据库。这些都是主机端操作：你在命令行里运行它们，而不是在 Discord 里。Discord 内按用户进行的导出、导入与删除流程，见
[数据处理](/zh-CN/features/knowledge/data-handling/)。

如果你正准备 `git pull` 拉取新版本，请先读[安全迁移](/zh-CN/self-hosting/safe-migration/)：
它讲的是在启动时的迁移执行器碰到你的数据库结构之前先备份。

## 维护脚本

| 指令 | 说明 |
|---|---|
| `bun run setup` | 打开安装向导，可做基础安装与可选模块。 |
| `bun run update` | 先备份，再拉取最新代码并安装依赖。 |
| `bun run backup` | 在 `backups/` 里生成一个包含数据库转储和 `.env` 的包：里面有你的全部数据。 |
| `bun run restore-backup` | 从某个包还原 `.env` 和数据库（`--latest` 或 `--from backups/<dir>`）。 |
| `bun run backup:personas` | 只导出所有服务器上的人格（含服务器记忆）；用 `/persona import` 重新导入。 |
| `bun run nuke-db` | 删除所有表（之后启动 bot 会重新初始化）。 |
| `bun run purge-commands` | 清除所有已注册的 Discord 斜杠指令。 |
| `bun run rotate-keys` | 把所有加密字段重新加密到当前密钥版本。 |

`bun run backup` 和 `bun run update` 需要 PATH 里有 PostgreSQL 客户端工具（`pg_dump`、`psql`）。

## 更新

先停掉正在运行的 bot，然后用先备份再更新的指令：

```sh
bun run update
```

它会依次运行 `bun run backup`、`git pull --rebase --autostash`、`bun install --frozen-lockfile`。备份包会写到 `backups/`，里面同时包含数据库转储和 `.env`。加上
`--skip-backup` 可以跳过更新前的备份。手动兜底做法：

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

从 `dist/` 运行？用 `bun run update --build`。用 Docker Compose？用
`bun run update --docker`。

### 已移除的环境变量

这些变量原本用来调整内部行为：文本与上下文启发式、Discord 组件的存活时间、缓存的存活时间、命令冷却、模式上限，以及提供方的采样默认值。现在它们在代码里固定为原来的默认值，所以升级后 `.env` 里的旧值会被忽略。`bun run env-doctor` 会把 `.env` 里残留的这类变量列为未读取，你可以删掉它们。取决于你的主机、网络、凭据或费用的设置仍然是环境变量。

命令冷却是「固定」的例外：按分类划分的 `COOLDOWN_*` 和 `DEFAULT_COMMAND_COOLDOWN` 被一个倍数 `COMMAND_COOLDOWN_SCALE` 取代（默认 `1`，`0` 表示关闭冷却）。想保留调整过的冷却，请把旧值除以下表中的固定值：`COOLDOWN_PERSONA=1000` 变成 `COMMAND_COOLDOWN_SCALE=0.1`。

<details>
<summary>全部 177 个已移除的变量及其固定值</summary>

| 变量 | 固定值 |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | 无（从未被读取） |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | 比 `BRAVE_IMAGE_DISCORD_LIMIT_MB` 小 1（默认为 `7`） |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`，再乘以 `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`；服务器仍可在 `/config` 中修改（实验性行为下的工具上下文） |
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
| `NAI_CFG_RESCALE` | `0.0`；服务器仍可在 `/config` 中修改（NovelAI 参数） |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | 内置文本 |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`；服务器仍可在 `/config` 中修改（NovelAI 参数） |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`；服务器仍可在 `/config` 中修改（NovelAI 参数） |
| `NAI_IMAGE_SCALE` | `5`；服务器仍可在 `/config` 中修改（NovelAI 参数） |
| `NAI_IMAGE_STEPS` | `23`；服务器仍可在 `/config` 中修改（NovelAI 参数） |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`；服务器仍可在 `/config` 中修改（短期记忆参数） |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | 无（从未被读取） |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | 无（从未被读取） |
| `TEST_POSTGRES_DB` | 无（从未被读取） |
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

### 已移除的 TTS 本地服务器变量

`servers/tts/` 下的 TTS 本地服务器不再有共用的后备值、按引擎设置的上限和认证设置。`.env` 或 shell 里的旧值会被忽略，所以请留意下面那些会改变行为的行，而不是只把它当作重复一遍默认值。

- **端口：** `TOMORI_TTS_PORT` 已移除，因为 `.env` 里的一个值会让所有启动的服务器使用同一个端口。现在每个引擎读取自己的变量：`CHATTERBOX_PORT`（8011）、`QWEN3TTS_PORT`（8012，语音设计模式下为 8014）、`IRODORI_TTS_PORT`（8013）、`FISH_S2_PORT`（8015）、`VOXCPM2_PORT`（8016）、`COSYVOICE3_PORT`（8017）和 `MOSS_TTS_PORT`（8018）。
- **认证：** 服务器不再校验 bearer 令牌，也不再拒绝绑定到非回环地址。如果你设置过 `FISH_S2_API_KEY`、`VOXCPM2_API_KEY`、`TOMORI_TTS_API_KEY` 或 `COSYVOICE3_BEARER_TOKEN`，端点现在不带它们也会接受请求。绑定到回环地址以外之前，请先读[网络访问](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access)。
- **安装脚本固定的版本：** Fish Speech 运行时的提交，以及 CosyVoice 运行时和模型的修订，都固定在安装脚本里。要更新它们，就得改脚本里固定的版本。

<details>
<summary>全部已移除的 TTS 本地服务器变量</summary>

| 变量 | 现状 |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `COSYVOICE3_BEARER_TOKEN` | 已移除；不再认证 |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | 固定在安装脚本里 |
| `COSYVOICE3_RUNTIME_COMMIT` | 固定在安装脚本里 |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | 已移除；重新运行会检出安装脚本固定的版本 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `FISH_S2_API_KEY` | 已移除；不再认证 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | 改用 `TOMORI_TTS_STARTUP_TIMEOUT_MS`（`300000`） |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | 固定在安装脚本里 |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | 已移除；重新运行会检出安装脚本固定的版本并刷新模型 |
| `FISH_S2_UPDATE_MODEL_REVISION` | 改用 `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | 固定在安装脚本里 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `TOMORI_TTS_API_KEY` | 已移除；不再认证 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760`（Fish） |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000`（Irodori-TTS 为 `1000`） |
| `TOMORI_TTS_PORT` | 各引擎自己的端口变量 |
| `TTS_CLONE_TIMEOUT_MS` | 改用 `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | 已移除；不再认证 |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## 备份与还原

`bun run backup` 会在 `backups/`（若在 `.env` 里改过，则是你的 `TOMORI_BACKUP_DIR`）里生成一个带时间戳的包，包含你整个 PostgreSQL 数据库加上 `.env`。用下面的指令还原最新的包：

```sh
bun run restore-backup --latest
```

或者还原指定的包：

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` 是范围更窄的导出：只包含人格预设集和按人格区分的服务器记忆，覆盖所有服务器。它**必须**通过 `/persona import` 手动重新导入，并且**不能**与 `restore-backup` 一起使用（那会导致主键冲突）。

TomoriBot 还会在非生产环境里做**启动时自动备份**，而完整还原要求目标数据库上已装好 `pgvector` 扩展。这两点都在[安全迁移](/zh-CN/self-hosting/safe-migration/)里有详细说明，那里也给出了手动 `pg_dump` 与 `pg_restore` 的流程，供你想直接操作工具时参考。

## Docker Compose 的备份

Docker Compose 支持在应用容器内做启动时自动备份。备份包会写到主机的 `backups/` 目录，因为 Compose 把它挂载进了容器。

手动做 Docker 备份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker 还原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db` 这类主机端脚本不会自动经由 Docker 运行。要让主机端脚本改而作用于 Compose 的数据库，请在装好 Bun 和 PostgreSQL 客户端工具的主机上运行它们，并设置：

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## 干净重装

`bun run nuke-db` 会删除所有表；之后启动 bot 会从零重新初始化数据库结构、种子数据和迁移。当你想要一块仍然能回滚的干净底板时，把它和一次全新的 `bun run backup` 配合使用：没有当前备份就绝不要运行它。

## 另见

- [安全迁移](/zh-CN/self-hosting/safe-migration/)：拉取之前先备份，以及 `pgvector` 这个还原前提
- [数据处理](/zh-CN/features/knowledge/data-handling/)：按用户、在 Discord 内进行的导出、导入与删除
- [安装向导](/zh-CN/self-hosting/setup-wizard/)：引导式的 `bun run setup` 安装
