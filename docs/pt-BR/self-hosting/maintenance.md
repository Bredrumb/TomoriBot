---
title: "Manutenção & Backups"
sidebar:
  order: 5
---

Operação diária de uma instância de hospedagem própria: os scripts de manutenção, como atualizar, e como fazer backup e restaurar seu banco de dados. Estas são operações do lado do host: você as executa a partir de um shell, não do Discord. Para os fluxos de exportar/importar/excluir por usuário dentro do Discord, veja [Manuseio de Dados](/pt-BR/features/knowledge/data-handling/) em vez disso.

Se você está prestes a fazer `git pull` de uma nova versão, leia [Migração Segura](/pt-BR/self-hosting/safe-migration/) primeiro: ela cobre a realização de backup *antes* que o executor de migração na inicialização toque no seu esquema.

## Scripts de manutenção

| Comando | Descrição |
|---|---|
| `bun run setup` | Abre o assistente de configuração para a instalação base e módulos opcionais. |
| `bun run update` | Faz backup primeiro, em seguida puxa o código mais recente e instala as dependências. |
| `bun run backup` | Cria um pacote em `backups/` com o dump do seu BD e `.env`: contém todos os seus dados. |
| `bun run restore-backup` | Restaura `.env` e o banco de dados a partir de um pacote (`--latest` ou `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta APENAS personas (com memórias do servidor) em todos os servidores; reimporte via `/persona import`. |
| `bun run nuke-db` | Remove todas as tabelas (inicie o bot depois para reinicializar). |
| `bun run purge-commands` | Limpa todos os comandos de barra registrados do Discord. |
| `bun run rotate-keys` | Recriptografa todos os campos criptografados para a versão atual da chave. |
| `bun run env-doctor` | Verifica a configuração sem alterá-la e lista os nomes de variáveis `.env` sem leitores no código. |

No host, `bun run backup` precisa de `pg_dump`, e `bun run restore-backup` precisa de `psql` no
PATH. `bun run update` precisa de `pg_dump` para fazer o backup. Com `--docker`, o backup é executado
no contêiner, então a atualização precisa de Bun, Git e Docker no host, mas dispensa as ferramentas
do PostgreSQL no host.

## Atualizando

Pare o bot em execução primeiro, depois use o atualizador com backup prévio:

```sh
bun run update
```

Isso executa `bun run backup`, seguido de `git pull --rebase --autostash` e então `bun install --frozen-lockfile`. O pacote de backup é gravado em `backups/` e inclui tanto o dump do banco de dados quanto o `.env`. Adicione `--skip-backup` para pular o backup pré-atualização. Alternativa manual:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Executando a partir de `dist/`? Use `bun run update --build`. Executando via Docker Compose? Use
`bun run update --docker`; o atualizador começa com `docker compose run --rm tomoribot bun run backup`.

### Variáveis de ambiente removidas

Essas variáveis ajustavam o comportamento interno: heurísticas de texto e contexto, duração de componentes do Discord, duração de caches, tempos de recarga de comandos, limites de esquema e padrões de amostragem dos provedores. Agora elas estão fixas no código com os valores padrão anteriores, então um valor antigo no `.env` é ignorado após a atualização. `bun run env-doctor` lista como não lidas as que permanecerem no seu `.env`, e você pode apagá-las. Configurações que dependem do seu host, rede, credenciais ou custos continuam sendo variáveis de ambiente.

Os tempos de recarga de comandos são a exceção ao "fixo": os nomes `COOLDOWN_*` por categoria e `DEFAULT_COMMAND_COOLDOWN` foram substituídos por um único multiplicador, `COMMAND_COOLDOWN_SCALE` (padrão `1`; `0` desativa os tempos de recarga). Para manter um tempo de recarga ajustado, divida seu valor antigo pelo valor fixo da tabela: `COOLDOWN_PERSONA=1000` vira `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>Todas as 177 variáveis removidas e seus valores fixos</summary>

| Variável | Valor fixo |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | nenhum (nunca foi lido) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | um a menos que `BRAVE_IMAGE_DISCORD_LIMIT_MB` (`7` por padrão) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, multiplicado por `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; um servidor ainda pode alterá-lo em `/config` (Contexto de Ferramentas, em Comportamento Experimental) |
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
| `NAI_CFG_RESCALE` | `0.0`; um servidor ainda pode alterá-lo em `/config` (Parâmetros do NovelAI) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | texto embutido |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; um servidor ainda pode alterá-lo em `/config` (Parâmetros do NovelAI) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; um servidor ainda pode alterá-lo em `/config` (Parâmetros do NovelAI) |
| `NAI_IMAGE_SCALE` | `5`; um servidor ainda pode alterá-lo em `/config` (Parâmetros do NovelAI) |
| `NAI_IMAGE_STEPS` | `23`; um servidor ainda pode alterá-lo em `/config` (Parâmetros do NovelAI) |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; um servidor ainda pode alterá-lo em `/config` (Parâmetros de Memória de Curto Prazo) |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | nenhum (nunca foi lido) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | nenhum (nunca foi lido) |
| `TEST_POSTGRES_DB` | nenhum (nunca foi lido) |
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

### Variáveis removidas dos servidores locais de TTS

Os servidores locais de TTS em `servers/tts/` perderam seus valores de fallback compartilhados, limites por motor e configurações de autenticação. Um valor antigo no `.env` ou no seu shell é ignorado, então confira as linhas abaixo que mudam o comportamento, em vez de apenas repetir um padrão.

- **Portas:** `TOMORI_TTS_PORT` foi removida porque um único valor no `.env` colocava todos os servidores iniciados na mesma porta. Em vez disso, cada motor lê sua própria variável: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT` (8012, ou 8014 no modo de design de voz), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015), `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017) e `MOSS_TTS_PORT` (8018).
- **Autenticação:** os servidores não verificam mais um token de portador nem recusam um bind fora do loopback. Se você definiu `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY` ou `COSYVOICE3_BEARER_TOKEN`, o endpoint agora aceita requisições sem elas. Leia [Acesso de rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) antes de fazer o bind fora do loopback.
- **Versões fixadas nos instaladores:** o commit do runtime do Fish Speech e as revisões do runtime e do modelo do CosyVoice estão fixados nos instaladores. Para atualizá-los, edite a versão fixada no script.

<details>
<summary>Todas as variáveis removidas dos servidores locais de TTS</summary>

| Variável | Agora |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | removida; qualquer `TOMORI_TTS_HOST` é aceito |
| `COSYVOICE3_BEARER_TOKEN` | removida; sem autenticação |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | fixado no instalador |
| `COSYVOICE3_RUNTIME_COMMIT` | fixado no instalador |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | removida; uma nova execução usa as versões fixadas do instalador |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | removida; qualquer `TOMORI_TTS_HOST` é aceito |
| `FISH_S2_API_KEY` | removida; sem autenticação |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | aplica-se `TOMORI_TTS_STARTUP_TIMEOUT_MS` (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | fixado no instalador |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | removida; uma nova execução usa a versão fixada do instalador e atualiza o modelo |
| `FISH_S2_UPDATE_MODEL_REVISION` | use `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | fixado no instalador |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | removida; qualquer `TOMORI_TTS_HOST` é aceito |
| `TOMORI_TTS_API_KEY` | removida; sem autenticação |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Fish) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` para o Irodori-TTS) |
| `TOMORI_TTS_PORT` | a variável de porta própria de cada motor |
| `TTS_CLONE_TIMEOUT_MS` | use `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | removida; sem autenticação |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Backups e restauração

