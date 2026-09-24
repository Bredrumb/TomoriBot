---
title: "Bảo trì và sao lưu"
sidebar:
  order: 5
---

Vận hành hàng ngày một phiên bản bot self-host: các script bảo trì, cách cập nhật, và
cách sao lưu và khôi phục cơ sở dữ liệu của bạn. Đây là các thao tác phía máy chủ lưu trữ: bạn chạy chúng từ
terminal shell, không phải từ Discord. Để biết các quy trình xuất/nhập/xóa theo từng người dùng trong Discord, hãy xem
[Xử lý dữ liệu](/vi/features/knowledge/data-handling/).

Nếu bạn chuẩn bị `git pull` phiên bản mới, hãy đọc [Di chuyển an toàn](/vi/self-hosting/safe-migration/) trước:
tài liệu này hướng dẫn cách sao lưu *trước khi* trình chạy migration khi khởi động can thiệp vào schema của bạn.

## Các script bảo trì

| Lệnh | Mô tả |
|---|---|
| `bun run setup` | Mở trình hướng dẫn thiết lập cho bản cài đặt cơ bản và các mô-đun tùy chọn. |
| `bun run update` | Sao lưu trước, sau đó kéo mã nguồn mới nhất và cài đặt các phần phụ thuộc. |
| `bun run backup` | Tạo một gói trong `backups/` chứa bản dump DB và `.env`: bao gồm toàn bộ dữ liệu của bạn. |
| `bun run restore-backup` | Khôi phục `.env` và cơ sở dữ liệu từ một gói (`--latest` hoặc `--from backups/<dir>`). |
| `bun run backup:personas` | CHỈ xuất các persona (kèm theo bộ nhớ máy chủ) trên tất cả các máy chủ; nhập lại qua `/persona import`. |
| `bun run nuke-db` | Xóa tất cả các bảng (khởi động lại bot sau đó để tái khởi tạo). |
| `bun run purge-commands` | Xóa tất cả các lệnh slash Discord đã đăng ký. |
| `bun run rotate-keys` | Mã hóa lại tất cả các trường đã mã hóa sang phiên bản khóa hiện tại. |

`bun run backup` và `bun run update` yêu cầu các công cụ client PostgreSQL (`pg_dump`, `psql`)
có sẵn trong biến môi trường PATH của bạn.

## Cập nhật

Trước tiên hãy dừng bot đang chạy, sau đó sử dụng công cụ cập nhật ưu tiên sao lưu:

```sh
bun run update
```

Lệnh này sẽ chạy `bun run backup`, sau đó là `git pull --rebase --autostash`, rồi đến `bun install --frozen-lockfile`. Gói
sao lưu được ghi vào `backups/` và bao gồm cả bản dump cơ sở dữ liệu lẫn tệp `.env`. Thêm
`--skip-backup` để bỏ qua việc sao lưu trước khi cập nhật. Quy trình thủ công thay thế:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Chạy từ thư mục `dist/`? Sử dụng `bun run update --build`. Chạy Docker Compose? Sử dụng
`bun run update --docker`.

### Biến môi trường đã bị xóa

Các biến này từng tinh chỉnh hành vi nội bộ: heuristic xử lý văn bản và ngữ cảnh, thời gian tồn tại của component Discord, thời gian tồn tại của cache, cooldown lệnh, giới hạn schema và giá trị sampling mặc định của nhà cung cấp. Giờ chúng được cố định trong code ở giá trị mặc định trước đây, nên giá trị cũ trong `.env` sẽ bị bỏ qua sau khi nâng cấp. `bun run env-doctor` liệt kê những biến còn sót lại trong `.env` là chưa được đọc, và bạn có thể xóa chúng. Các cài đặt phụ thuộc vào host, mạng, thông tin xác thực hoặc chi phí của bạn vẫn là biến môi trường.

