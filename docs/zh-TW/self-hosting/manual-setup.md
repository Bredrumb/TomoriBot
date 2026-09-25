---
title: "手動設定"
sidebar:
  order: 2
---

:::note
想使用 Docker Compose 的人請跳過這個精靈，容器化安裝路徑請看
[Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

這是給偏好不用引導式精靈的技術背景使用者的手動安裝流程。如果你想要有人一步步帶著走，請改用[設定精靈](/zh-TW/self-hosting/setup-wizard/)，它會建立 `.env`、產生安全的 `CRYPTO_SECRET`、設定 PostgreSQL，並幫你跑完安裝。

## 事前需求

- [Bun](https://bun.sh/)
- Node.js v20+（MCP 工具會用到）
- 原生安裝的 PostgreSQL，或跑在 Docker 容器裡（請看步驟 2）

PostgreSQL 結構描述、`pgcrypto`、種子資料與移轉會在 bot 啟動時自動初始化。

## 1. 安裝

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. 設定

從範例檔建立你的環境檔，並填入必填值：

```sh
cp .env.example .env
```

必填：

- `DISCORD_TOKEN`：你的 Discord bot 權杖（請啟用 `GuildMembers`、`MessageContent` 與
  `GuildPresences` 特權意圖）。
- `CRYPTO_SECRET`：32 個字元的加密金鑰（用來加密儲存的 API 金鑰）。
- PostgreSQL 連線：`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、
  `POSTGRES_PASSWORD`、`POSTGRES_DB`。

:::note[沒有原生 PostgreSQL？]
只把資料庫跑在容器裡，然後把 `POSTGRES_*` 的值指向它：

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

接著設定 `POSTGRES_HOST=localhost`、`POSTGRES_PORT=5432`，以及上面的使用者、密碼與資料庫。
`pgvector/pgvector` 映像檔已預先安裝 RAG 擴充功能；如果你不需要文件與 RAG 記憶，可以換成
`postgres:16`。這樣只會把資料庫跑在 Docker，bot 仍然跑在主機的 Bun 上。若想讓 bot 與資料庫完全
容器化，請改用 [Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

選用的調校設定放在 `.env.optional.example`。想自訂的值（上限、逾時、功能開關、本機伺服器 URL 等）請自行複製過來。

## 3. 執行

```sh
bun run dev
```

當你看到 `TomoriBot up and running!`，就到 Discord 並在你的伺服器執行 `/setup`，連接一個 AI 供應商並初始化 bot。這個指令會開啟一個引導式檢查清單面板，而且在你按下`完成設定`之前不會寫入任何東西；步驟請看
[`/setup` 指令](/zh-TW/self-hosting/setup-wizard/#setup-指令)，Discord 那一側請看
[快速開始](/zh-TW/introduction/quickstart/)。

如果你想讓選用的本機伺服器（SearXNG、Crawl4AI、本機 TTS/STT）跟著 bot 一起啟動，請用 `bun run launch` 取代 `bun run dev`：

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # 查看所有旗標
```

## 選用額外項目（手動的「完整安裝」）
<!-- anchor: optional-extras-the-manual-full-install -->

[設定精靈](/zh-TW/self-hosting/setup-wizard/)的**完整安裝**路徑會在基礎安裝之上疊加四個輕量的額外項目。它們都不是執行 bot 的必要條件，但每一項都會解鎖一個功能。如果你是手動安裝，想要哪一項就加哪一項：

### `pgvector`：文件與 RAG 記憶

RAG（文件上傳與跨頻道回想）會把嵌入向量存在 `vector` 欄位，這需要
[pgvector](https://github.com/pgvector/pgvector) 擴充功能。請依你的 PostgreSQL 主版本安裝：

```sh
# Debian/Ubuntu，例如 PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

接著在你的資料庫上啟用一次。用 `.env` 裡的 `POSTGRES_*` 值透過 `psql` 連線，它會提示你輸入 `POSTGRES_PASSWORD`：

:::note[Windows]
原生 Windows PostgreSQL 沒有預先建置的 pgvector 套件。要安裝就得用 Visual Studio C++ 與 `nmake`，
針對你的確切 PostgreSQL 版本從原始碼建置（請看 pgvector 的
[Windows 說明](https://github.com/pgvector/pgvector#windows)）。Windows 上比較簡單的路徑，是把資料庫跑在
上面[設定](#2-設定)一節所示的 `pgvector/pgvector` 容器裡，那個映像檔已預先安裝擴充功能。
:::

```sh
# 原生或主機的 psql（請替換成你自己的 POSTGRES_USER 與 POSTGRES_DB）：
psql -h localhost -p 5432 -U tomori -d tomodb

# 或者，如果資料庫跑在步驟 2 的 Docker 容器裡：
docker exec -it tomori-db psql -U tomori -d tomori
```

連線之後，執行：

```sql
CREATE EXTENSION vector;
```

沒有 pgvector，bot 仍然可以執行，但 RAG 功能會完全無法使用。還原備份之前，目標資料庫也必須先有這個擴充功能；詳情請看
[安全移轉](/zh-TW/self-hosting/safe-migration/)。

### `pg_cron`：排程清理工作

`pg_cron` 提供選用的定期資料庫維護（冷卻與提醒資料列的清理）。本 repo 的 Docker Compose 已經設定好它。

:::caution[提醒與觸發不需要它]
`pg_cron` 純粹是做**日常家務**，因為它只清理過期的資料列。提醒的送達與隨機觸發都在應用程式本身執行，
所以那些功能有沒有 `pg_cron` 都能運作。
:::

如果是你自己管理的 PostgreSQL，請找出目前生效的設定檔：

```sql
SHOW config_file;
```

在 `postgresql.conf` 啟用擴充功能。如果 `shared_preload_libraries` 已經列出其他函式庫，就附加在後面：

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

重新啟動 PostgreSQL，然後：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Tokenizer 資產：依模型調整的 logit 偏權值

Logit 偏權值（表情符號與詞彙重複懲罰）需要本機的 tokenizer 資產：

```sh
bun run setup:tokenizers
```

有些模型家族（例如 Gemma）有使用門檻，在你接受授權之後需要一組
[HuggingFace 權杖](https://huggingface.co/settings/tokens)：

```sh
# Windows（PowerShell）
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

沒有這一步，logit 偏權值會默默停用，其他一切照常運作。

安全的 `fetch_url` 備援在行程內執行，不需要任何 Python 套件。DuckDuckGo 與 IAsk 的
`web_search` 隨 `bun install --frozen-lockfile` 一起安裝，所以也不需要額外安裝。

## 維護、更新與備份

安裝完成之後，主機端指令稿（`bun run update`、`bun run backup`、
`bun run restore-backup`、`bun run nuke-db`、`bun run rotate-keys`……）與更新、備份流程都放在
[維護與備份](/zh-TW/self-hosting/maintenance/)頁面。如果你正準備拉取新版本，請先從
[安全移轉](/zh-TW/self-hosting/safe-migration/)開始。
