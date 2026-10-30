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
卡片中的角色書會成為該人格的[世界書](/features/knowledge/lorebooks/)。已停用的條目會保持停用狀態。重新匯入卡片會取代該人格的整本世界書，包含你自己新增的條目。
:::

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

### 條件式指令

使用Handlebars區塊在特定值存在時才納入相應指令：

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

像 `description` 這樣的簡稱代表 `{{description}}`。你也可以直接在條件式中放置數值巨集，如 `{{#if {{input}}}}`。在修剪前後空格並忽略大小寫後，空文字、`false` 與 `0` 均判定為偽。條件式中未知的巨集視為空白。

區塊支援巢狀結構，包含TomoriBot的 `{{if capability:web_search}}` 與 `{{if tool:web_search}}` 區塊。使用 `{{/if}}` 閉合 `#if`，使用 `{{/unless}}` 閉合 `#unless`。格式有誤的區塊（例如出現第二個 `else` 或不正確的閉合標籤）會被忽略。缺少閉合標籤的Handlebars區塊會在該節點末端結束。多餘孤立的 `else` 與閉合標籤會被捨棄。超過32層的巢狀區塊會保持未渲染的條件式語法。匯入提示會回報這些問題。

`{{setvar::key::value}}` 用於儲存文字；`{{addvar::key::value}}` 用於附加文字。未執行的Handlebars分支中的宣告不會生效。條件式可以讀取節點順序中較早出現的宣告，包含同一節點中前面部分的宣告。純文字中的 `{{getvar::key}}` 會在走訪完所有已啟用的節點後取得最終值。工具與功能條件在其後執行，因此它們不控制變數賦值。

### 預設集巨集
<!-- anchor: preset-macros -->

| 巨集 | 數值 |
|---|---|
| `{{user}}` | 觸發回覆的成員 |
| `{{char}}`, `{{bot}}` | 目前使用中的人格名稱 |
| `{{personality}}` | 人格屬性 |
| `{{description}}` | 人格提示詞 |
| `{{scenario}}` | 空白：卡片中的情境已合併至人格屬性中 |
| `{{mesExamples}}` | 範例對話文字 |
| `{{lastChatMessage}}`, `{{input}}` | 提供的對話中最近一則使用者訊息 |
| `{{time}}` | 伺服器時間，例如 `3:45 PM` |
| `{{date}}` | 伺服器日期，例如 `October 28, 2026` |
| `{{weekday}}` | 英文星期名稱，例如 `Wednesday` |
| `{{isotime}}` | `HH:mm` 格式的伺服器時間，例如 `15:45` |
| `{{isodate}}` | `YYYY-MM-DD` 格式的伺服器日期，例如 `2026-10-28` |
| `{{model}}` | 設定的模型 ID；每輪隨機選取的模型與備用模型不會反映在此處 |
| `{{provider}}` | 設定的供應商 ID：`google`、`openrouter`、`novelai` 或 `custom` |
| `{{char_version}}` | 空白：角色卡版本不予儲存 |

時間相關的巨集在每次組裝提示詞時共用一次時鐘讀數，並使用伺服器的數值型 UTC 偏移。日光節約時間遵循你設定的偏移。成員的個人時區不會影響它們。當時間感知關閉時，所有5個時間巨集均為空白，測試它們的條件式判定為偽。請將時間巨集放在靠後或深度注入的節點中：像 `{{time}}` 這樣變動的值會使其之後的所有內容在供應商的提示詞快取中失效。

`{{random: A, B}}` 與 `{{random::A::B}}` 用於隨機選取項目；`{{roll:2d6}}` 用於擲骰子。`{{// notes}}` 用於移除註解，`{{trim}}` 用於修剪節點周圍的空白字元。這些巨集與條件式僅適用於預設集指令。世界書條目僅支援展開 `{{user}}`、`{{char}}` 與 `{{bot}}`。

### 相容性注意事項

- 在 `prompt_order` 中停用的節點將保持停用狀態，直到在 `/config` > `外掛` > `SillyTavern 預設集` 中啟用為止。空白節點與僅含註解的節點永遠不會傳送給模型。
- 區塊順序按字面順序執行：將 `chatHistory` 置於 `dialogueExamples` 之前會將聊天歷史紀錄放在提示詞的最前面。
- 歷史紀錄後置注入會合併到現有的對話歷史紀錄中，而不是作為獨立訊息傳送。
- 不支援正規表示式後處理、預設集定義的取樣參數（溫度、top-p）與分層預設集。舊版文字補全預設集在匯入時會捨棄SillyTavern專屬區塊。

在 `/help` 中選擇 `外掛`，然後選擇 `SillyTavern 預設集`，可查看Discord內指南。內部預設集處理機制請參閱[預設系統架構](/architecture/integrations/sillytavern/preset-system/)。
