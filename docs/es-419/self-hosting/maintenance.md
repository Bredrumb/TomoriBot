---
title: "Mantenimiento y copias de seguridad"
sidebar:
  order: 5
---

Operación diaria de una instancia autoalojada: los scripts de mantenimiento, cómo actualizar y cómo
hacer copias de seguridad y restaurar tu base de datos. Estas son operaciones del lado del host: las
ejecutas desde una terminal, no desde Discord. Para los flujos de exportar/importar/eliminar por usuario
dentro de Discord, consulta en su lugar
[Manejo de datos](/es-419/features/knowledge/data-handling/).

Si estás por hacer `git pull` de una nueva versión, lee primero
[Migración segura](/es-419/self-hosting/safe-migration/): cubre cómo hacer una copia de seguridad *antes*
de que el ejecutor de migraciones de arranque toque tu esquema.

## Scripts de mantenimiento

| Comando | Descripción |
|---|---|
| `bun run setup` | Abre el asistente de instalación para la instalación base y los módulos opcionales. |
| `bun run update` | Hace una copia de seguridad primero, luego descarga el código más reciente e instala las dependencias. |
| `bun run backup` | Crea un paquete en `backups/` con el volcado de tu base de datos y tu `.env`: contiene todos tus datos. |
| `bun run restore-backup` | Restaura `.env` y la base de datos a partir de un paquete (`--latest` o `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta SOLO personas (con memorias de servidor) en todos los servidores; se reimporta mediante `/persona import`. |
| `bun run nuke-db` | Elimina todas las tablas (inicia el bot después para reinicializar). |
| `bun run purge-commands` | Borra todos los comandos de barra de Discord registrados. |
| `bun run rotate-keys` | Vuelve a cifrar todos los campos cifrados con la versión de clave actual. |

`bun run backup` y `bun run update` requieren las herramientas de cliente de PostgreSQL (`pg_dump`,
`psql`) en tu PATH.

## Actualización

Detén primero el bot en ejecución y luego usa el actualizador con copia de seguridad primero:

```sh
bun run update
```

Esto ejecuta `bun run backup`, luego `git pull --rebase --autostash`, luego
`bun install --frozen-lockfile`. El paquete de la copia de seguridad se escribe en `backups/` e incluye
tanto el volcado de la base de datos como `.env`. Agrega `--skip-backup` para omitir la copia de
seguridad previa a la actualización. Alternativa manual:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

¿Ejecutas desde `dist/`? Usa `bun run update --build`. ¿Ejecutas Docker Compose? Usa
`bun run update --docker`.

### Variables de entorno eliminadas

Estas variables ajustaban comportamientos internos: heurísticas de texto y contexto, duración de los componentes de Discord, duración de las cachés, enfriamientos de comandos, límites de esquema y valores de muestreo predeterminados de los proveedores. Ahora están fijas en el código con sus valores anteriores, por lo que un valor antiguo en `.env` se ignora después de actualizar. `bun run env-doctor` enumera como no leídas las que sigan en tu `.env`, y puedes borrarlas. Los ajustes que dependen de tu host, red, credenciales o costos siguen siendo variables de entorno.

Los enfriamientos de comandos son la excepción a «fijo»: los nombres `COOLDOWN_*` por categoría y `DEFAULT_COMMAND_COOLDOWN` se reemplazan por un solo multiplicador, `COMMAND_COOLDOWN_SCALE` (valor predeterminado `1`; `0` desactiva los enfriamientos). Para conservar un enfriamiento ajustado, divide tu valor anterior entre su valor fijo de la tabla: `COOLDOWN_PERSONA=1000` pasa a ser `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>Las 177 variables eliminadas y sus valores fijos</summary>

| Variable | Valor fijo |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | ninguno (nunca se leyó) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | uno menos que `BRAVE_IMAGE_DISCORD_LIMIT_MB` (`7` de forma predeterminada) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, escalado por `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; un servidor aún puede cambiarlo en `/config` (Contexto de herramientas, en Comportamiento experimental) |
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
| `NAI_CFG_RESCALE` | `0.0`; un servidor aún puede cambiarlo en `/config` (Parámetros de NovelAI) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | texto integrado |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; un servidor aún puede cambiarlo en `/config` (Parámetros de NovelAI) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; un servidor aún puede cambiarlo en `/config` (Parámetros de NovelAI) |
| `NAI_IMAGE_SCALE` | `5`; un servidor aún puede cambiarlo en `/config` (Parámetros de NovelAI) |
| `NAI_IMAGE_STEPS` | `23`; un servidor aún puede cambiarlo en `/config` (Parámetros de NovelAI) |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; un servidor aún puede cambiarlo en `/config` (Parámetros de memoria a corto plazo) |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | ninguno (nunca se leyó) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | ninguno (nunca se leyó) |
| `TEST_POSTGRES_DB` | ninguno (nunca se leyó) |
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

### Variables eliminadas de los servidores locales de TTS

Los servidores locales de TTS en `servers/tts/` perdieron sus valores de respaldo compartidos, los límites por motor y los ajustes de autenticación. Un valor antiguo en `.env` o en tu shell se ignora, así que revisa las filas de abajo que cambian el comportamiento en lugar de solo repetir un valor predeterminado.

- **Puertos:** `TOMORI_TTS_PORT` desapareció porque un solo valor en `.env` ponía a todos los servidores iniciados en el mismo puerto. En su lugar, cada motor lee su propia variable: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT` (8012, o 8014 en modo de diseño de voz), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015), `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017) y `MOSS_TTS_PORT` (8018).
- **Autenticación:** los servidores ya no verifican un token de portador ni rechazan un enlace que no sea de loopback. Si configuraste `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY` o `COSYVOICE3_BEARER_TOKEN`, el endpoint ahora acepta solicitudes sin ellas. Lee [Acceso de red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access) antes de enlazar fuera de loopback.
- **Versiones fijadas en los instaladores:** el commit del runtime de Fish Speech y las revisiones del runtime y del modelo de CosyVoice están fijados en los instaladores. Para actualizarlos hay que editar la versión fijada en el script.

<details>
<summary>Todas las variables eliminadas de los servidores locales de TTS</summary>

| Variable | Ahora |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | eliminada; se acepta cualquier `TOMORI_TTS_HOST` |
| `COSYVOICE3_BEARER_TOKEN` | eliminada; sin autenticación |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | fijado en el instalador |
| `COSYVOICE3_RUNTIME_COMMIT` | fijado en el instalador |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | eliminada; al volver a ejecutar se usan las versiones fijadas del instalador |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | eliminada; se acepta cualquier `TOMORI_TTS_HOST` |
| `FISH_S2_API_KEY` | eliminada; sin autenticación |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | se aplica `TOMORI_TTS_STARTUP_TIMEOUT_MS` (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | fijado en el instalador |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | eliminada; al volver a ejecutar se usa la versión fijada del instalador y se actualiza el modelo |
| `FISH_S2_UPDATE_MODEL_REVISION` | usa `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | fijado en el instalador |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | eliminada; se acepta cualquier `TOMORI_TTS_HOST` |
| `TOMORI_TTS_API_KEY` | eliminada; sin autenticación |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Fish) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` para Irodori-TTS) |
| `TOMORI_TTS_PORT` | la variable de puerto propia de cada motor |
| `TTS_CLONE_TIMEOUT_MS` | usa `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | eliminada; sin autenticación |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Copias de seguridad y restauración

