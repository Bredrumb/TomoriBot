---
title: "安全移轉指南"
sidebar:
  order: 6
---

當你 `git pull` 新程式碼並重新啟動 TomoriBot 時，bot 會在開機時自動執行資料庫結構描述移轉。這很強大，代表你不必手動管理 SQL 更新，但同時也代表破壞性操作可能悄悄影響你的資料。本指南說明如何在拉取之前保護自己。

## 為什麼這件事重要

TomoriBot 的移轉程式（位於 `src/db/migrationRunner.ts`）會依版本順序執行所有尚未套用的移轉。移轉是**只能往前**的：如果出了問題，移轉程式不會自動回復。大多數移轉是安全的擴充（新欄位、新資料表），但依專案的[設計政策（OD-R-6）](../../plans/refactor/shared/open-decisions)，`DROP COLUMN` 或 `DROP TABLE` 這類破壞性操作是允許的。破壞性移轉在沒有備份的情況下執行，你的資料就永久遺失。有疑慮時，先備份。

## 拉取前檢查清單

在執行 `git pull` **之前**依序完成下列步驟：

1. **停止 bot**：關閉 TomoriBot 行程，讓作用中的資料庫連線不會干擾備份。
2. **備份資料庫**：使用底下兩種方法的其中一種。
3. **記下目前的提交**：執行 `git rev-parse HEAD` 並保存輸出，以備需要回溯。
4. **拉取並重新啟動**：備份安全落盤之後，就可以放心拉取並重新啟動。

### 前置條件：`pgvector` 擴充功能

完整備份是純 SQL 的 `pg_dump`（`backupData.ts` 執行 `pg_dump --clean --if-exists -f`），所以內容包含 RAG 使用的 `vector` 型別 `document_chunks` 資料表。**目標 Postgres 必須在還原之前就有 `pgvector` 擴充功能**，否則傾印中的 `CREATE EXTENSION IF NOT EXISTS vector` 無法執行，`document_chunks` 資料表也建立不起來。

在主機上安裝一次（對應你的 Postgres 主版本），例如 Postgres 16：

```bash
sudo apt-get install -y postgresql-16-pgvector
```

確認它可以使用：

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

如果沒有它就還原：

- 專案的 `restore-backup`（以及任何帶 `ON_ERROR_STOP=1` 的 `psql -f` 執行）會**提早中止**並顯示 `extension "vector" is not available`，不會載入任何資料。請安裝 pgvector 後重試。
- 手動的 `psql -f` 執行若**忽略錯誤**（`ON_ERROR_STOP=0`）反而更糟：失敗的 `COPY public.document_chunks` 會讓 psql 的輸入解析器失去同步，接著把後續 `COPY` 的資料列誤判為 SQL（引發一連串 `syntax error at or near …`）。這會悄悄丟掉整張資料表（實際觀察到 `documents` 與 `llms`），留下一個看起來完整、實際上已經掉資料的部分還原資料庫。請一律以 `ON_ERROR_STOP=1` 還原，讓失敗立刻浮現。

### 選項 A：使用專案的備份指令稿

TomoriBot 內含兩個備份指令稿，各自針對不同的資料：

- **`bun run backup`**：完整的資料庫結構描述加資料傾印（人格、記憶、設定，全部都在內）
- **`bun run backup:personas`**：只含人格預設集與每個人格的伺服器記憶

為了安全移轉，請使用**完整備份**：

```bash
bun run backup
```

這會在 `backups/`（或你在 `.env` 覆寫的 `TOMORI_BACKUP_DIR`）建立一個帶時間戳的套件，內容是整個 PostgreSQL 資料庫的純 SQL 傾印。之後要還原時，執行：

```bash
bun run restore-backup --latest
```

或從指定的套件還原：

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### 自動的本機啟動備份

在非正式環境（`RUN_ENV` 未設為 `production`），TomoriBot 也會在資料庫初始化之前檢查是否有完整的資料備份。只要下列任一條件成立，它就會建立一個與 `backupData.ts` 相容的自動套件：