Cooldown lệnh là ngoại lệ của việc "cố định": các tên `COOLDOWN_*` theo từng nhóm và `DEFAULT_COMMAND_COOLDOWN` được thay bằng một hệ số duy nhất, `COMMAND_COOLDOWN_SCALE` (mặc định `1`; `0` sẽ tắt cooldown). Để giữ lại một cooldown đã tinh chỉnh, hãy chia giá trị cũ của bạn cho giá trị cố định ở bảng dưới: `COOLDOWN_PERSONA=1000` trở thành `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>Toàn bộ 177 biến đã bị xóa và giá trị cố định của chúng</summary>

| Biến | Giá trị cố định |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | không có (chưa từng được đọc) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | nhỏ hơn `BRAVE_IMAGE_DISCORD_LIMIT_MB` một đơn vị (mặc định là `7`) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, nhân với `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; máy chủ vẫn có thể đổi trong `/config` (Ngữ cảnh công cụ, trong Hành vi thử nghiệm) |
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
| `NAI_CFG_RESCALE` | `0.0`; máy chủ vẫn có thể đổi trong `/config` (Tham số NovelAI) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | văn bản dựng sẵn |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; máy chủ vẫn có thể đổi trong `/config` (Tham số NovelAI) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; máy chủ vẫn có thể đổi trong `/config` (Tham số NovelAI) |
| `NAI_IMAGE_SCALE` | `5`; máy chủ vẫn có thể đổi trong `/config` (Tham số NovelAI) |
| `NAI_IMAGE_STEPS` | `23`; máy chủ vẫn có thể đổi trong `/config` (Tham số NovelAI) |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; máy chủ vẫn có thể đổi trong `/config` (Tham số bộ nhớ ngắn hạn) |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | không có (chưa từng được đọc) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | không có (chưa từng được đọc) |
| `TEST_POSTGRES_DB` | không có (chưa từng được đọc) |
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

### Biến của máy chủ TTS cục bộ đã bị xóa

Các máy chủ TTS cục bộ trong `servers/tts/` không còn giá trị dự phòng dùng chung, giới hạn theo từng engine và các cài đặt xác thực. Giá trị cũ trong `.env` hoặc shell của bạn sẽ bị bỏ qua, vì vậy hãy xem các dòng bên dưới có làm thay đổi hành vi, thay vì chỉ nhắc lại một giá trị mặc định.