`bun run backup` crea un paquete con marca de tiempo en `backups/` (o en tu `TOMORI_BACKUP_DIR` si lo
sobrescribiste en `.env`) que contiene toda tu base de datos de PostgreSQL más `.env`. Restaura el
paquete más reciente con:

```sh
bun run restore-backup --latest
```

O restaura un paquete específico:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` es una exportación más acotada: solo preajustes de persona y memorias de
servidor por persona, en todos los servidores. **Debe** reimportarse manualmente mediante
`/persona import` y **no puede** usarse con `restore-backup` (eso causaría conflictos de clave
primaria).

TomoriBot también hace **copias de seguridad automáticas de inicio** en entornos que no son de
producción, y una restauración completa requiere que la extensión `pgvector` esté presente en la base de
datos de destino. Ambas se cubren en detalle en
[Migración segura](/es-419/self-hosting/safe-migration/), junto con un procedimiento manual de
`pg_dump`/`pg_restore` si prefieres manejar las herramientas directamente.

## Copias de seguridad con Docker Compose

Docker Compose admite copias de seguridad automáticas de inicio dentro del contenedor de la aplicación.
Los paquetes se escriben en el directorio `backups/` del host porque Compose lo monta dentro del
contenedor.

Para una copia de seguridad manual con Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Para una restauración con Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Los scripts del lado del host, como `bun run backup`, `bun run update` y `bun run nuke-db`, no se
ejecutan automáticamente a través de Docker. Para ejecutar scripts del host contra la base de datos de
Compose en su lugar, ejecútalos en el host con Bun y las herramientas de cliente de PostgreSQL
instaladas, y establece:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Reinstalación limpia

`bun run nuke-db` elimina todas las tablas; iniciar el bot después reinicializa el esquema, las semillas
y las migraciones desde cero. Úsalo junto con una copia de seguridad reciente de `bun run backup` cuando
quieras una base limpia desde la que aún puedas revertir; nunca lo ejecutes sin una copia de seguridad
actual.

## Ver también

- [Migración segura](/es-419/self-hosting/safe-migration/): hacer copias de seguridad antes de descargar,
  y el prerrequisito de restauración con `pgvector`
- [Manejo de datos](/es-419/features/knowledge/data-handling/): exportar/importar/eliminar por usuario
  dentro de Discord
- [Asistente de instalación](/es-419/self-hosting/setup-wizard/): la instalación guiada con `bun run setup`
