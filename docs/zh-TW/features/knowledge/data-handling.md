---
title: "資料處理"
sidebar:
  order: 4
---

TomoriBot 的設計目標是對你的資料保持透明。你可以匯出、匯入或刪除她儲存的一切，這一頁會清楚列出那究竟是什麼。法律條文請看 `/legal privacy-policy` 與 `/legal terms-of-service`。

:::note
這一頁涵蓋的是 Discord 內、以使用者為單位的控制項。**要自架自己的執行個體嗎？**整份資料庫的備份與還原屬於主機端操作，請看[維護與備份](/en/self-hosting/maintenance/)。
:::

## 她儲存什麼

**會儲存：**

- 伺服器記憶與個人記憶
- 她的設定與人格資料
- 伺服器設定
- 加密後的 API 金鑰

**不會儲存：**

- 你的 Discord 訊息
- 對話紀錄

**會傳送給你的 AI 供應商：**每當她被觸發，她會抓取頻道中的**最新訊息**，以及任何**相關記憶**，作為模型的脈絡。她不會在這些觸發之外監看或讀取訊息。

:::note
你選擇的 AI 供應商（Google、OpenRouter、NovelAI 等等）會依*他們自己的*隱私政策處理訊息。永遠不要與任何 AI 分享敏感的個人資訊。
:::

## 匯出你的資料

所有可匯出的內容都會以 JSON 檔傳送到你的私訊：

- `/export config`：伺服器設定值（不含 API 金鑰、憑證或供應商設定）。
- `/export personal config`：你的個人設定（個人檔案、隱私、外觀、回應模式）。
- `/export memories`：伺服器記憶，範圍可以是主要人格、選定的某個人格，或每個人格分開。
- `/export personal memories`：你的個人記憶，範圍可以是全域、單一人格，或每個人格分開。
- `/persona export`：完整的人格定義。

## 匯入你的資料

把先前匯出的檔案附加進來即可還原：

- `/import config`：伺服器設定；需要 **管理伺服器**。選擇要套用哪些偵測到的區段。
- `/import personal config`：你的個人設定。選擇要套用哪些偵測到的區段。
- `/import memories`：伺服器記憶；需要 **管理伺服器**。可合併或取代，若檔案中有多個人格，請逐一對應來源人格。
- `/import personal memories`：你的個人記憶。可合併或取代，若檔案中有多個人格，請逐一對應來源人格。
- `/persona import`：還原人格。它也接受 PNG 與 JSON 格式的 SillyTavern 角色卡，以及 `.charx` 的 Character Card V3 壓縮檔，這些只會匯入角色文字（請看 [SillyTavern 支援](/zh-TW/features/integrations/sillytavern-support/)）。

## 刪除你的資料

以下操作會永久移除或重設資料，**無法復原**：

- `/personal memories`、`/memories`
- `/reset config`：把 29 張設定資料表的伺服器設定重設為資料庫預設值。
  - **還原為 DDL 預設值的單列資料表（18 張）：**聊天設定、模型設定、成員權限、功能、通知 embed、nsfw 設定、語音設定、自動觸發設定、頻道範圍設定、觸發行為設定、NovelAI 圖片生成設定、BYOK 設定、記憶設定、短期記憶設定、歡迎訊息設定、圖片額度設定、文字額度設定與影片額度設定。
  - **保留的設定（兩組）：**`server_model_configs` 中生效中的模型 ID、憑證與自訂端點參數（`llm_id`、`embedding_model_id`、`diffusion_model_id`、`video_model_id`、`vision_llm_id`、`api_key`、`key_version`、`custom_endpoint_url`、`custom_model_name`、`custom_num_ctx`、`other_model_codename`、`other_model_capabilities`、`other_model_capabilities_fetched_at`），以及生效中的 NovelAI 擴散模型身分（`server_novelai_imagegen_configs` 中的 `nai_diffusion_model_id`）。
  - **清空的集合（11 張資料表）：**`server_auto_trigger_persona_overrides`、`stm_categories`、`random_triggers`、`channel_llm_overrides`、`channel_prompt_overrides`、`channel_context_notes`、`personalization_blacklist`、`persona_user_blocks`、`channel_whitelist`、`role_whitelist` 與 `channel_persona_whitelist`。
  - **保留的領域：**人格與人格設定、伺服器記憶、短期記憶、表情（表情符號與貼圖）、已記錄的額度用量、已儲存的供應商設定，以及外部整合（Matrix 與 MCP）。
  - **情境與權限：**在伺服器中需要管理伺服器權限。在私訊（DM）中支援，使用執行指令者的工作區 snowflake。
- `/reset personal config`：把所有伺服器的使用者設定與個人頻道聚光燈重設為資料庫預設值。
  - **重設的欄位：**還原 `users.language_pref`（'en-US'）與 `users.privacy_level`（0），把 `user_personalization_configs` 的全部 13 個欄位（暱稱、跨伺服器選擇加入、外觀標籤、角色參考 URL、模擬提示詞、個人 DTM、明確工具模式、時區位移、前綴與後綴覆寫、性別認同、代稱、稱呼方式）還原為結構描述預設值，並刪除所有 `user_persona_naming_preferences`。
  - **清空的集合：**刪除該使用者在所有工作區的 `personal_spotlights`，並串聯到 `personal_spotlight_personas`。
  - **保留的個人領域：**使用者帳號身分、註冊時使用的語言、個人記憶、已儲存的供應商設定（`user_saved_provider_configs`）、自訂端點，以及排程任務與提醒。
  - **情境：**所有使用者在伺服器與私訊中都能使用。

## 選擇退出

- `/personal config`：控制你在她眼中的可見度，最高可以完全隱形（完全退出記憶功能）。
- `/config` > 權限：伺服器管理員可以關閉自我學習與其他功能。

關於記憶在日常生活裡怎麼運作，請看[記憶](/zh-TW/features/knowledge/memory/)。