- **Cổng:** `TOMORI_TTS_PORT` đã bị bỏ vì một giá trị trong `.env` khiến mọi máy chủ được khởi chạy dùng chung một cổng. Thay vào đó, mỗi engine đọc biến riêng của mình: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT` (8012, hoặc 8014 ở chế độ thiết kế giọng nói), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015), `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017) và `MOSS_TTS_PORT` (8018).
- **Xác thực:** các máy chủ không còn kiểm tra bearer token và không còn từ chối bind ngoài loopback. Nếu bạn đã đặt `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY` hoặc `COSYVOICE3_BEARER_TOKEN`, endpoint giờ chấp nhận yêu cầu mà không cần chúng. Hãy đọc [Truy cập mạng](/vi/self-hosting/local-endpoints/text-to-speech/#network-access) trước khi bind ra ngoài loopback.
- **Bản ghim trong trình cài đặt:** commit runtime của Fish Speech cùng revision runtime và model của CosyVoice được cố định trong các trình cài đặt. Muốn cập nhật thì phải sửa bản ghim trong script.

<details>
<summary>Toàn bộ biến của máy chủ TTS cục bộ đã bị xóa</summary>

| Biến | Hiện tại |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | đã xóa; mọi giá trị `TOMORI_TTS_HOST` đều được chấp nhận |
| `COSYVOICE3_BEARER_TOKEN` | đã xóa; không có xác thực |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | được ghim trong trình cài đặt |
| `COSYVOICE3_RUNTIME_COMMIT` | được ghim trong trình cài đặt |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | đã xóa; chạy lại sẽ checkout các bản ghim của trình cài đặt |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | đã xóa; mọi giá trị `TOMORI_TTS_HOST` đều được chấp nhận |
| `FISH_S2_API_KEY` | đã xóa; không có xác thực |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | áp dụng `TOMORI_TTS_STARTUP_TIMEOUT_MS` (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | được ghim trong trình cài đặt |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | đã xóa; chạy lại sẽ checkout bản ghim của trình cài đặt và làm mới model |
| `FISH_S2_UPDATE_MODEL_REVISION` | dùng `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | được ghim trong trình cài đặt |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | đã xóa; mọi giá trị `TOMORI_TTS_HOST` đều được chấp nhận |
| `TOMORI_TTS_API_KEY` | đã xóa; không có xác thực |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Fish) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` cho Irodori-TTS) |
| `TOMORI_TTS_PORT` | biến cổng riêng của từng engine |
| `TTS_CLONE_TIMEOUT_MS` | dùng `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | đã xóa; không có xác thực |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Sao lưu và khôi phục

`bun run backup` tạo một gói có gắn nhãn thời gian trong `backups/` (hoặc thư mục `TOMORI_BACKUP_DIR` nếu
được ghi đè trong `.env`) chứa toàn bộ cơ sở dữ liệu PostgreSQL của bạn cùng tệp `.env`. Khôi phục
gói mới nhất bằng:

```sh
bun run restore-backup --latest
```

Hoặc khôi phục một gói cụ thể:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` là một bản xuất hẹp hơn: chỉ bao gồm các preset persona và
bộ nhớ máy chủ theo từng persona, trên tất cả các máy chủ. Bản này **bắt buộc** phải được nhập lại thủ công qua `/persona import`
và **không thể** sử dụng với `restore-backup` (điều đó sẽ gây ra xung đột khóa chính primary key).

TomoriBot cũng thực hiện **sao lưu tự động khi khởi động** trong môi trường không phải production, và việc
khôi phục hoàn chỉnh đòi hỏi tiện ích mở rộng `pgvector` phải có sẵn trên cơ sở dữ liệu đích. Cả hai điều này
đều được trình bày chi tiết trong [Di chuyển an toàn](/vi/self-hosting/safe-migration/), cùng với quy trình sử dụng `pg_dump` /
`pg_restore` thủ công nếu bạn muốn thao tác trực tiếp với các công cụ.

## Sao lưu trong Docker Compose

Docker Compose hỗ trợ sao lưu tự động khi khởi động bên trong container ứng dụng. Các gói
sao lưu được ghi vào thư mục `backups/` của máy chủ lưu trữ do Compose gắn kết thư mục này vào trong container.

Để sao lưu Docker thủ công:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Để khôi phục Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Các script phía máy chủ lưu trữ như `bun run backup`, `bun run update` và `bun run nuke-db` không
tự động chạy qua Docker. Để chạy các script này với cơ sở dữ liệu Compose,
hãy chạy chúng trên máy chủ lưu trữ có cài sẵn Bun cùng các công cụ client PostgreSQL, và thiết lập:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Cài đặt lại sạch sẽ

`bun run nuke-db` xóa tất cả các bảng; việc khởi động bot sau đó sẽ khởi tạo lại schema,
seed dữ liệu và migration từ đầu. Hãy sử dụng lệnh này cùng với một bản `bun run backup` mới khi bạn
muốn có một khởi đầu sạch sẽ mà vẫn có thể quay lui lại được: không bao giờ chạy lệnh này mà không có bản sao lưu hiện tại.

## Xem thêm

- [Di chuyển an toàn](/vi/self-hosting/safe-migration/): sao lưu trước khi kéo mã nguồn mới, và điều kiện tiên quyết khôi phục `pgvector`
- [Xử lý dữ liệu](/vi/features/knowledge/data-handling/): xuất/nhập/xóa theo từng người dùng trong Discord
- [Trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/): cài đặt có hướng dẫn bằng `bun run setup`
