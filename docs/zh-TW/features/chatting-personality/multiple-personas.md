---
title: "多個人格"
# 針對「AI companion Discord」查詢的關鍵字豐富 <title>，只取代這一頁
# Starlight 的預設 "{title} | TomoriBot"。H1 與側邊欄仍使用單純的標題。
# 首頁標題主打 "AI agent" 加 "roleplay"，這一頁則改扛 "companion" 關鍵字。
head:
  - tag: title
    content: "TomoriBot | 你的 Discord 伺服器上的 AI 夥伴與人格"
# 手寫的搜尋摘要，會覆寫 routeData.ts 中介層自動產生的 description。
description: "在同一個 Discord 伺服器裡跑多個 AI 夥伴。自訂人格各自擁有頭像、觸發詞與說話風格。"
sidebar:
  order: 2
---

TomoriBot 的人格存在一個**人格**裡：她的名字、頭像、特質、說話風格與行為。你可以同時跑好幾個人格，每一個都是獨立的角色，擁有自己的觸發詞與 webhook 頭像。這一頁談的是*她怎麼表現*；至於*她知道什麼*（事實與記憶），請看[記憶](/zh-TW/features/knowledge/memory/)。

## 建立人格

- `/persona create`：從零開始打造自訂人格。
- `/persona generate`：讓 AI 依描述與圖片生成人格。這需要支援結構化輸出的供應商。你也可以在這裡上傳既有的 TomoriBot 預設集或 SillyTavern 角色卡，把現成的角色改造過來（請看 [SillyTavern 支援](/zh-TW/features/integrations/sillytavern-support/)）。
- `/persona default`：切換到其中一個內建的預設人格當作基礎。
- `/persona export` / `/persona import`：把人格以檔案形式分享或備份。匯入支援把人格以 **alter** 的形式帶進來，並擁有自己的觸發詞與 webhook 頭像。
- `/persona remove`：移除一個 alter 人格。

好的起始流程：挑一個預設人格或生成一個，再用下方的屬性與範例對話慢慢調整。

## alter 人格

alter 人格讓多個角色共用同一個伺服器：

- 每個 alter 都有自己的個性、觸發詞與 **webhook 頭像**，所以不同角色會在同一頻道以不同的名稱與圖片出現。
- 多個 alter 可以回應同一則訊息，上限是 `/config` > 行為 > 觸發行為 的限制。
- **回覆 webhook 訊息**會以那個人格的身分延續對話。
- 用 `/persona import`（alter 選項）新增 alter；用 `/persona` 與 `/persona remove` 管理它們。

這正是團體角色扮演與多角色伺服器得以成立的原因。關於觸發如何路由到人格，以及 webhook 身分如何運作的執行細節，請看[多個人格行為](/en/architecture/subsystems/multi-persona/)的架構參考。

## 塑造人格

有兩個指令負責教她怎麼說話、怎麼行動的大部分工作：

### 屬性

`/config` > 人格 > 身分與個性 可以加入人格特質或外貌特徵，例如 `friendly`、`red hair`，或 `ends sentences with *Nya~*`。用 `/config` > 人格 > 身分與個性 移除它們。

### 範例對話

`/config` > 人格 > 身分與個性 用範例教她*她怎麼說話*。使用 `{user}` 與 `{bot}` 預留位置，對話才能對所有人都成立（分享人格時也是）：

- `{user}`：替換成實際使用者的名稱或暱稱
- `{bot}`：替換成她目前的名字

```text
{user}: 你最喜歡的興趣是什麼？
{bot}: 呼呼～我喜歡幫小小的絨毛玩偶織小小的衣服～♥
```

有效範例對話的訣竅：

- 寫自然、像對話的往來。
- 把你希望她展現的屬性與特質寫進去。
- 示範你想要的口氣，並加入變化，她才會舉一反三。

用 `/config` > 人格 > 身分與個性 移除範例。

### 名稱與頭像

- `/config` > 人格 > 身分與個性：設定她怎麼稱呼自己。
- `/config` > 人格 > 身分與個性：設定她在這個伺服器的個人圖片。

你也可以用 `/config` > 行為 > 一般行為 設定自訂系統提示詞，進一步塑造行為，請看[行為調整](/zh-TW/features/chatting-personality/behavior-tweaking/)。

## 立繪（表情頭像）

立繪是人格在對話中為了表達情緒或情境而切換的替代頭像圖片，可以把它們想成她的表情。每個立繪都是一張有標籤的圖片（例如 `happy`、`mad`、`embarrassed`），當情境合適時，她會用它取代平常的頭像。

她怎麼使用：每一輪對話都會把可用的立繪與用途備註交給模型。要展示某個立繪，她會用 `PersonaName (label):` 開頭寫一行回覆；那一行就會搭配對應的立繪圖片送出。如果沒有合適的立繪，她就正常回覆。

在 `/config` > 人格 > 立繪 管理人格的立繪（新增與移除需要 **管理伺服器** 權限）：

- `/config` > 人格 > 立繪：新增或取代立繪，選好人格、給它一個**名稱**、上傳**圖片**（PNG、JPG 或 GIF），並可選填**用途**告訴她什麼時候使用。重複使用同一個名稱就會取代那個立繪。每個人格都有立繪數量上限。
- `/config` > 人格 > 立繪：變更既有立繪的名稱、圖片、指示或身分切換。
- `/config` > 人格 > 立繪：從人格刪除立繪。
- `/config` > 人格 > 立繪 的匯出與匯入：把人格的整套立繪以檔案備份或分享。

**身分**切換會把訊息名稱裝飾成 Discord 上的 `Label (Persona)`，對以不同角色身分發言的 [alter 人格](#alter-人格)特別有用。

變更預設人格的頭像會移除它原本附帶的立繪，因為那些立繪顯示的是原始角色的臉。你自己新增的立繪會保留。執行 `/persona default` 就能把預設立繪找回來。

## 各頻道的人格選擇

想控制某個特定頻道裡由哪個人格回覆*你*，又不想更動整個伺服器的設定嗎？那就是個人聚光燈，請看[個人化](/zh-TW/features/knowledge/personalization/#個人聚光燈)。

## 人格專屬的稱呼方式

伺服器管理員可以用 `/config` > 人格 > 身分與個性，為每個人格設定獨立的陽性、陰性與中性前綴、後綴，以及獨立的稱呼詞。使用者自己以人格為範圍的覆寫，是以穩定的 persona lineage 為鍵，所以兩個人在同一則多角色回覆中可能用不同名字稱呼 Sparrow，而兩者仍然指向同一個 Discord 使用者。先編輯官方指標會建立一份獨立副本，永遠不會改到共用的目錄，也不會改到另一個伺服器的人格。
