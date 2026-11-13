---
title: "維護與備份"
sidebar:
  order: 5
aiGenerated: true
---

使用CLI維護腳本來管理你的自架TomoriBot實例：更新程式碼、備份或還原資料、輪換加密金鑰以及檢查環境變數。從主機終端機或Docker環境執行這些指令。關於Discord內的資料匯出與刪除，請參閱[資料處理](/features/knowledge/data-handling/)。

TomoriBot會在啟動時套用擱置的資料庫遷移。部分遷移可能會移除資料且不會自動回溯，因此在更新或切換分支之前請先備份。

## 維護腳本

| 指令 | 說明 |
|---|---|
| `bun run setup` | 開啟設定精靈，進行基礎安裝與選用模組。 |
| `bun run update` | 先備份，再拉取最新程式碼並安裝相依套件。 |
| `bun run backup` | 在`backups/`中建立包含資料庫傾印與所需加密版本中繼資料的套件。秘密資訊分開保存。 |
| `bun run restore-backup` | 使用分開佈建的加密金鑰還原資料庫（`--latest`或`--from backups/<dir>`）。 |
| `bun run backup:personas` | 僅匯出所有伺服器上的人格（含伺服器記憶）；透過`/persona import`重新匯入。 |
| `bun run nuke-db` | 捨棄所有資料表（之後啟動bot即可重新初始化）。 |
| `bun run purge-commands` | 清除所有已註冊的Discord斜線指令。 |
| `bun run rotate-keys --bot-stopped` | 把所有加密欄位重新加密到目前的金鑰版本。 |
| `bun run env-doctor` | 唯讀檢查你的設定：列出沒有任何程式碼讀取的`.env`項目（僅名稱，絕不包含值）以及每個變數的使用位置。 |

主機上的`bun run backup`需要PATH中有`pg_dump`，主機上的`bun run restore-backup`需要PATH中有`psql`。`bun run update`的備份需要`pg_dump`。`--docker`更新路徑在容器內執行備份，因此需要主機具備Bun、Git與Docker，但不需要主機具備PostgreSQL工具。

若使用本機頭像，請保留TomoriBot管理的網路鉤子：刪除它們會導致bot無法編輯較舊的網路鉤子訊息。

## 閒置 API 金鑰清理
<!-- anchor: inactive-api-key-cleanup -->

將 `API_KEY_INACTIVITY_DAYS` 設定為正整數並重新啟動 bot，即可啟用資料庫憑證清理。未設定則會停用刪除。例如：

```dotenv
API_KEY_INACTIVITY_DAYS=90
```

金鑰在經過該天數而沒有驗證請求後便會過期。失敗的供應商回應也計為活動。從未使用的金鑰自寫入或替換時起算時間；現有金鑰在首次安裝活動追蹤功能時會獲得完整的寬限期。在停用刪除的情況下追蹤仍會持續進行，因此日後啟用該政策可能會立即移除已休眠的金鑰。清理會在啟動時執行，並在主要處理程序上每小時分批定量執行。

此政策涵蓋伺服器、個人、額外的輪替以及選用服務的 API 金鑰。已儲存的模型設定將會保留。符合資格的額外輪替金鑰可自動取代過期的主要金鑰。透過 `/providers` 或 `/personal providers` 重新輸入已移除的金鑰即可恢復服務；語音設定可能也需要重新選取。包含 Vertex ADC 在內的主機憑證仍受維運者控制。

從資料庫中移除並不會向其供應商撤銷金鑰，也不會抹除保留的備份。受侵害的金鑰請透過供應商控制台撤銷。已建立的語音等供應商端資源在清除儲存的金鑰後，可能也需要手動移除。請另外設定備份保留週期。

## 資料庫備份與復原金鑰
<!-- anchor: database-backups-and-recovery-keys -->

資料庫套件包含私人資料與所需加密版本的清冊。它們不包含`.env`或媒體。請保護套件並將每個所需的加密金鑰分開存放；少了舊金鑰，使用該金鑰加密的憑證將無法復原。

若要還原受信任的備份：

1. 停止每個bot實例。設定目標資料庫、Discord權杖與原始加密金鑰。
2. 安裝`psql`與所需的資料庫擴充功能，包含`pgvector`。資料庫帳號必須能夠啟用`pgcrypto`，或者必須先由管理員啟用。
3. 執行`bun run restore-backup --latest`或`bun run restore-backup --from backups/<bundle-directory>`。檢查目標並確認提示。還原程式會在執行破壞性SQL之前先檢查金鑰。
4. 重新啟動前執行`bun run audit-keys`與`bun run rotate-keys --dry-run`。若憑證需要遷移，請執行`bun run rotate-keys --bot-stopped`並再次稽核。若還原失敗，請保持bot停止狀態：先前的SQL陳述式可能已經變更了資料庫。

請單獨備份本機`data/`目錄，包含頭像、語音樣本與`data/custom-expressions/`。將檔案還原到相同路徑。對於GCS或S3表情，請備份`custom-expressions/`物件並將其金鑰還原到設定的相同儲存貯體。連結表情則取決於其外部主機。

在非生產環境中，當bot版本變更或最新備份至少已有`TOMORI_AUTO_BACKUP_INTERVAL_HOURS`之久（預設24小時）時，啟動會建立資料庫備份。它會保留`TOMORI_AUTO_BACKUP_MAX`份備份（預設5份）；設定`TOMORI_AUTO_BACKUP_ENABLED=false`可停用此功能。這些備份不包含媒體或加密金鑰。

