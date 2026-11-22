---
title: "提示詞巨集"
sidebar:
  order: 5.5
---

提示詞巨集會在 TomoriBot 準備回覆時插入目前的名稱、可用工具與其他數值。使用條件式區塊，就能只在條件適用時才納入該段指示。

## 名稱巨集
<!-- anchor: names -->

在已儲存的提示詞、屬性、範例對話、世界書與記憶中皆可使用名稱巨集。
在脈絡備註中，請使用 `{@userId}`。

| 巨集 | 插入內容 | 範例 |
| --- | --- | --- |
| `{bot}`、`{char}` | 目前作用中人格的名稱。 | 當 Lilya 作用中時，`You are {char}.` 會變成 `You are Lilya.`。 |
| `{user}` | 觸發回覆的使用者。在共用的提示詞、屬性、世界書與伺服器記憶中，它會變成 `User`。在個人記憶中，它會帶出該則記憶所描述的對象名稱。 | 在範例對話中，當 Mirri 觸發回覆時，`Hi, {user}!` 會變成 `Hi, Mirri!`。 |
| `{user_formatted}` | 觸發使用者的名稱，加上目前作用中人格所使用的前綴與後綴。 | Lilya 的英文預設集會將 Mirri 的 `Hi, {user_formatted}!` 變成 `Hi, Mirri-senpai!`。 |
| `{user_term}` | 目前作用中人格對觸發使用者的稱呼。 | Rose 的英文預設集會使用 `fam`（中性）、`bro`（男性）或 `sis`（女性）。 |
| `{@123456789012345678}` | 擁有該 ID 的 Discord 使用者暱稱，即使是由其他人觸發回覆也一樣。 | 當對方已儲存的暱稱為 `Navigator` 時，`Ask {@123456789012345678}.` 會變成 `Ask Navigator.`。 |

具名巨集支援單層或雙層大括號，且不區分大小寫。例如 `{{char}}` 與 `{CHAR}` 都能正常運作。在共用的系統或人格提示詞中，請使用 `{user_formatted}` 或 `{user_term}` 來指稱觸發回覆的人。這兩個巨集在回覆前綴中會保持原樣。
在文字中使用 `{user_term}` 前，請先在人格的`稱呼習慣`中設定中性稱呼。

### 指稱特定的 Discord 使用者
<!-- anchor: refer-to-a-specific-discord-user -->

開啟`開發者模式`並複製對方的使用者 ID。請參閱
[Discord 的複製 ID 指南](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)。
將該數字放在 `@` 後面並以單層大括號包起來，例如
`Treat {@123456789012345678} as the ship's navigator.`

TomoriBot 會優先採用該成員在目前作用中人格下的暱稱，其次是 `/personal config` > `個人檔案` 的全域暱稱，最後才是其 Discord 使用者名稱。如果伺服器停用了個人記憶、該成員在黑名單中，或對方的隱私等級設為`完整`，她就會使用其 Discord 使用者名稱。如果無法解析出名稱，該巨集會保持原樣。

即時對話會將該巨集保持原樣，包括短期記憶中逐字引用的對話，或透過 `{{input}}` 與 `{{lastChatMessage}}` 複製進預設集的內容。透過人格公開個人檔案共用的屬性，在由其他人格讀取時也會保持原樣。

### Discord 提及與連結

使用者提及（`<@userId>` 與 `<@!userId>`）在個人記憶啟用時會使用對方已儲存的全域暱稱，否則會退回使用伺服器暱稱或使用者名稱（包含黑名單中的使用者）。若要解析特定人格的暱稱，請使用 `{@userId}`。

頻道提及（`<#channelId>`）或 Discord 頻道或訊息連結會在 TomoriBot 能解析該頻道時提供可讀的頻道標籤。身分組提及（`<@&roleId>`）若該身分組存在於目前伺服器中，會變成 `@Raid Guides` 這類名稱；無法解析的身分組提及則保持原樣。

## 隨機選項

使用 `{{random: north, south}}` 或 `{{random::north::south}}` 可在組裝提示詞時隨機挑選一個選項。雙冒號格式允許選項內容包含逗號。兩種格式都支援單層大括號。

## 工具巨集
<!-- anchor: tool-macros -->

