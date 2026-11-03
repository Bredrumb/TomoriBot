---
title: "提示詞內部"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot 通常依序傳送這些提示詞區塊。
[NovelAI](/features/integrations/novelai/) 涵蓋了其例外情況。

| 區塊 | 選用？ | 指令 | 說明 |
|---|---|---|---|
| [系統提示詞](/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > 行為 > 一般行為 | 脈絡最頂部的基本說明。 |
| 頻道提示詞（追加） | *(選用)* | `/config` > 頻道 > 頻道覆寫 | 每個頻道有所不同，在系統提示詞後立即分層。同一頁面的 *替換* 模式接管上面的系統提示詞槽位，而不是新增新的提示詞槽位。 |
| 人格提示詞 | *(選用)* | `/config` > 人格 > 進階 | 專為使用中人格所寫的提示詞，與系統提示詞分開。 |
| [人格屬性](/features/chatting-personality/multiple-personas/#attributes) | | `/config` > 人格 > 身分與個性 | 使用中人格的性格特徵與言語模式。 |
| 伺服器資訊 | | *(無，來自 Discord)* | 伺服器名稱、說明與她所在的頻道，直接從 Discord 本身提取。 |
| [人格-使用者封鎖](/features/capabilities/tools-and-extensions/built-in-tools/) | *(選用)* | `/moderation` 審核/清除；由 `/config` > 權限（使用者封鎖）控制 | 此人格針對特定使用者設定的主動靜音/封鎖限制。 |
| [伺服器記憶](/features/knowledge/memory/#personal-vs-server-memories) | | `/memories` | 為此伺服器儲存的長期事實。 |
| [伺服器表情符號](/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(選用)* | `/config` > 外掛 > 脈絡附加（`表情符號與反應`）（僅切換），使用 `/expressions initialize` 初始化 | 伺服器中存在的自訂表情符號。 |
| [伺服器貼圖](/features/chatting-personality/behavior-tweaking/#expressions) | *(選用)* | `/config` > 外掛 > 可用工具（貼圖使用），使用 `/expressions initialize` 將原生資產分類，使用 `/expressions manage` 進行管理 | 可傳送的原生貼圖和符合回應人格的每個自訂表情，包括名稱、說明與情緒。媒體來源與人格存取規則位於提示詞之外。 |
| [人格立繪](/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(選用)* | `/config` > 人格 > 立繪 | 為人格設定的具名表情立繪（如果有）。 |
| [對話參與者](/features/knowledge/memory/#personal-vs-server-memories) | *(選用)* | `/personal memories`（由 `/config` > 權限（個人化）控制） | 對話中的人、他們的暱稱與提及名稱，以及為每個人儲存的個人記憶。當此人在脈絡中擁有訊息或提及其姓名/別名時載入。也使用 `/config` > 行為 > 一般行為將目前頻道與本地時間作為頁尾。 |
| [短期記憶](/features/knowledge/memory/#short-term-memory-stm) | | `/config` > 人格 > 記憶；`/memories` 清除項目；由 `/config` > 權限（短期記憶）控制 | 包含不同頻道的摘要與近期訊息。 |
| [文件](/features/knowledge/memory/#document-knowledge-base-rag) | *(選用)* | `/memories` | 使用 RAG 從知識庫中提取的相關區塊。 |
| [世界書](/features/knowledge/lorebooks/) | *(選用)* | `/memories` > 世界書 | 關鍵字出現在近期訊息中的世界觀設定，加上一律啟用的項目。在文件之後傳送。 |
| [獎勵與懲罰](/features/knowledge/memory/#conditioning) | *(選用)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, 使用 `/conditioning remove` 管理 | 此人格在這個伺服器中累積的行為偏好。 |
| [範例對話](/features/chatting-personality/multiple-personas/#sample-dialogues) | *(選用)* | `/config` > 人格 > 身分與個性 | 此人格如何說話的範例（若有設定）。 |
| [近期訊息](/features/chatting-personality/behavior-tweaking/#generation-tuning) | | `/config` > 行為 > 一般行為 | 實際對話，最多這麼多則訊息（預設 80 則）。 |
| 脈絡備忘 | *(選用)* | `/config` > 行為 > 一般行為；人格 > 進階；或 頻道 > 頻道覆寫 | 在距離最新訊息指定深度處，插入到近期訊息中的指示。 |

選用的區塊在為空時不消耗 token。

近期訊息形成一個滑動視窗。其他區塊則是根據已儲存的設定與記憶重建。

:::tip
某些模型利用長提示詞開頭或結尾資訊的可靠程度，高於提示詞中間的資訊。對於使用脈絡備忘的供應商，請嘗試將指示放在靠近最新訊息的位置。效果取決於模型與任務。請參閱 [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) 與 [Lost in the Haystack](https://arxiv.org/abs/2505.18148)。
:::

### 檢視提示詞

- `/tool prompt snapshot` 將組裝好的提示詞儲存至檔案，包括使用中的記憶、文件與世界書。
- `/context` 顯示脈絡使用量與預估輸入成本的視覺化解析。
- `/tool estimate cost` 按大小與成本分解提示詞。

### 工具是在哪裡定義的？

對於支援工具呼叫的供應商，TomoriBot 會透過供應商支援的介面傳送工具定義。

### 為什麼 TomoriBot 會忘記？

| 發生了什麼事 | 原因 |
|---|---|
| 她忘記了今天稍早的一些事情 | 內容已滾動超過訊息限制，且未儲存為長期記憶。 |
| 她在另一個頻道忘記了某些事情 | 近期訊息是各頻道獨立的。伺服器記憶、參與者記憶與短期記憶會提供來自其他頻道的精選資訊。 |
| `/refresh` 讓她忘記了 | 重新整理會截斷近期訊息並清除該頻道的短期記憶，但不會刪除長期記憶。刪除重新整理的嵌入訊息即可解除截斷。 |

如果你希望某項內容在上述所有情況下都能留存，它就必須成為長期記憶。請參閱[記憶](/features/knowledge/memory/#long-term-memory)。

:::tip
較大的訊息限制並不保證有更多歷史記錄會送達模型。當提示詞對於模型的脈絡視窗而言過大時，最舊的對話會在傳送前被捨棄；`/context` 會顯示剩餘的空間。
:::
