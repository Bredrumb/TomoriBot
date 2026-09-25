---
title: "提示詞內部"
sidebar:
  order: 2
---

每次你觸發 TomoriBot，以下內容就會依這個順序組裝起來，並以主要提示詞與脈絡的形式，送給你設定的文字模型：

| 區塊 | 選用？ | 指令 | 是什麼 |
|---|---|---|---|
| [`系統提示詞`](/zh-TW/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > 行為 > 一般行為 | 位於脈絡最頂端的基本指示。 |

> **預設系統提示詞文字**（僅在伺服器未設定系統提示詞時使用）：
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| 區塊 | 選用？ | 指令 | 是什麼 |
|---|---|---|---|
| **頻道提示詞（附加）** | *（選用）* | `/config` > 頻道 > 頻道覆寫 | 依頻道而異，緊接在系統提示詞之後疊加。同一頁的*取代*模式則會接手上面那個系統提示詞的位置，而不是新增一個。 |
| **人格提示詞** | *（選用）* | `/config` > 人格 > 進階 | 專為生效中人格撰寫的提示詞，與系統提示詞分開。 |
| [**人格屬性**](/zh-TW/features/chatting-personality/multiple-personas/#attributes) | | `/config` > 人格 > 身分與個性 | 生效中人格的個性特質與說話模式。 |
| **伺服器資訊** | | *（無，來自 Discord）* | 伺服器名稱、描述，以及她所在的頻道，直接從 Discord 取得。 |
| [**人格與使用者封鎖**](/zh-TW/features/capabilities/tools-and-extensions/#內建工具) | *（選用）* | 用 `/moderation` 檢視或清除；由 `/config` > 權限（人格封鎖使用者）管制 | 這個人格針對特定使用者持有的生效中禁言與封鎖限制。 |
| [`伺服器記憶`](/zh-TW/features/knowledge/memory/#personal-vs-server-memories) | | `/memories` | 為這個伺服器儲存的長期事實。 |
| [**伺服器表情符號**](/zh-TW/features/chatting-personality/behavior-tweaking/#功能她被允許做什麼) | *（選用）* | `/config` > 權限（表情符號使用）（僅切換），用 `/expressions initialize` 初始化 | 伺服器裡現有的自訂表情符號。 |
| [**伺服器貼圖**](/zh-TW/features/chatting-personality/behavior-tweaking/#功能她被允許做什麼) | *（選用）* | `/config` > 權限（貼圖使用）（僅切換），用 `/expressions initialize` 初始化 | 伺服器裡現有的自訂貼圖。 |
| [**人格立繪**](/zh-TW/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *（選用）* | `/config` > 人格 > 立繪 | 為人格設定的具名表情立繪（如果有的話）。 |
| [**對話參與者**](/zh-TW/features/knowledge/memory/#personal-vs-server-memories) | *（選用）* | `/personal memories`（由 `/config` > 權限（個人化）管制） | 對話中的人、他們的暱稱與標註代稱，以及為每個人儲存的個人記憶。當某個人在脈絡中擁有一則訊息，或他們的名字與別名被提及時載入。也會在頁尾帶上目前頻道與當地時間，使用 `/config` > 行為 > 一般行為 的設定。 |
| [`短期記憶`](/zh-TW/features/knowledge/memory/#short-term-memory-stm) | | `/config` > 人格 > 記憶；用 `/memories` 清除項目；由 `/config` > 權限（自動摘要短期記憶）管制 | 包含不同頻道的摘要與最近的訊息 |
| [`文件`](/zh-TW/features/knowledge/memory/#document-knowledge-base-rag) | *（選用）* | `/memories` | 用 RAG 從知識庫取回的相關片段。 |
| [**制約**](/zh-TW/features/knowledge/memory/#conditioning) | *（選用）* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`、`/punish <bite\|bonk\|pinch\|spank\|squeeze>`，透過 `/conditioning remove` 管理 | 這個人格在這個伺服器累積的行為引導。 |
| [`範例對話`](/zh-TW/features/chatting-personality/multiple-personas/#sample-dialogues) | *（選用）* | `/config` > 人格 > 身分與個性 | 這個人格說話方式的範例（如果有設定的話）。 |
| [**最近的訊息**](/zh-TW/features/chatting-personality/behavior-tweaking/#生成調整) | | `/config` > 行為 > 一般行為 | 實際的對話，最多到這個數量的訊息（預設 80）。你的脈絡備註與任何重逢備註會依可設定的深度，內嵌在這個區塊裡面，而不是各自成為獨立區塊。 |

標示為*（選用）*的列在沒有內容可說時不會貢獻任何東西（也不花 token），例如沒有符合的文件，或伺服器沒有自訂表情符號。

最近的訊息是最大也最脆弱的部分，它是一扇隨著大家說話往前滑動的窗。它們之上的所有內容都是從已儲存的設定重建而成，因此穩定。

`/tool prompt snapshot` 會把某個人格實際收到的完整組合匯出成檔案。它是判斷哪些記憶目前正在生效、是否有文件符合，以及對話實際上放進多少的準確依據。

`/tool estimate cost` 會把同一份組合影大小拆解，方便你在調高任何上限之前，先弄清楚是什麼在吃掉你的脈絡。

### 工具是在哪裡定義的？

對於 TomoriBot 原生支援的每一個供應商，工具結構描述都會透過該供應商自己的 `tools` 欄位送出，所以這取決於供應商與你設定的推論引擎。

### 為什麼 TomoriBot 會忘記？

這個排序說明了幾乎每一個「她為什麼不記得？」的問題：

| 發生了什麼 | 為什麼 |
|---|---|
| 她忘了今天稍早的某件事 | 那則訊息滑出了訊息上限。它一直都只存在於**最近的訊息**裡；如果 Tomori 沒有把它存成長期記憶，一旦它超出訊息視窗就會被遺忘。 |
| 她忘了另一個頻道裡的某件事 | **最近的訊息**是以頻道為單位。只有`伺服器記憶`、**對話參與者**與`短期記憶`能跨頻道。短期記憶的補救方式是載入不同頻道最近的訊息，但不會把所有內容都倒進來。 |
| `/refresh` 讓她忘了事情 | Refresh 會截斷**最近的訊息**，並清除這個頻道的`短期記憶`，但不應該移除長期記憶。刪掉 refresh 的 embed 就能解除截斷。 |
| 她在重新啟動之後忘了某件事 | **最近的訊息**永遠不會在重新啟動後保留下來 |

如果你希望某件事在上述所有情況後仍然存在，它就必須成為`長期記憶`。請看[記憶](/zh-TW/features/knowledge/memory/#long-term-memory)。

## 提示與技巧

- `/config` > 行為 > 一般行為 可以加寬對話視窗（20 到 100 則訊息）。脈絡越多，每次回覆的 token 也越多。
- `/config` > 行為 > 一般行為 會在選定的深度注入一則簡短提醒。因為它位於組合中較低的位置、接近最近的訊息，她更可能照著做，而不是理會系統提示詞裡的內容。這裡是提醒她更常儲存記憶的最佳位置。
- `/personal memories` 與 `/memories` 會直接寫入`伺服器記憶`與**對話參與者**，這是讓知識在 TomoriBot 的脈絡中永久留存的保證方法之一。
