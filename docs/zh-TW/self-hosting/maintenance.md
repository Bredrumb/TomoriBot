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
