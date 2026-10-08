---
title: "資料處理"
sidebar:
  order: 4
---

使用Discord斜線指令匯出、備份、匯入或刪除你的設定、記憶和人格。有關服務條款和隱私詳細信息，請參閱`/legal terms-of-service`和`/legal privacy-policy`。

:::note
本頁涵蓋Discord內的使用者控制項。在自架實例上，完整資料庫備份和還原是主機端操作；請參閱[維護與備份](/zh-TW/self-hosting/maintenance/)。
:::

## 她儲存什麼

### 儲存數據

- 伺服器和個人記憶
- 人格簡介、特徵和對話範例
- 伺服器配置設定
- 加密供應商API金鑰
- 表情元資料、人格存取規則和上傳的表情媒體

### 未儲存

- Discord訊息歷史記錄（訊息未存檔在持久訊息日誌中）

### 發送給你的AI供應商

每當觸發時，TomoriBot都會取得通道中的最新消息以及相關記憶體作為模型的上下文。她不會閱讀或處理這些觸發器之外的消息。

:::note
你選擇的AI供應商（Google、OpenRouter、NovelAI等）根據自己的隱私權政策處理訊息。避免共享敏感的個人憑證或機密資料。
:::

## 匯出你的資料

可匯出的資料以JSON檔案形式傳送到你的DM：

- `/export config`：伺服器設定值（不包括API金鑰和憑證）。
- `/export personal config`：個人資料設定（隱私、外觀標籤、命名）。
- `/export memories`：伺服器內存，範圍為主要人格、一個人格或所有人格。
- `/export personal memories`：個人記憶，範圍全域或每個人格。
- `/persona export`：完整的人格定義。

上傳的表達媒體儲存在伺服器主機上，並且位於這些JSON匯出之外。自架者必須同時備份資料庫儲存和媒體資產；請參閱[自訂媒體備份](/zh-TW/self-hosting/safe-migration/#custom-expression-media-backups)。

## 匯入你的資料

附加導出的文件以將其恢復：

- `/import config`：伺服器設定（需要管理伺服器）。選擇要應用的部分。
- `/import personal config`：個人設定。選擇要套用的偵測到的部分。
- `/import memories`：伺服器記憶體（需要管理伺服器）。合併或取代並映射人格。
- `/import personal memories`：個人回憶。合併或取代並映射人格。
- `/persona import`：恢復人格。也匯入SillyTavern PNG卡、JSON卡和`.charx`檔案（請參閱 [SillyTavern支援](/zh-TW/features/integrations/sillytavern-support/)）。

## 刪除你的資料

這些操作永久刪除或重置儲存的資料：

- `/personal memories`：管理或刪除個人記憶。
- `/memories`：管理或刪除伺服器記憶體（需要管理伺服器）。
- `/personal nuke`：永久刪除所有跨伺服器的個人資料。
- `/nuke`：擦除伺服器數據，包括自訂表達式和人格存取規則。設定`preserve_personas: true`以保留人格，同時刪除自訂表達式和媒體。
- `/reset config`：將伺服器配置還原為資料庫預設值。
  - **保留**：活動模型分配、API金鑰、自訂端點、人格、伺服器記憶體和整合。
  - **清除**：通道覆蓋、自動觸發規則、使用者黑名單和通道白名單。
  - 需要伺服器中的管理伺服器權限；也可在DM中使用。
- `/reset personal config`：將個人資料設定和頻道對焦恢復為預設值。
  - **保留**：使用者身分、個人記憶、已儲存的供應商API金鑰、自訂端點和排程任務。
  - **清除**：暱稱覆蓋、外觀標籤、代名詞、稱呼風格和頻道焦點。
  - 可供伺服器和DM中的所有使用者使用。

有關確切的資料庫表和保留的列列表，請參閱[資料庫架構架構](/en/architecture/subsystems/database-schema/#reset-domain-classifications)。

## 選擇退出

- `/personal config`：控制你的可見性，直至完全不可見（選擇退出記憶體上下文）。
- `/config` > `權限`：伺服器管理員可以關閉自學習和記憶體功能。

日常記憶體管理請參考[記憶體](/zh-TW/features/knowledge/memory/)。