使用工具巨集來插入目前供應商與模型可用的函式名稱。
當沒有可用工具時，內建巨集會展開為 `an unavailable tool`。請將該段指示放進[條件式區塊](#conditional-prompt-blocks)中，以便在工具不可用時省略它。
若想了解每個工具的功能以及由哪些設定控制啟用，請參閱[內建工具](/features/capabilities/tools-and-extensions/built-in-tools/)。

### 內建工具巨集

| 巨集 | 用於 `tool:` 條件的函式名稱 | 常駐指示範例 |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Use {capabilities_tool} to check what you can do here before promising a feature such as stickers or voice messages.` |
| `{memory_tool}` | `create_long_term_memory` | `Save lasting member preferences, such as favorite party games, with {memory_tool} so you can use them in future chats.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Use {memory_update_tool} to revise the existing memory when a member corrects a saved preference or a moderator changes a recurring event.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `At roleplay scene breaks, use {short_term_memory_tool} to record where the party stopped, what clues they found, and what they plan to do next.` |
| `{task_tool}` | `create_task` | `Schedule game-night and poll reminders with {task_tool} when members request them. Confirm the scheduled time afterward.` |
| `{task_update_tool}` | `update_task` | `Use {task_update_tool} to reschedule the existing reminder when a member changes its time or repeat schedule.` |
| `{cross_channel_tool}` | `cross_channel_message` | `When asked to publish event results, post them in #announcements with {cross_channel_tool} and report back here.` |
| `{create_thread_tool}` | `create_thread` | `When members explicitly ask for a spoiler discussion thread, use {create_thread_tool} and open with a question about the episode.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebrate raid clears with {sticker_tool} when the server has a sticker that fits the moment.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.`（僅限開發環境使用） |
| `{youtube_tool}` | `process_youtube_video` | `Use {youtube_tool} when members ask about a specific move shown in a linked YouTube guide.` |
| `{image_analysis_tool}` | `analyze_image` | `When helping with an error screenshot, read the visible error with {image_analysis_tool} before suggesting a fix.` |
| `{image_generation_tool}` | `generate_image` | `For requested event banners, use {image_generation_tool} and leave room for the event title.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Use {anime_image_generation_tool} for requested anime-style roleplay art. Keep the characters' established outfits.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resolve character nicknames and alternate spellings with {tag_search_tool} before searching for fan art.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `When members ask to browse existing anime fan art, post a small selection with {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Send quest briefings and dramatic recaps with {voice_message_tool} when players ask to hear them aloud.` |
| `{block_user_tool}` | `block_user` | `Use {block_user_tool} to apply a persona mute when a moderator asks to stop a member from triggering you for a set time.` |
| `{unblock_user_tool}` | `unblock_user` | `Use {unblock_user_tool} to lift a persona mute early when a moderator asks.` |
| `{user_info_tool}` | `update_user_info` | `Save a member's requested nickname or honorific for this persona with {user_info_tool}.` |

`{pin_tool}` 與 `{timestamp_refresh_tool}` 為相容性保留的別名。

### 搜尋與 URL 巨集

這些巨集可以選取伺服器 MCP 工具來取代內建函式。若兩者皆不可用，它們會插入該工具的說明。

| 巨集 | 選取內容 |
| --- | --- |
| `{web_search_tool}` | 網路搜尋工具或內建的 `web_search`。 |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | 對應所請求媒體的搜尋工具，若無則退回使用網路搜尋。 |
| `{url_fetch_tool}` | URL 讀取器或內建的 `fetch_url`。 |
| `{url_metadata_tool}` | 可檢查 URL 的 MCP 工具，或內建的 `fetch_url`。 |

## 條件式提示詞區塊
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| 條件 | 該分支出現的時機 |
| --- | --- |
| `{{if tool:<function_name>}}` | 該確切工具對目前供應商與模型可用。 |
| `{{if capability:<name>}}` | 所指定的功能已啟用。 |
| `{{if tool_family:url_fetch}}` | 內建 URL 讀取器或伺服器 MCP 替代工具可用。 |

在條件前加上 `!`（例如 `{{if !capability:time_awareness}}`）可測試其未啟用或不可用的狀態。每個區塊最多使用一個 `{{else}}`，並以 `{{/if}}` 閉合每個區塊。巢狀區塊最多支援 32 層。如需多個條件需求，請使用巢狀區塊。

支援的功能名稱有 `tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory` 與 `time_awareness`。當目前使用中的模型無法呼叫工具時，`tool_use` 為 false。

工具條件會檢查組裝提示詞時可用的工具，包括來自`明確工具模式`的限制。Discord 權限會在工具執行時檢查。未知的功能名稱會判定為 false 並產生警告。TomoriBot 會省略格式有誤的區塊，並在巢狀超過上限時將條件標籤保持原樣。

## SillyTavern 預設集巨集
<!-- anchor: sillytavern-preset-macros -->

下列額外巨集適用於 SillyTavern 預設集節點內部。預設集節點也支援前述的身分、隨機選項與工具巨集。

| 巨集 | 插入內容 |
| --- | --- |
| `{{user}}`, `<USER>` | 觸發回覆的成員。 |
| `{{char}}`, `{{bot}}`, `<BOT>` | 目前作用中人格的名稱。 |
| `{{personality}}` | 人格屬性。 |
| `{{description}}` | 人格提示詞。 |
| `{{scenario}}` | 空白。匯入卡片中的情境會併入人格屬性。 |
| `{{mesExamples}}` | 範例對話。 |
| `{{lastChatMessage}}`, `{{input}}` | 所提供對話紀錄中的最新一則使用者訊息。 |
| `{{time}}`, `{{date}}`, `{{weekday}}` | 以英文顯示的伺服器時間、日期或星期，例如 `3:45 PM`、`October 28, 2026` 或 `Wednesday`。 |
| `{{isotime}}`, `{{isodate}}` | `HH:mm` 格式的伺服器時間，或 `YYYY-MM-DD` 格式的日期。 |
| `{{model}}`, `{{provider}}` | 已設定的模型與供應商 ID。每輪隨機選取與備援模型不會變更這些數值。 |
| `{{char_version}}` | 空白。TomoriBot 不儲存卡片版本。 |
| `{{roll:2d6}}` | 擲骰子的總和，最多 100 顆骰子，每顆最多 1,000 面。 |
| `{{// notes}}` | 空白。用於在預設集中撰寫註解。 |
| `{{trim}}` | 移除該節點前後的空白字元。 |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | 設定或附加文字到跨越預設集各節點共用的變數。 |
| `{{getvar::key}}` | 該變數的數值；若未設定則為空白。 |

`<USER>` 與 `<BOT>` 是區分大小寫的相容標記。五個日期與時間巨集共用同一次時鐘讀數與伺服器的固定 UTC 偏移。日光節約時間變動時請更新伺服器偏移。當時間感知關閉時，這五個巨集皆為空白。請將它們放在靠後或深度注入的節點中，讓前面的文字能保留提示詞快取資格。

### 預設集條件式
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

像 `description` 這樣的單純名稱代表 `{{description}}`。你也可以直接在條件中放入數值巨集，例如 `{{#if {{input}}}}`。TomoriBot 在測試數值時會忽略大小寫與前後空格。空文字、`false` 與 `0` 會判定為 false。無法辨識的數值巨集視為空白。

這些區塊可以與[工具與功能條件](#conditional-prompt-blocks)巢狀共用。
請以 `{{/if}}` 閉合 `#if`，以 `{{/unless}}` 閉合 `#unless`。未閉合的預設集區塊會在所屬節點結尾處結束。TomoriBot 會捨棄孤立的閉合標籤與 `{{else}}` 標籤，並省略含有第二個 `{{else}}` 或閉合標籤不相符的區塊。32 層上限同樣適用於混合區塊。

預設集條件可以讀取節點順序中更早出現的變數宣告，包括同一節點前面部分的宣告。被跳過的預設集分支中的宣告不會生效。位於條件外的 `{{getvar::key}}` 會在 TomoriBot 走訪完所有已啟用節點後讀取最終值。工具與功能條件會在變數賦值完成後才執行。

## 驗證巨集

對想要檢查的人格與頻道執行 `/tool prompt snapshot`。開啟匯出檔案並尋找渲染後的指示。使用 `/context` 查看提示詞的哪些部分佔用了空間。請參閱[檢視提示詞](/features/knowledge/inside-the-prompt/#inspecting-the-prompt)。
