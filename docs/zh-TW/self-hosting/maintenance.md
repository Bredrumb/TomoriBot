---
title: "維護與備份"
sidebar:
  order: 5
---

自架執行個體的日常運作：維護指令稿、如何更新，以及如何備份與還原你的資料庫。這些都是主機端操作，你要從 shell 執行，不是從 Discord。Discord 內、以使用者為單位的匯出、匯入與刪除流程，請改看
[資料處理](/zh-TW/features/knowledge/data-handling/)。

如果你正準備 `git pull` 新版本，請先讀[安全移轉](/zh-TW/self-hosting/safe-migration/)，它涵蓋了在開機時執行的移轉程式碰觸你的結構描述**之前**先備份。

## 維護指令稿

| 指令 | 說明 |
|---|---|
| `bun run setup` | 開啟設定精靈，進行基礎安裝與選用模組。 |
| `bun run update` | 先備份，再拉取最新程式碼並安裝相依套件。 |
| `bun run backup` | 在 `backups/` 建立包含你的資料庫傾印與 `.env` 的套件，裡面有你所有的資料。 |
| `bun run restore-backup` | 從套件還原 `.env` 與資料庫（`--latest` 或 `--from backups/<dir>`）。 |
| `bun run backup:personas` | 只匯出所有伺服器上的人格（含伺服器記憶）；用 `/persona import` 重新匯入。 |
| `bun run nuke-db` | 刪除所有資料表（之後啟動 bot 即可重新初始化）。 |
| `bun run purge-commands` | 清除所有已註冊的 Discord 斜線指令。 |
| `bun run rotate-keys` | 把所有加密欄位重新加密到目前的金鑰版本。 |

`bun run backup` 與 `bun run update` 需要在 PATH 中有 PostgreSQL 用戶端工具（`pg_dump`、`psql`）。

## 更新

先停止運行中的 bot，再使用備份優先的更新工具：

```sh
bun run update
```

它會依序執行 `bun run backup`、`git pull --rebase --autostash`、`bun install --frozen-lockfile`。備份套件會寫入
`backups/`，內容同時包含資料庫傾印與 `.env`。加上
`--skip-backup` 可跳過更新前的備份。手動備援流程：

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

從 `dist/` 執行嗎？請用 `bun run update --build`。使用 Docker Compose 嗎？請用
`bun run update --docker`。

### 已移除的環境變數

這些變數原本用來調整內部行為：文字與脈絡啟發式、Discord 元件的存活時間、快取的存活時間、指令冷卻、結構上限，以及供應商的取樣預設值。現在它們在程式碼裡固定為原本的預設值，所以升級後 `.env` 裡的舊值會被忽略。`bun run env-doctor` 會把 `.env` 裡殘留的這類變數列為未讀取，你可以刪掉它們。取決於你的主機、網路、憑證或費用的設定仍然是環境變數。

指令冷卻是「固定」的例外：依類別區分的 `COOLDOWN_*` 和 `DEFAULT_COMMAND_COOLDOWN` 被一個倍率 `COMMAND_COOLDOWN_SCALE` 取代（預設 `1`，`0` 代表關閉冷卻）。想保留調整過的冷卻，請把舊值除以下表中的固定值：`COOLDOWN_PERSONA=1000` 會變成 `COMMAND_COOLDOWN_SCALE=0.1`。

<details>
<summary>全部 177 個已移除的變數及其固定值</summary>

| 變數 | 固定值 |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | 無（從未被讀取） |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | 比 `BRAVE_IMAGE_DISCORD_LIMIT_MB` 小 1（預設為 `7`） |
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
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`；伺服器仍可在 `/config` 中修改（實驗性行為下的工具脈絡） |
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
| `NAI_CFG_RESCALE` | `0.0`；伺服器仍可在 `/config` 中修改（NovelAI 參數） |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | 內建文字 |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`；伺服器仍可在 `/config` 中修改（NovelAI 參數） |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`；伺服器仍可在 `/config` 中修改（NovelAI 參數） |
| `NAI_IMAGE_SCALE` | `5`；伺服器仍可在 `/config` 中修改（NovelAI 參數） |
| `NAI_IMAGE_STEPS` | `23`；伺服器仍可在 `/config` 中修改（NovelAI 參數） |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`；伺服器仍可在 `/config` 中修改（短期記憶參數） |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | 無（從未被讀取） |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | 無（從未被讀取） |
| `TEST_POSTGRES_DB` | 無（從未被讀取） |
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

### 已移除的 TTS 本機伺服器變數

`servers/tts/` 底下的 TTS 本機伺服器不再有共用的後備值、依引擎設定的上限與驗證設定。`.env` 或 shell 裡的舊值會被忽略，所以請留意下面那些會改變行為的列，而不是只把它當成重複一次預設值。

