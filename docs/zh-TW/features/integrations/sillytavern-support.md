---
title: "SillyTavern支援"
# 針對「SillyTavern character cards in Discord」查詢的關鍵字豐富
# <title>，只取代這一頁Starlight的預設值。H1與側邊欄
# 仍使用單純的標題。
head:
  - tag: title
    content: "TomoriBot | 在Discord中使用SillyTavern角色卡"
# 手寫的搜尋摘要，會覆寫routeData.ts中介層自動產生的description。
description: "用TomoriBot把SillyTavern角色卡與提示詞預設集匯入Discord。把你既有的角色帶進你的伺服器。"
sidebar:
  order: 2
aiGenerated: true
---

TomoriBot可以從 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 匯入資源：
提示管理器預設（控制提示詞結構）、角色卡（角色定義）以及世界書（內嵌的角色書或獨立的世界設定檔案）。
如果你從未使用過SillyTavern，可以安全地略過此頁面。

## 角色卡匯入

使用 `/persona import` 將現有的SillyTavern角色帶入Discord。它支援：

- 具有內嵌 `chara` 或 `char` 中繼資料的 **PNG卡片**。
- 具有根層級屬性的 **v2樣式JSON** 卡片（`name`、`description`、`first_mes`）。
- **v3 JSON** 卡片（帶有巢狀 `data` 物件的 `spec: "chara_card_v3"`）。
- **`.charx`封存檔**（角色卡V3套件）。

`.charx`檔案是包含 `card.json` 定義的ZIP封存檔。TomoriBot從 `card.json` 匯入角色文字，並略過綑綁的資源檔案（圖示、立繪、音訊、影片）。你可以在 `/config` > `人格` > `身分與個性` 中設定頭像，在 `/config` > `人格` > `立繪` 中新增立繪。

如果上傳的檔案是不含TomoriBot中繼資料的有效SillyTavern卡片，匯入時會自動進行轉換。你也可以將卡片傳給 `/persona generate`，以建立受該角色啟發的新人格。

匯入在儲存前會進行驗證（預設限制：每個文字欄位5,000個字元、200個屬性、每側100組範例對話、100個觸發詞）。有關欄位對應與轉換機制，請參閱[卡片支援架構](/architecture/integrations/sillytavern/card-support/)。

:::tip
卡片中的角色書會成為該人格的[世界書](/features/knowledge/memory/lorebooks/)。已停用的條目會保持停用狀態。重新匯入卡片會取代該人格的整本世界書，包含你自己新增的條目。
:::

## 角色卡匯出

使用 `/persona export` 並將 `output_format` 設為 `相容於SillyTavern的PNG`，即可將人格匯出並帶入SillyTavern。這張卡片包含頭像、人格屬性、範例對話、人格提示詞與人格世界書。卡片不含開場白；開始聊天前請先在SillyTavern中新增一則。

TomoriBot專屬設定（例如觸發詞、搭話、語音設定與世界書頻道限制）不會包含在內。若要保留TomoriBot人格設定，請選擇 `TomoriBot卡片` 或 `原始JSON`。`TomoriBot組合包` 還會攜帶立繪與角色參考媒體，並在要求時包含語音參考音訊。這個 ZIP 屬於 TomoriBot 格式；若要匯入 SillyTavern，請使用相容於SillyTavern的PNG。

## 提示詞預設集
<!-- anchor: prompt-presets -->

SillyTavern提示管理器預設集控制傳送給模型的提示詞順序與版面配置。開啟 `/config` > `外掛` > `SillyTavern 預設集` 以匯入預設集、切換個別節點、切換使用中的預設集或還原預設格式。

:::tip
匯入與現有預設集同名的預設集會取代該預設集（包含你先前開啟或關閉的節點狀態），並啟用新的預設集。如果你想同時保留兩者，請為每個變體取不同的名稱。
:::

### 預設集控制的內容

- 提示詞順序與標記位置
- 自訂提示詞節點
- 歷史紀錄後置節點與深度注入節點
- 匯入節點的初始啟用狀態

### 預設集無法取代的內容

預設集用於建構提示詞版面配置；它不會取代填入其中的文字來源：

- 系統指示與人格欄位：`/config` > `行為` > `一般行為`、`/config` > `人格` > `進階` 以及 `/config` > `人格` > `身分與個性`。
- 即時聊天歷史紀錄、檢索到的文件脈絡以及已啟用的世界書條目。
- 自動情境：伺服器記憶、表情符號與貼圖資料、參與者清單以及短期記憶。

### 原生區塊如何對應

原生區塊直接對應到TomoriBot的提示詞元件：

- `main`：設定時的頻道提示詞覆寫
- `charDescription`：`/config` > `人格` > `進階`
- `charPersonality`：`/config` > `人格` > `身分與個性`
- `dialogueExamples`：`/config` > `人格` > `身分與個性`
- `chatHistory`：即時頻道訊息歷史紀錄
- `worldInfoBefore` 與 `worldInfoAfter`：對應插入位置的世界書條目，其後緊接檢索到的文件脈絡

### 系統提示詞規則

當匯入的預設集處於啟用狀態時，將完全由該預設集控制系統提示詞。TomoriBot的內建提示詞以及來自 `/config` > `行為` > `一般行為` 的任何自訂提示詞都不會傳送，且該處的系統提示詞按鈕將會鎖定。你的自訂提示詞仍會保留，當你在 `/config` > `外掛` > `SillyTavern 預設集` 中關閉預設集時，該提示詞將會恢復生效。

### 預設集巨集
<!-- anchor: preset-macros -->

使用[預設集巨集](/features/prompt-macros/#sillytavern-preset-macros)在預設集節點中插入人格細節、最新使用者訊息或伺服器時間。

### 條件式指令
<!-- anchor: conditional-instructions -->

使用[預設集條件式](/features/prompt-macros/#preset-conditionals)根據數值來選擇指示，例如人格是否具有描述。

### 相容性注意事項

- 在 `prompt_order` 中停用的節點將保持停用狀態，直到在 `/config` > `外掛` > `SillyTavern 預設集` 中啟用為止。空白節點與僅含註解的節點永遠不會傳送給模型。
- 標記順序按字面順序執行：將 `chatHistory` 置於 `dialogueExamples` 之前會將聊天歷史紀錄放在最前面。世界資訊標記決定 Always On 世界書的位置；已觸發的世界書、檢索到的文件、參與者在線狀態與時鐘則保持在最新四個發言回合附近。最新或跨頻道的短期記憶也同樣保持在那些訊息附近，或在有設定的情況下更靠近。
- 歷史紀錄後置注入會合併到現有的對話歷史紀錄中，而不是作為獨立訊息傳送。
- 不支援正規表示式後處理、預設集定義的取樣參數（溫度、top-p）與分層預設集。舊版文字補全預設集在匯入時會捨棄SillyTavern專屬區塊。

在 `/help` 中選擇 `外掛`，然後選擇 `SillyTavern 預設集`，可查看Discord內指南。內部預設集處理機制請參閱[預設系統架構](/architecture/integrations/sillytavern/preset-system/)。
