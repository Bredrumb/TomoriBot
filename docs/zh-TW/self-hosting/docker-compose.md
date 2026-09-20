---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose 會以容器建置並運行 TomoriBot **加上** PostgreSQL。它與
[設定精靈](/zh-TW/self-hosting/setup-wizard/)及[手動設定](/zh-TW/self-hosting/manual-setup/)
並列為第三條安裝路徑，當你偏好把所有東西都放進 Docker，而不是在主機安裝 Bun 與 PostgreSQL 時，就選它。它**不**使用設定精靈；資料庫連線會自動幫你設定好。

:::caution[主機端指令稿仍然需要主機工具]
把 bot 與資料庫跑在 Docker 裡，並不會把維護指令稿也容器化。
`bun run backup`、`bun run restore-backup`、`bun run update`、`bun run rotate-keys` 等指令
仍然透過主機的 Bun 與主機的 PostgreSQL 用戶端工具執行。Compose 專屬的流程請看
[維護與備份](/zh-TW/self-hosting/maintenance/)。
:::

## 1. 取得程式碼

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必填的 `.env` 值

從範例檔開始：

```sh
cp .env.example .env
```

接著至少設定：

| 變數 | 值 |
|---|---|
| `DISCORD_TOKEN` | 你的 Discord bot 權杖（請啟用 `GuildMembers`、`MessageContent` 與 `GuildPresences` 特權意圖）。 |
| `CRYPTO_SECRET` | 32 個字元的加密金鑰，用來加密儲存的 API 金鑰。 |
| `POSTGRES_PASSWORD` | 資料庫密碼。其他每一個 `POSTGRES_*` 值都會自動設定好。 |

與設定精靈不同，Compose 不會幫你產生 `CRYPTO_SECRET`，請自己設定（任何 32 個字元的字串）。選用的調校值可以從
`.env.optional.example` 複製。

:::note[資料庫連線是自動的]
Compose 的 PostgreSQL 服務以開發模式（無 SSL）跑在內部 Docker
網路上，而且內附的映像檔已經設定好 `pgvector` 與 `pg_cron`，所以文件與 RAG 記憶以及排程清理都能直接運作。Compose 不要設定 `POSTGRES_HOST`、
`POSTGRES_PORT`、`POSTGRES_USER` 或 `POSTGRES_DB`；它們都幫你管理好了。
:::

## 3. 建置與執行

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

之後要再啟動時，除非你改過程式碼或相依套件，否則單獨執行 `docker compose up` 就夠了。bot 上線之後，在 Discord 執行 `/setup` 加入你的 AI 供應商金鑰，Discord 那一側請看[快速開始](/zh-TW/introduction/quickstart/)。

## 4. 選用的 sidecar（Compose profile）

Sidecar 透過 Compose profile 選擇性啟用，所以你只會跑自己需要的東西：

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

各 sidecar 的細節請看 [SearXNG](/zh-TW/self-hosting/local-endpoints/setup-searxng/)、
[Crawl4AI](/zh-TW/self-hosting/local-endpoints/setup-crawl4ai/) 與
[本機監控](/zh-TW/self-hosting/local-monitoring/)。

## 維護、更新與備份

Compose 部署請使用 `bun run update --docker` 執行備份優先的更新流程。Compose 資料庫的備份與還原（包括對它執行主機端指令稿）涵蓋在[維護與備份](/zh-TW/self-hosting/maintenance/)頁面。拉取新版本之前，請先從[安全移轉](/zh-TW/self-hosting/safe-migration/)開始。
