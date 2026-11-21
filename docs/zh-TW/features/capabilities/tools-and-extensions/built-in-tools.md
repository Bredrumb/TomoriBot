---
title: "內建工具"
sidebar:
  order: 0
---

工具取決於使用中支援工具呼叫的供應商與模型。許多工具受到功能旗標（`/config` > `權限`）、Discord 權限、模型功能或選用的 API 金鑰所限制。

:::tip
如果某項功能似乎無法使用，請詢問她原因。她可以回報伺服器的功能旗標，以及目前使用的模型是否支援工具呼叫，通常能指出需要修正的設定名稱。
:::

| 工具 | 提示詞巨集 | 需要 | 功能說明 |
|---|---|---|---|
| 審核功能 | `{capabilities_tool}` | - | 在回答之前檢查目前的聊天能力、指令或設定。 |
| 建立/更新長期記憶 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 儲存或取代穩定的伺服器事實或使用者偏好。 |
| 更新短期記憶 | `{short_term_memory_tool}` | - | 為目前頻道或故事線儲存臨時的工作記憶。 |
| 建立/更新任務 | `{task_tool}` / `{task_update_tool}` | - | 排程或編輯提醒事項與自我任務（請參閱[排程任務](/features/capabilities/scheduled-tasks/)）。 |
| 跨頻道訊息 | `{cross_channel_tool}` | - | 在另一個頻道或討論串中採取行動，並附帶選用的回報。 |
| 建立討論串 | `{create_thread_tool}` | `thread_creation_enabled` + 討論串權限 | 開啟公開討論串並發布起始訊息。 |
| 擲骰子 | - | `dice_rolling_enabled` | 公開擲骰子並在角色扮演中使用傳回的結果。 |
| 選取貼圖 | `{sticker_tool}` | `sticker_usage_enabled` | 在回覆中加入相符的伺服器貼圖或自訂表情。 |
| 管理訊息 | `{manage_message_tool}` | `manage_message_enabled` | 釘選、編輯或刪除近期訊息（釘選需要「管理訊息」權限）。 |
| 封鎖/取消封鎖使用者 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | 在人格範圍內將使用者靜音/封鎖（不影響記憶）。 |
| 與近期訊息互動 | `{message_interaction_tool}` | - | 對近期訊息新增反應或發送簡短回覆。 |
| 查看個人資料相片 | `{profile_picture_tool}` | 視覺模型或 `vision_llm` | 檢查使用者或人格的頭像。 |
| 讀取文件 | `{document_tool}` | - | 從 PDF 或任何 UTF-8 文字檔案提取文字：原始碼（`.py`/`.ts`/`.rs`/…）、`.json`、`.yaml`、`.md`、`.txt` 以及任何非二進位附件。 |
| 顯示訊息中繼資料 | `{message_metadata_tool}` | - | 為近期回合標註使用者名稱與時間戳記以進行精準定位。 |
| 處理 YouTube 影片 | `{youtube_tool}` | 支援影片的模型 | 依需求分析特定的 YouTube 連結。 |
| 分析圖片 | `{image_analysis_tool}` | 已設定的 `vision_llm` | 將圖片理解委派給獨立的視覺模型。 |
| 產生圖片/動漫圖片 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 具備能力的供應商 | 產生或編輯圖片（請參閱[媒體生成](/features/capabilities/media-generation/image-generation/)）。 |
| Danbooru 標籤查詢 | `{tag_search_tool}` | `danbooru_enabled` | 將角色名稱、暱稱與猜測的標籤轉換為精確的 Danbooru 標籤（請參閱 [Danbooru 標籤查詢](/features/capabilities/tools-and-extensions/danbooru/)）。 |
| Danbooru 插圖搜尋 | `{booru_post_search_tool}` | `danbooru_enabled` | 根據 1 或 2 個標籤發布最多 4 張現有的 Danbooru 圖片（請參閱[插圖搜尋與貼文讀取](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)）。 |
| Danbooru 貼文讀取 | - | `danbooru_enabled` | 從 ID 或連結讀取單一 Danbooru 貼文的分組標籤。 |
| 產生語音訊息 | `{voice_message_tool}` | ElevenLabs 金鑰 + 人格語音 + `voice_message_enabled` | 發送語音 Discord 語音回覆。 |

:::note[提示詞作者須知]
自訂她的系統提示詞或人格指示時，請透過上表中的**提示詞巨集**來引用工具，而不是硬編碼工具名稱，因為巨集會在組裝脈絡時展開為正確的名稱，並在工具不可用時適度降級。`{pin_tool}` 與 `{timestamp_refresh_tool}` 仍可作為 `{manage_message_tool}` 與 `{message_metadata_tool}` 的相容別名。下方的網路搜尋與 URL 工具也有巨集：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}` 與 `{url_metadata_tool}`。這些巨集會動態解析為最佳的可用引擎，包括伺服器 MCP 替代方案。
:::

### 條件式提示詞區塊

支援上述工具巨集的提示詞文字也支援具範圍的條件句：

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

若為已啟用的 TomoriBot 設定請使用 `capability:<name>`；若文字僅在目前供應商與模型具備該確切工具時才顯示，請使用 `tool:<function_name>`。當內建的 URL 讀取器或伺服器 MCP 替代方案可用時，請使用 `tool_family:url_fetch`。在條件前加上 `!` 可將其反轉。區塊可以巢狀嵌套，且可包含一個 `{{else}}`；不支援通用的 `and`/`or` 運算式。

支援的功能名稱包括 `tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory` 與 `time_awareness`。

工具條件反映了供應商/模型支援、伺服器設定、已設定的後端、MCP 替代方案以及目前的明確工具模式允許清單。它們不會繞過或預測工具執行時所進行的 Discord 權限檢查。未知的功能名稱會評估為 false 並記錄在日誌中；格式錯誤的區塊會被省略。未經處理的聊天訊息、模型輸出與工具結果絕不會被視為條件式範本。