`bun run backup` cria um pacote com carimbo de data/hora em `backups/` (ou em seu `TOMORI_BACKUP_DIR` caso tenha sido substituído no `.env`) contendo todo o seu banco de dados PostgreSQL mais o `.env`. Restaure o pacote mais recente com:

```sh
bun run restore-backup --latest
```

Ou restaure um pacote específico:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` é uma exportação mais restrita: apenas predefinições de persona e memórias do servidor por persona, através de todos os servidores. Ele **deve** ser reimportado manualmente via `/persona import` e **não pode** ser usado com `restore-backup` (isso causaria conflitos de chave primária).

O TomoriBot também faz **backups automáticos na inicialização** em ambientes não produtivos, e uma restauração completa requer que a extensão `pgvector` esteja presente no banco de dados de destino. Ambos são abordados em detalhes em [Migração Segura](/pt-BR/self-hosting/safe-migration/), juntamente com um procedimento manual de `pg_dump` / `pg_restore` se você preferir conduzir as ferramentas diretamente.

## Backups com Docker Compose

O Docker Compose suporta backups automáticos na inicialização dentro do contêiner do aplicativo. Os pacotes são gravados no diretório `backups/` do host porque o Compose o monta dentro do contêiner.

Para um backup manual no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Para uma restauração no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Os scripts do host não são executados automaticamente pelo Docker. Para usá-los com o banco do
Compose, defina os valores de conexão abaixo no host. Backup e restauração também precisam das
ferramentas de cliente do PostgreSQL; `nuke-db` precisa apenas do Bun.

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Reinstalação limpa

`bun run nuke-db` remove todas as tabelas; iniciar o bot depois reinicializa o esquema, os dados iniciais e as migrações do zero. Use-o junto com um `bun run backup` recente quando você quiser começar com a lousa limpa, mas ainda puder reverter: nunca o execute sem um backup atual.

## Veja também

- [Migração Segura](/pt-BR/self-hosting/safe-migration/): fazendo backup antes de puxar as atualizações, e o pré-requisito de restauração do `pgvector`
- [Manuseio de Dados](/pt-BR/features/knowledge/data-handling/): fluxos de exportar/importar/excluir por usuário dentro do Discord
- [Assistente de Configuração](/pt-BR/self-hosting/setup-wizard/): a instalação guiada por `bun run setup`
