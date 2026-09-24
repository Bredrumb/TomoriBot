# Glossary: Taiwanese Mandarin (zh-TW)

## Conventions

- **Register**: 文件與介面文字使用台灣書面語，句子求短、求直白，貼近 Discord 使用者的日常說法。不使用文言腔，不使用大陸用語。
- **Addressing the user**: 一律用「你」，不用「您」。bot 自稱「我」，提到 Tomori 時用「她」（英文 she）或直接用名字；需要中性時用「我」或省略主語。管理員與一般成員不區分稱謂。
- **Sentence types**: 錯誤訊息先講發生什麼，再講使用者可以做什麼（例如「我現在連不上資料庫，請稍後再試」）。不用驚嘆號堆疊情緒。
- **Capitalization**: 中文沒有大小寫。英文專有名詞維持原樣且大小寫照抄：`TomoriBot`、`Tomori`、`Discord`、`OpenRouter`、`NovelAI`、`ElevenLabs`、`ComfyUI`、`Ollama`、`LM Studio`、`pgvector`。
- **Discord UI labels**: 面板路徑（例如 Models > Switch Models）、按鈕與欄位名稱、連結與卡片標題，一律採用本 locale 自己的 `src/locales/zh-TW/` 譯值，不可臨時另譯。斜線指令、參數名、程式碼、識別字、URL、環境變數保持英文：`/config`、`/persona create`、`/providers`、`{user_nickname}`、`STM`。
- **Punctuation**: 正文使用全形標點（，。：；！？「」（））。中英夾雜時不加空格。程式碼、指令與英文原名用反引號包住。不使用破折號或連接號代替標點。百分比寫「90%」，範圍寫「1 到 100 秒」。
- **Plural**: 中文原則上不標複數。需要強調多個時才加「多個」、「幾位」、「數個」或具體數量，例如 server memories 寫「伺服器記憶」即可，不要寫「伺服器記憶們」。
- **Gender**: 人稱與身分名詞盡量中性。`alter` 沿用英文，避免「副人格」暗示優劣。Tomori 在英文版為 she/her，`zh-TW` 用「她」。使用者性別未知時寫「對方」或「該成員」，不要預設「他」。
- **Term scope**: 本表以使用者可見文字的譯法為準。程式碼內部識別字（欄位名、型別名、DB 欄位）不翻譯僅供對照，不列入本表。

## Terminology