- **連接埠：** `TOMORI_TTS_PORT` 已移除，因為 `.env` 裡的一個值會讓所有啟動的伺服器使用同一個連接埠。現在每個引擎讀取自己的變數：`CHATTERBOX_PORT`（8011）、`QWEN3TTS_PORT`（8012，語音設計模式下為 8014）、`IRODORI_TTS_PORT`（8013）、`FISH_S2_PORT`（8015）、`VOXCPM2_PORT`（8016）、`COSYVOICE3_PORT`（8017）和 `MOSS_TTS_PORT`（8018）。
- **驗證：** 伺服器不再檢查 bearer 權杖，也不再拒絕綁定到非迴路位址。如果你設定過 `FISH_S2_API_KEY`、`VOXCPM2_API_KEY`、`TOMORI_TTS_API_KEY` 或 `COSYVOICE3_BEARER_TOKEN`，端點現在不帶它們也會接受請求。綁定到迴路位址以外之前，請先讀[網路存取](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access)。
- **安裝腳本固定的版本：** Fish Speech 執行環境的提交，以及 CosyVoice 執行環境與模型的修訂，都固定在安裝腳本裡。要更新它們，就得改腳本裡固定的版本。

<details>
<summary>全部已移除的 TTS 本機伺服器變數</summary>

| 變數 | 現況 |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `COSYVOICE3_BEARER_TOKEN` | 已移除；不再驗證 |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | 固定在安裝腳本裡 |
| `COSYVOICE3_RUNTIME_COMMIT` | 固定在安裝腳本裡 |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | 已移除；重新執行會簽出安裝腳本固定的版本 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `FISH_S2_API_KEY` | 已移除；不再驗證 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | 改用 `TOMORI_TTS_STARTUP_TIMEOUT_MS`（`300000`） |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | 固定在安裝腳本裡 |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | 已移除；重新執行會簽出安裝腳本固定的版本並重新整理模型 |
| `FISH_S2_UPDATE_MODEL_REVISION` | 改用 `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | 固定在安裝腳本裡 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | 已移除；`TOMORI_TTS_HOST` 可填任意值 |
| `TOMORI_TTS_API_KEY` | 已移除；不再驗證 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760`（Fish） |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000`（Irodori-TTS 為 `1000`） |
| `TOMORI_TTS_PORT` | 各引擎自己的連接埠變數 |
| `TTS_CLONE_TIMEOUT_MS` | 改用 `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | 已移除；不再驗證 |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## 備份與還原

`bun run backup` 會在 `backups/`（或你在 `.env` 覆寫的 `TOMORI_BACKUP_DIR`）建立一個帶時間戳的套件，內容包含你整個 PostgreSQL 資料庫加上 `.env`。用下列指令還原最新的套件：

```sh
bun run restore-backup --latest
```

或還原指定的套件：

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` 是範圍更窄的匯出，只含人格預設集與每個人格的伺服器記憶，涵蓋所有伺服器。它**必須**透過 `/persona import`
手動重新匯入，而且**不能**搭配 `restore-backup` 使用（那會造成主鍵衝突）。

TomoriBot 在非正式環境也會進行**自動啟動備份**，而完整還原需要目標資料庫上已有 `pgvector` 擴充功能。這兩件事都詳述於[安全移轉](/zh-TW/self-hosting/safe-migration/)，那裡也有手動的 `pg_dump` 與 `pg_restore` 流程，供你偏好直接操作工具時使用。

## Docker Compose 備份

Docker Compose 支援在應用程式容器內自動進行啟動備份。套件會寫到主機的 `backups/` 目錄，因為 Compose 會將它掛載進容器。

手動的 Docker 備份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker 還原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db` 這類主機端指令稿不會自動透過 Docker 執行。若想改為對 Compose 資料庫執行主機端指令稿，請在主機上安裝 Bun 與 PostgreSQL 用戶端工具後執行，並設定：

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## 乾淨重裝

`bun run nuke-db` 會刪除所有資料表；之後啟動 bot 會從零重新初始化結構描述、種子資料與移轉。當你想要一個仍然能回溯的乾淨狀態時，請搭配新的 `bun run backup` 一起使用，而且永遠不要在沒有現行備份的情況下執行它。

## 延伸閱讀

- [安全移轉](/zh-TW/self-hosting/safe-migration/)：拉取前先備份，以及 `pgvector` 的還原前置條件
- [資料處理](/zh-TW/features/knowledge/data-handling/)：Discord 內、以使用者為單位的匯出、匯入與刪除
- [設定精靈](/zh-TW/self-hosting/setup-wizard/)：引導式的 `bun run setup` 安裝