較舊的套件可能在`config.env`中包含秘密資訊。還原程式不會載入它；請私下檢查並透過常規秘密資訊來源提供所需的金鑰。

## 對話錄製儲存
<!-- anchor: conversation-recording-storage -->

[對話錄製](/features/setup-administration/conversation-recordings/)會將主動啟用的伺服器節錄儲存在你的資料庫中。周圍訊息模式可包含其他參與者。請將資料庫存取權限與備份視為私人對話資料加以保護；身分替換並不會讓文字完全匿名。

若要依時間讓儲存的節錄過期，請在 bot 環境中將 `RECORD_RETENTION_DAYS` 設定為正整數（例如 `RECORD_RETENTION_DAYS=30`），並重新啟動所有實例。若留空該變數則不會依時間過期。空值、零、負數、小數或其他無效數值將導致啟動驗證失敗。共用資料庫的各個實例之間應使用相同數值。

該限制適用於現有節錄與新節錄，從觸發時間戳記起算。讀取與寫入均會強制執行過期限制；主要處理程序每分鐘會分批定量執行清理。實體清理可能需要多個批次。收集持續時間僅控制何時停止擷取。當關閉時間過期時，跨伺服器每位擁有者 100 MiB 的邏輯配額仍適用，且可能會提前移除最舊的完整節錄。實體資料庫或索引的使用量可能與該配額不同。

資料庫備份包含錄製資料。即時保留、隱私清理與刪除不會重寫備份套件或已下載的匯出檔案。請設定獨立的備份生命週期，保護復原複本，並在重新開啟 bot 前檢查還原的資料：錯過的來源刪除無法從閘道事件中重構。錄製匯出檔案是來源節錄，無法用於還原資料庫。生命週期所有權請參閱[架構約定](/architecture/subsystems/conversation-recording/)。

## 輪換加密金鑰
<!-- anchor: rotating-encryption-keys -->

1. 備份資料庫並將所有現有金鑰保存在受保護的儲存空間中。在停用任何金鑰之前，先在一次性資料庫上測試復原。
2. 使用`openssl rand -base64 32`產生新金鑰。將其作為`CRYPTO_SECRET_V<version>`新增到bot的秘密資訊來源中，並使用`CRYPTO_SECRET_CURRENT`選取它。保留較舊版本；`CRYPTO_SECRET`即為V1。
3. 停止每個bot實例與憑證寫入程式。使用與bot相同的秘密資訊來源與資料庫設定；生產腳本還需要`RUN_ENV=production`。
4. 執行`bun run audit-keys`與`bun run rotate-keys --dry-run`。兩者都必須成功才能繼續。
5. 執行`bun run rotate-keys --bot-stopped`，然後執行`bun run audit-keys`。若任一項失敗，請保持bot停止狀態，並在修復問題時保留所有金鑰版本。
6. 使用保留的目前金鑰在還原的一次性資料庫上進行測試。在從現行秘密資訊來源移除舊版本之前，先使用封存金鑰測試較舊的備份。只要其備份仍存在，就請保留封存金鑰，然後重新啟動bot。

`--bot-stopped`記錄你的確認；它無法偵測另一個正在執行的實例，也無法清除其憑證快取。

## 更新

先停止正在執行的bot，然後使用備份優先的更新程式：

```sh
bun run update
```

更新程式會備份資料庫、拉取程式碼並安裝相依套件。若你從`dist/`執行，請使用`--build`。關於Compose，請參閱[Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups)。媒體與加密金鑰請分開備份。

使用獨立的資料庫來測試分支：切換回去並不會復原遷移。若遷移失敗，請保持bot停止狀態、檢查記錄，並在返回先前的版本前遵循上述復原步驟。更新前使用`git rev-parse HEAD`記錄目前的提交，以協助復原。

### 環境變更

執行`bun run env-doctor`來尋找`.env`中未使用的設定。指令冷卻時間使用`COMMAND_COOLDOWN_SCALE`（預設為`1`；`0`會停用冷卻時間）。

本機TTS伺服器不再使用先前的Bearer權杖設定來驗證請求。在將其公開至機器外部之前，請檢視[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access)。每個引擎使用自己的連接埠設定。

## 備份與還原

```sh
bun run backup
bun run restore-backup --latest
# 或選擇一個套件：
bun run restore-backup --from backups/<bundle-directory>
```

套件儲存在`backups/`或`TOMORI_BACKUP_DIR`中。還原前請遵循[復原步驟](#database-backups-and-recovery-keys)。`bun run backup:personas`會為`/persona import`匯出人格與伺服器記憶；它無法還原資料庫。

## Docker Compose備份

Docker Compose支援在應用程式容器內進行自動啟動備份。套件會寫入主機的`backups/`目錄，因為Compose會將其掛載到容器中。

手動Docker備份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker還原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

## 乾淨重新安裝

`bun run nuke-db`會捨棄所有資料表；之後啟動bot會從頭重新初始化結構描述、種子資料與遷移。當你想要一個仍然可以回溯的乾淨狀態時，請將它與全新的`bun run backup`搭配使用：絕不要在沒有最新備份的情況下執行它。
