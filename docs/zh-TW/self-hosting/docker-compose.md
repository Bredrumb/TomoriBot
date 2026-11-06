---
title: "Docker Compose"
sidebar:
  order: 3
aiGenerated: true
---

Docker Compose在容器中一起運行TomoriBot和PostgreSQL。它是與[安裝精靈](/zh-TW/self-hosting/setup-wizard/)和[手動安裝](/zh-TW/self-hosting/manual-setup/)並列的第三個安裝選項：當你想要執行Docker中的所有內容而不在主機系統上安裝Bun或PostgreSQL時，請選擇它。它繞過互動式安裝精靈並自動配置資料庫連接。

:::caution[Host tools for updates]
`bun run update --docker`需要主機Bun和Git來拉取程式碼變更。其資料庫備份在應用程式容器內運行。你也可以透過Compose執行手動備份和還原；請參閱[維護與備份](/zh-TW/self-hosting/maintenance/)。
:::

## 1. 取得程式碼

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必填的`.env`值

從範例文件開始：

```sh
cp .env.example .env
```

在`.env`中設定這些必需的變數：

| 多變的 | 價值 |
|---|---|
| `DISCORD_TOKEN` | 你的Discord機器人令牌（啟用`GuildMembers`、`MessageContent`和`GuildPresences`特權意圖）。|
| `CRYPTO_SECRET` | 用於加密儲存的API金鑰的32字元加密金鑰。|
| `POSTGRES_PASSWORD` | 資料庫密碼。每個其他`POSTGRES_*`值都是自動配置的。|

使用Docker為`CRYPTO_SECRET`產生一個隨機的32個字元值，然後將其複製到`.env`中：

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

為`POSTGRES_PASSWORD`產生單獨的密碼。你可以從`.env.optional.example`複製可選的調諧設定。

:::note[Database connection is automatic]
不要在`.env`中設定`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`或`POSTGRES_DB`；Compose會自動設定它們。
:::

在Linux上，在啟動容器之前在主機上建立綁定安裝目錄並將所有權分配給UID 1001。Docker以root身分建立遺失的掛載點，這會阻止bot容器保存備份、日誌或上傳：

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. 建置與執行

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

對於以後的啟動，單獨`docker compose up`就足夠了，除非你更改程式碼或依賴項。一旦機器人連接到Discord，請在任何伺服器通道中執行`/setup`以新增你的AI供應商金鑰。有關Discord中的設定選項，請參閱[快速入門](/zh-TW/introduction/quickstart/)。

在其服務定義中組合引腳`RUN_ENV=development`，以便`.env`機密和本機HTTP端點正常運作。容器健康檢查報告bot進程是否正在運作；它不會測試Discord閘道連線。

## 單一主機上的選用分區設定

將 `SHARD_COUNT` 與 `SHARD_IDS` 維持未設定以使用預設行為：由單一處理程序擁有 Discord 在啟動時建議的所有分區。小型安裝通常只會收到一個分區。此模式不使用分區租約或快取失效接聽程式。多個分區可以共用同一個處理程序。

若要在現有服務中執行四個分區，請在 `.env` 中新增 `SHARD_COUNT=4` 並維持 `SHARD_IDS` 未設定。在 `compose.override.yaml` 中新增此服務覆寫，以允許具界限的關機順利完成：

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

使用 `docker compose up -d --build tomoribot` 重新建立服務。如果指令碼呼叫 `docker stop` 或提供自訂的 Compose 停止逾時，也請在此處至少預留 40 秒。自動選取不會在執行時變更分區數量；變更總數需要協調重新啟動。

選用的靜態子集需要為每個群組設定獨立的服務，並具有相同的明確 `SHARD_COUNT` 與互斥的 `SHARD_IDS`，例如 `0,1` 與 `2,3`，總數為 `4`。為服務指定相異且穩定的名稱、容器名稱以及任何發布的健康狀態連接埠。應用程式會從每個群組衍生穩定的計量標籤。維持單一資料庫，在閘道啟動前使用結構描述管理憑證執行現有的一次性 `bun run src/db/initializeCli.ts`，並在每個閘道處理程序上設定 `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`。請勿將原本擁有所有分區的服務與這些群組同時啟動。在變更總數或分割前，請先停止舊的擁有者。

子集模式會拒絕完整設定的 Matrix 橋接。每個使用者的對話回合與上傳限制仍按處理程序計算，因此在啟用第二個處理程序之前，請評估倍增的額度是否可以接受。使用 release 分支限定的贊助者計費的安裝，在透過多個處理程序提供資助請求前，還需要共用支出准入與對帳協調。有關安全與健康狀態限制，請參閱[分區與處理程序擁有權](/architecture/subsystems/sharding/)。

## 4. 選用的本機伺服器（Compose profile）

使用Compose設定檔執行選購的本機幫助伺服器，以便你只啟動你需要的內容：

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

啟用SearXNG時，請在`.env`中設定`SEARXNG_BASE_URL=http://searxng:8080/`。否則請保持未設定狀態。將`SEARXNG_SECRET`設定為SearXNG請求簽署的單獨隨機值。

有關伺服器特定的設置，請參閱 [SearXNG](/zh-TW/self-hosting/local-endpoints/setup-searxng/)、[Crawl4AI](/zh-TW/self-hosting/local-endpoints/setup-crawl4ai/) 和 [本地監控](/zh-TW/self-hosting/local-monitoring/)。

## 維護、更新和備份

使用`bun run update --docker`在Compose部署上進行備份優先更新。若要備份或還原Compose資料庫，請參閱[維護與備份](/zh-TW/self-hosting/maintenance/)。