- 最新的完整資料備份是由不同的 `package.json` bot 版本所建立
- 最新的完整資料備份至少已經有 `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` 那麼舊（預設：`24`）

自動備份會在 `bundle_info.json` 標記 `backupType: "automatic"`，並以 `_auto` 後綴命名。手動的 `bun run backup` 套件標記為 `manual`；它們可以滿足最新備份的檢查，但永遠不會計入自動保留。啟動閘門會保留最新的
`TOMORI_AUTO_BACKUP_MAX` 個自動套件（預設：`5`），並且只刪除較舊的自動套件。

如果你需要在沒有這道安全閘門的情況下啟動本機或開發用 bot（例如在沒有 `pg_dump` 的機器上），請在 `.env` 設定
`TOMORI_AUTO_BACKUP_ENABLED=false`。

### 選項 B：直接使用 `pg_dump`

如果你偏好手動控制，請使用 PostgreSQL 內建的 `pg_dump` 工具，搭配 TomoriBot 自己的環境變數：

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

這會儲存自訂格式的二進位傾印（比 SQL 文字更精簡）。環境變數與你的 `.env` 一致：

- `POSTGRES_HOST`：預設 `localhost`
- `POSTGRES_PORT`：預設 `5432`
- `POSTGRES_USER`：你的資料庫使用者
- `POSTGRES_DB`：預設 `tomodb`

要還原時：

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

**注意：** 除非你在 `.pgpass` 檔（PostgreSQL 內建的憑證檔）中設定密碼，否則 `pg_restore` 會提示你輸入。

## 給透過 CI 部署的貢獻者：`(Checkpoint)` 慣例

如果你維護一個透過 `.github/workflows/deploy-tomoribot-{aws,gcp}.yml` 工作流程部署到 AWS 或 GCP 的 fork，那些管線支援**選擇性啟用的部署前快照**：當提交訊息包含字面 token `(Checkpoint)`，工作流程會在**任何程式碼部署之前**、也在移轉程式在開機時碰觸資料庫之前，執行 `aws rds create-db-snapshot`（或 GCP Cloud SQL 的對應操作）。

適用時機：

- 你正在發布會刪除欄位、刪除資料表、變更欄位型別，或以其他方式造成資料遺失的移轉（OD-R-6 破壞性移轉政策）。
- 你正在發布結合多個移轉的發布套件提交，並想要單一回溯點。
- 你不確定排隊中的移轉是否安全。有疑慮時，就建立檢查點。

例行的非破壞性部署（新欄位、新索引、新增式種子資料）請跳過它：快照有實際成本，而例行流程不需要它。

提交訊息範例：

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

`(Checkpoint)` token 可以出現在主旨或內文的任何位置，它會以區分大小寫的方式與頭部提交的訊息比對。對臨時情況而言，手動觸發工作流程並啟用該工作流程的備份輸入，是同一根槓桿。

## 移轉執行到一半失敗時該怎麼辦

如果 bot 在移轉期間崩潰或卡住：

1. **立刻停止 bot**：不要讓它盲目重試移轉。

2. **檢查紀錄**：TomoriBot 預設輸出到 stdout 與 stderr（由你的行程管理器或 Docker 紀錄捕捉）。尋找指出失敗移轉的錯誤訊息。輸出範例：

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **決定是否還原**：如果錯誤無法復原（例如移轉試圖刪除一個不存在的欄位），請從備份還原：

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **把程式碼回溯**：退回到最後一個可用的提交：

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   使用你在拉取前檢查清單步驟 3 保存的雜湊，或用下列指令找出：

   ```bash
   git log --oneline | head -20
   ```

5. **回報問題**：到 [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) 開一個 issue，附上：
   - 失敗的移轉檔名（從紀錄中取得）
   - 完整的錯誤訊息
   - 最後一個成功提交的雜湊
   - 你的作業系統、Bun 版本（`bun --version`）與 PostgreSQL 版本