| English Term | Chosen Translation | Usage Note |
|---|---|---|
| persona | 人格 | 台灣角色扮演社群既有說法。指心理學人格時改用「性格」，避免歧義。 |
| alter / alter persona | alter | 保留英文，必要時加註「額外的人格」。切勿用「副人格」，該詞帶有次等意味。 |
| main persona | 主要人格 | 對應 UI 的 Main persona。不要用「主人格」（易與多重人格臨床用語混淆）。 |
| server default | 伺服器預設 | 名詞用「伺服器預設」，需要動詞化時寫「伺服器預設值」。不可與 preset 的譯法混用。 |
| personal override | 個人覆寫 | 指使用者自己的設定覆蓋伺服器設定。比「個人取代」精確；不要用「個人替代」。 |
| provider | 供應商 | AI 後端服務（Google、OpenRouter、NovelAI、Custom 等）。產業慣用「供應商」，不要寫「提供者」。 |
| model | 模型 | 一般技術名詞。模型代號如 `kayra-v1`、`llama-3-erato-v1` 保持原文。 |
| memory | 記憶 | 不譯為「內存」（大陸用語）。單筆記憶稱「一則記憶」。 |
| server memory | 伺服器記憶 | 全伺服器共用的長期記憶。不要寫「服務器記憶」。 |
| personal memory | 個人記憶 | 跟著使用者跨伺服器的記憶。 |
| short-term memory | 短期記憶 | 指 STM 時可寫「短期記憶（STM）」，之後用「短期記憶」。不要寫「短期內存」。 |
| teach | 教導 | 使用者主動灌輸記憶或知識的動作。名詞化為「教導功能」。不用「教學」（偏課堂義）。 |
| self-teaching | 自我教導 | bot 自己從伺服器對話學習的能力，對應 UI 的 Self-Teaching。 |
| trigger word | 觸發詞 | 讓某個人格加入對話的字詞。不用「關鍵詞」。 |
| sticker | 貼圖 | Discord 官方的台灣中文譯法。不要用「表情包」（大陸用語）或「貼紙」。 |
| sprite | 立繪 | 人格的表情圖片，社群慣稱「立繪」。需要精確時寫「立繪（表情頭像）」。 |
| humanizer | 擬人化 | 控制回覆自然程度的設定，數值寫「擬人化程度」。首次出現建議寫全稱以免與風格設定混淆。 |
| capability | 功能 | 指 bot 可使用的功能與工具集合（UI 的 Bot Capabilities 譯作「bot 功能」）。權限另有其詞，見 permission。 |
| tool | 工具 | 模型可呼叫的函式。工具名稱保持英文。 |
| cooldown | 冷卻 | 設定項名稱用「冷卻」，講到等待的秒數時寫「冷卻時間」。不寫「冷卻期」。 |
| self-hosting | 自架 | 台灣標準說法（自架伺服器）。不要用「自託管」或「自架設」。 |
| BYOK | BYOK | 縮寫保留英文，首次出現寫「BYOK（bring your own key，自備金鑰）」。UI 標籤「User BYOK」譯作「使用者 BYOK」。 |
| webhook | 網路鉤子 | 台灣社群多直接說 webhook。若全篇保留英文，需與 Discord 權限標籤「管理 Webhook」一致；若採譯名，權限標籤寫「管理網路鉤子」，全篇擇一。 |
| preset | 預設集 | 不可只寫「預設」，那與 server default 的「伺服器預設」撞詞。人格預設集寫「人格預設集」。 |
| lineage | 同脈 | 指多個伺服器或語言版本共用同一人格身分（DB 的 persona lineage）。用於「同脈人格」時指共用同一身分來源的人格。此譯法未經母語審校，見文末待決清單。 |
| deliberate trigger mode | 明確觸發模式 | 對應 UI 的 Deliberate Trigger Mode。不用「刻意」。 |
| deliberate tool mode | 明確工具模式 | 對應 UI 的 Deliberate Tool Mode。 |
| endpoint | 端點 | 自訂 API 位址。不用「端點服務」，贅字。 |
| sampler | 取樣器 | 台灣軟體圈用「取樣」，大陸用「採樣」。 |
| permission | 權限 | Discord 權限（Manage Server、Manage Webhooks 等）。不要與「功能」互換。 |
| server | 伺服器 | 台灣標準用語。不要寫「服務器」。 |
| channel | 頻道 | 文字頻道、討論串皆用「頻道」。 |
| role | 身分組 | Discord 的 role 在台灣中文客戶端是「身分組」。不要用「角色」（保留給 RP 意義的角色）。 |
| member | 成員 | 伺服器成員。不要用「用戶」。 |
| user | 使用者 | 台灣標準用語。不要寫「用戶」。 |
| avatar | 頭像 | 人格或伺服器的顯示圖片。 |
| message | 訊息 | 台灣標準用語。不要寫「信息」。 |
| document | 文件 | RAG 知識庫的檔案。不要寫「文檔」。 |
| context | 脈絡 | 提示詞中的上下文。指程式內部的 context 物件時保持英文。 |
| prompt | 提示詞 | 系統提示詞、人格提示詞、頻道提示詞。不要寫「提示語」。 |
| response style | 回覆風格 | 人格覆寫伺服器擬人化程度的設定。 |
| thought log | 思考紀錄 | 伺服器紀錄頻道中的推理內容。 |

## UI label mapping

面板與按鈕名稱必須取自本 locale 的 `src/locales/zh-TW/`，本表為基準譯值，實作時以 locale 檔為準。

| English label | zh-TW label |
|---|---|
| Main persona | 主要人格 |
| Alter persona | alter |
| Server default | 伺服器預設 |
| Personal override | 個人覆寫 |
| Switch Models | 切換模型 |
| Models | 模型 |
| Persona | 人格 |
| Behavior | 行為 |
| Plugins | 外掛 |
| Channels | 頻道 |
| Permissions | 權限 |
| Bot Capabilities | bot 功能 |
| Tool Use | 工具使用 |
| Available Tools | 可用工具 |
| Short-Term Memory | 短期記憶 |
| Server Memories | 伺服器記憶 |
| Personal Memories | 個人記憶 |
| Trigger Words | 觸發詞 |
| Sprites | 立繪 |
| Humanizer | 擬人化 |
| Apply Preset | 套用預設集 |
| Manage Server | 管理伺服器 |
| Manage Webhooks | 管理網路鉤子 |
| User BYOK | 使用者 BYOK |
| Self-Teaching | 自我教導 |

## Names and literal strings

- `Tomori`、`TomoriBot` 是專有名稱，任何情況都不翻譯。`general.defaults.bot_name` 的預設值維持 `Tomori`。
- 人格名稱（`Mirri`、`Juno`、`Bau (@bau_h)` 等）是專有名稱，不翻譯、不改寫、不加音譯。
- 斜線指令路徑、選項名、環境變數、URL、模型代號、供應商名稱保持英文。
- 基礎觸發詞 `tomori`、`tomo` 保持英文小寫，翻譯時不得改為中文字。

