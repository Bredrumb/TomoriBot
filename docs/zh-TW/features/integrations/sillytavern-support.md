---
title: "SillyTavern 支援"
# 針對「SillyTavern character cards in Discord」查詢的關鍵字豐富
# <title>，只取代這一頁 Starlight 的預設值。H1 與側邊欄
# 仍使用單純的標題。
head:
  - tag: title
    content: "TomoriBot | 在 Discord 中使用 SillyTavern 角色卡"
# 手寫的搜尋摘要，會覆寫 routeData.ts 中介層自動產生的 description。
description: "用 TomoriBot 把 SillyTavern 角色卡與提示詞預設集匯入 Discord。把你既有的角色帶進你的伺服器。"
sidebar:
  order: 2
---

TomoriBot 可以從 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 匯入兩種你可能已經有的東西：**Prompt Manager 預設集**（提示詞的編排方式）與**角色卡**（角色本身）。這是給 ST 使用者的利基功能；如果你從沒用過 SillyTavern，可以跳過這一頁。

## 角色卡匯入

用 `/persona import` 把既有的 SillyTavern 角色直接帶進 Discord。它接受：

- 內嵌 `chara` / `char` 中繼資料的 **PNG 卡**，
- **v2 風格 JSON** 卡（根層級的 `name`、`description`、`first_mes`……），
- **v3 JSON** 卡（`spec: "chara_card_v3"`，內含嵌套的 `data` 物件），
- **`.charx` 壓縮檔**（Character Card V3，角色卡網站預設發放的格式）。

`.charx` 檔是一個 zip，其中的 `card.json` 存放角色。TomoriBot 會讀取那張卡，並忽略壓縮檔中的其他所有東西：內附的圖示、表情立繪、音訊與影片都不會匯入，匯入回覆也會說明這點。用 `/server avatar` 設定頭像，並在 `/config` > 人格 > 立繪 底下新增立繪。

如果檔案沒有 TomoriBot 中繼資料，但是一張有效的 ST v2 或 v3 卡，匯入會自動讓它走 SillyTavern 轉換流程。你也可以把一張卡交給 `/persona generate`，把它轉換成全新的人格。

匯入在儲存任何東西之前會先通過驗證結構描述（預設上限：每個字串 5,000 個字元、200 個屬性、每一側 100 組範例對話、100 個觸發詞；自架者可以調整 `PRESET_MAX_*` 環境變數）。壓縮檔讀取另外由 `MAX_CHARX_*` 環境變數限制，因為壓縮檔的壓縮後大小完全不代表它解開後有多大。確切的轉換與欄位對應請看[角色卡支援架構](/en/architecture/integrations/sillytavern/card-support/)。

## 提示詞預設集
<!-- anchor: prompt-presets -->

SillyTavern 的 Prompt Manager 預設集控制提示詞的**編排**。用 `/config` > 外掛 > SillyTavern 預設集 匯入預設集、檢視已啟用的節點、在預設集之間切換，或回到一般編排。

### 預設集控制什麼

- 提示詞順序與標記位置
- 自訂提示詞節點
- 歷史後注入與深度注入節點
- 哪些匯入的節點起始時為啟用或停用

### 它*不*取代什麼

預設集擁有的是*編排*，而不是每一個文字來源。以下這些仍然與它並存：

- 你的系統與人格區塊：`/config` > 行為 > 一般行為、`/config` > 人格 > 進階，以及 `/config` > 人格 > 身分與個性 上的屬性與範例對話動作。
- 即時對話紀錄與取回的文件脈絡。
- TomoriBot 的自動脈絡：伺服器記憶、表情符號與貼圖脈絡、對話中的使用者、短期記憶、制約，以及類似的區塊。

### 原生區塊如何對應

- `main` → 目前的系統提示詞（`/config` > 行為 > 一般行為，否則使用內建備援）
- `charDescription` → `/config` > 人格 > 進階
- `charPersonality` → `/config` > 人格 > 身分與個性
- `dialogueExamples` → `/config` > 人格 > 身分與個性
- `chatHistory` → 即時頻道紀錄
- `worldInfoBefore` / `worldInfoAfter` → 取回的文件脈絡（不是 ST 的 lorebook）

### 系統提示詞規則

預設集生效時，內建的備援系統提示詞會被移除，但如果*你*用 `/config` > 行為 > 一般行為 設定自己的提示詞，它仍然會送出。

### 相容性注意事項

預設集看起來被忽略時，常見的意外：

- 匯入不等於送出：在 `prompt_order` 中被停用的節點會保持關閉，直到你用 `/config` > 外掛 > SillyTavern 預設集 啟用它們。只有註解的節點與空節點永遠不會送出；未知的標記會被略過。
- 順序是照字面套用的：把 `chatHistory` 放在 `dialogueExamples` 之前，就會先送出即時聊天。
- 歷史後與深度注入會合併進既有的對話紀錄項目，而不是變成獨立訊息；同一深度的多個節點會批次處理。
- 不支援規則表達式後處理、預設集端的 temperature、top-p 或模型覆寫，以及分層預設集。舊式的文字補全預設集會走一條盡力而為的路徑匯入，並捨棄 ST 專屬的區塊（scenario、anchors、stop strings……）。

在 `/help` 中選擇 **整合**，然後選 `SillyTavern 預設集`，就能看到 Discord 內的參考。匯入引擎的內部細節請看[預設集系統架構](/en/architecture/integrations/sillytavern/preset-system/)。