## 無法自動復原的項目

依專案設計（OD-R-6），**破壞性移轉無法**由移轉程式回溯。例如：

- `DROP COLUMN name_here`：被刪除的資料列永久遺失，沒有任何 SQL 指令稿能救回來
- `DROP TABLE old_table`：整張資料表消失
- 型別縮窄（例如 `VARCHAR(255) → VARCHAR(100)`）：超過 100 個字元的值會被截斷

對這些操作而言，**唯一的救援就是你的備份**。如果你在較舊的版本上、而有新的重構已經發布，拉取前請一律備份。

移轉程式只能往前的設計是刻意的：回溯檔（`.down.sql`）是為了開發者在測試時的安全而存在，但正式環境的救援依靠備份，而不是重新執行可撤銷的操作。

## 試用功能分支，然後回到 `main`

常見情況：有人請你在現有的安裝上測試一個分支，而你想知道簽出該分支、開機，然後切回 `main` 會不會傷害你的資料庫。

**關鍵事實：**

- Git 與 PostgreSQL 是兩個獨立的世界。`git checkout` 只會替換磁碟上的檔案，它從不連線或修改你的資料庫。你已套用的移轉狀態存在 `schema_migrations` 資料表，不在 git 裡。
- 移轉會**在開機時自動執行**（透過 `initializeDatabase.ts`），所以你啟動分支的那一刻，它的新移轉就會套用到你指向的任何資料庫。
- 往前的執行程式**永遠不會自動回溯**。當你回到 `main`，它掃描磁碟上的檔案、找不到待處理項目，於是什麼都不做。分支套用過的移轉會維持已套用。

**所以安全嗎？** 這完全取決於該分支的移轉做了什麼：

- **只有新增**（新資料表或新欄位）→ 安全。新物件就只是放在那裡沒人用；`main` 的程式碼從不引用它們，所以不會造成錯誤結果或崩潰。它們是無害的冗餘。
- **破壞性**（對 `main` 仍在使用的資料表做 `DROP`、`RENAME` 或 `ALTER`）→ 不安全。分支的變更會讓 `main` 的程式碼困在一個已經消失或已變更的欄位或資料表上。

**最安全的做法：** 讓分支指向一個用完即丟的資料庫（另一個 `POSTGRES_DB`），這樣你的真實資料永遠不會被碰觸。你本來就是用 `POSTGRES_*` 變數建立連線，而 `bun run nuke-db` 可以重置一個臨時資料庫。

### 手動回溯測試用的移轉

如果你拿**真實**資料庫測試過某個分支，之後想撤銷它的移轉，請使用回溯執行程式。與往前的執行程式不同，它**永遠不會自動執行**：回溯一律是刻意的動作為之，因為 `.down.sql` 檔通常是有損的。

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

這個指令會以**遞減**的版本順序執行選定的 `.down.sql` 檔（讓某個移轉的相依者先被撤銷），然後刪除對應的 `schema_migrations` 資料列。那些資料列消失之後，下次你啟動仍帶著這些移轉的分支時，往前的執行程式就會重新套用它們。

> **請在還待在分支上時執行。** 回溯會從磁碟讀取 `NNN_description.down.sql`。一旦你 `git checkout main`，那些檔案就消失了，回溯再也無法執行。請先回溯，再切換分支。

> **它仍然是有損的。** 在這裡回溯 `034` 會執行 `DROP TABLE short_term_memories`，測試期間建立的任何資料都會消失。對測試清理來說這是預期行為，但永遠不要在沒有備份的情況下對你想保留的資料執行 `migrate:down`。

## 延伸閱讀

- [資料庫結構描述文件](../systems/database-schema)：了解目前的結構描述結構
- [設計決策 OD-R-6（Down 移轉的形狀）](../../plans/refactor/shared/open-decisions.md#od-r-6-down-migration-shape)：移轉安全政策的技術理由
- [Bun 說明文件](https://bun.sh)：了解 Bun 執行環境的基本概念
