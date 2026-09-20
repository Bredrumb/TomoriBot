---
title: "供應商與模型"
sidebar:
  order: 1
---

TomoriBot 沒有內建的 AI 模型，你要從供應商接一個進來。**供應商**是一項 AI 服務（Google Gemini、OpenRouter、NovelAI、本機端點等等），**模型**則是該供應商上的特定模型。你至少需要一個供應商才能真正使用她。

## API 金鑰
<!-- anchor: api-keys -->

在首次設定時用 `/setup` 加入供應商金鑰，或之後在 `/providers` 選擇 **+ 新增供應商**。金鑰會**加密儲存**：沒有人能讀回它們，包括伺服器管理員。

`/setup` 會先問回覆該如何送達模型，這個答案決定它會蒐集什麼：

| 模式 | 蒐集什麼 |
|---|---|
| **AI 供應商（建議）** | 目錄中的一個供應商及其 API 金鑰，經驗證並以草稿形式加密。 |
| **自訂端點（進階）** | 端點的連線與一個文字模型，在精靈內註冊。請看[自訂端點](#自訂端點)。 |
| **使用者 BYOK**（僅限伺服器） | 什麼都不蒐集：工作區不保有自己的供應商，所以成員必須自備個人供應商。 |

在按下 **完成設定** 之前不會寫入任何東西，所以被放棄或逾期的精靈不會動到工作區既有的供應商資料。要取代已經儲存的金鑰，請使用 `/providers`，因為 `/setup` 會拒絕在已設定過的工作區上執行。

每個供應商都有自己的金鑰產生步驟。執行 **`/help`**，選擇 **設定**，然後選 **取得 API 金鑰**，再挑你的供應商以取得確切的逐步說明，或使用這些起點：

| 供應商 | 備註 | 取得金鑰 |
|---|---|---|
| **Google Gemini** | 免費方案，可執行每一項功能。建議用來做第一次設定。 | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | 一組金鑰，多種模型（有些免費）。 | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| **NovelAI** | 訂閱制；無審查的故事創作與角色扮演（僅文字）。 | [NovelAI](https://novelai.net/) |
| **DeepSeek** | 依用量計費的推理模型。 | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | 託管的文字、嵌入與圖片。 | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | 透過 API 使用 Claude 模型（不是 Claude Code）。 | — |
| **Z.ai** | GLM 系列。⚠️ 使用條款限定於程式開發與代理情境。 | [Z.ai](https://z.ai/) |
| **Vertex AI** | 透過 `gcloud` ADC 使用 Google Cloud，最適合本機執行與開發設定。 | 見下方 |
| **Vertex AI Express** | Google Cloud API 金鑰 BYOK（預覽版，Gemini 子集）。 | [Express Mode](https://console.cloud.google.com/expressmode) |
| **自訂端點** | 任何與 OpenAI 相容的端點（Ollama、vLLM、LiteLLM 等等）。 | 見[自訂端點](#自訂端點) |

:::caution
永遠不要把你的 API 金鑰分享給任何人。自訂端點的 Bearer 驗證權杖，請從 `/providers` 中它的 **編輯端點** 動作新增或取代。
:::

**Vertex AI** 使用 Application Default Credentials 驗證，而不是儲存的機密。本機託管時，ADC 可以來自 `gcloud`；託管部署則應使用工作負載身分或服務帳號。單靠一組 AI Studio API 金鑰無法完成完整 Vertex AI 的驗證。選定的專案必須已啟用帳單與 Vertex AI API，而且主機身分需要 Vertex 的存取權。設定指南可在 `/help` 的 **API 金鑰** 頁面選擇 **Google Vertex AI** 取得。

Google 系列供應商的設定會透過需要驗證的模型清單端點驗證憑證。它不會生成文字，也不依賴目前被標示為目錄預設值的聊天模型，所以一個已退役的預設模型不會讓有效的憑證無法儲存。

### 選用：Brave Search 金鑰

Brave Search 與你的 AI 供應商是分開的，只會強化網頁搜尋（加入圖片、影片與新聞搜尋）。用 `/providers` 設定。⚠️ Brave 每月包含 $5 免費額度，請在 Brave 儀表板設定 $5 使用上限以避免產生費用。

## 選擇模型

`/providers` 管理伺服器憑證、模型目錄與端點註冊，而 `/config` > 模型 > 切換模型 則選擇這個伺服器每位成員共用的功能指派。兩者都需要所需的伺服器權限。個別成員用 `/personal providers` 管理自己的憑證與模型目錄，再於 `/personal config` 選擇個人模型。個人設定會跟著他們到每一個使用 TomoriBot 的伺服器。那一側請看[個人化](/zh-TW/features/knowledge/personalization/#your-own-providers)。

面板標題分別是 **伺服器供應商** 與 **個人供應商**，讓它們的歸屬在指令互動開啟之後仍然清楚。

設定好供應商之後，用 `/config` > 模型 > 切換模型 選擇共用的功能指派。六個一般位置會從供應商目錄中選擇模型紀錄：

- `/config` > 模型 > 切換模型：主要的聊天模型
- `/config` > 模型 > 切換模型：視覺模型（當聊天模型無法讀圖時用來讀圖）
- `/config` > 模型 > 切換模型：[文件知識庫](/zh-TW/features/knowledge/memory/#document-knowledge-base-rag)用的嵌入
- `/config` > 模型 > 切換模型：標準圖片生成（請看[圖片生成](/zh-TW/features/capabilities/media-generation/image-generation/)）
- `/config` > 模型 > 切換模型：NovelAI 圖片生成
- `/config` > 模型 > 切換模型：影片生成
- `/config` > 模型 > 切換模型：文字轉語音（TTS）端點
- `/config` > 模型 > 切換模型：語音轉文字（STT）端點

前六個項目選擇的是模型目錄紀錄。TTS 與 STT 兩個位置選擇的則是以工作區為範圍的端點，所以它們會啟用選定的端點，而不是寫入模型欄位。請在 `/providers` 註冊與編輯那些端點；它的端點啟用控制仍然有效。`/personal config` 保留六個個人模型路由位置，並未加入個人 TTS 與 STT 端點選擇器。

你也可以用 `/providers` 管理這個伺服器的備援金鑰，用於自動容錯與負載平衡。

## 自訂端點
<!-- anchor: custom-endpoints -->

自訂端點讓你把自架或以代理為後端的服務（Ollama、LM Studio、LiteLLM、vLLM、ComfyUI、本機 TTS 與 STT）註冊成**有標籤的供應商組合**。

- **伺服器範圍：**開啟 `/providers` 進行工作區的端點註冊與編輯。
- **個人範圍：**開啟 `/personal providers` 管理個人模型目錄（只有你，請看[個人化](/zh-TW/features/knowledge/personalization/#your-own-providers)）。個人語音端點不是從 `/personal config` 選擇的。

**標籤**是使用者看到的選單名稱，並在功能共用同一個端點 URL 時，把它們歸在同一個組合底下。它永遠不會被送到遠端端點。由不同 URL 提供的功能需要不同的標籤。選擇 **+ 新增自訂端點**，選好 API 相容性，然後儲存連線。儲存會準備該協定支援的功能，但不會註冊任何模型。接著選取新的端點，用它的模型下拉選單註冊確切的模型代號與功能。加入模型就會為該項功能啟用它。用同一個下拉選單附加更多模型，或編輯工作區新增的註冊資料。文字模型會在那份表單中宣告自己的能力，圖片模型則宣告自己支援哪些請求模式。

至於 TTS 與 STT，請在 `/providers` 註冊端點與它的模型，然後在 `/config` > 模型 > 切換模型 選擇並啟用該端點。那些語音位置選擇的是端點，而不是模型目錄紀錄。`/providers` 仍然是端點註冊、模型設定與編輯的介面。

API 相容性決定了服務實作的請求路徑與內容，因此也決定了這條連線會準備哪些功能位置。為那些位置註冊確切的模型是另一個步驟，而且無法從端點 URL 可靠地推斷協定。

`/setup` 的**自訂端點（進階）**模式會在精靈內執行同樣的兩個步驟：**設定連線**會在一次連線檢查之後儲存 API 相容性、標籤、URL 與選用的驗證權杖，**設定文字模型**則註冊確切的文字模型與它的能力宣告。在連線通過驗證之前，模型按鈕會保持停用，而重新儲存連線會清除模型宣告，因為那些宣告取決於 API 相容性。在你按下 **完成設定** 時，精靈會一起建立連線、已儲存的供應商、模型與使用中模型等資料列，所以它永遠不會留下沒有可用文字模型的連線。它只註冊文字模型；圖片、影片、TTS 與 STT 功能仍然在 `/providers` 註冊。

執行這些伺服器的完整逐步說明請看：

- [設定：本機 LLM](/zh-TW/self-hosting/local-endpoints/setup-local-llm/)：Ollama、KoboldCPP、LM Studio、vLLM、LiteLLM。
- [設定：ComfyUI](/zh-TW/self-hosting/local-endpoints/setup-comfyui/)：本機圖片與影片生成。
- [設定：ChatMock](/zh-TW/self-hosting/local-endpoints/setup-chatmock/)：ChatGPT 帳號與 Codex CLI。

## 支援的供應商
<!-- anchor: supported-providers -->

如果你沒有自架模型所需的硬體，TomoriBot 支援各式各樣的服務。不是每項功能都能在每個供應商上使用。

### LLM 供應商

| 供應商 | 串流 | 工具呼叫 | 圖片輸入 | 嵌入 | 備註 |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | 有免費模型 |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | 有免費模型 |
| **Anthropic (API)** | ✅ | ✅ | ✅ | – | 不是 Claude Code |
| **NovelAI** | ✅ | ✅ | – | – | 只有 GLM 4.6 可以使用工具 |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | 有免費模型 |
| **DeepSeek** | ✅ | ✅ | – | – | – |
| **Z.ai** | ✅ | ✅ | ✅ | – | 有免費模型；⚠️ 使用條款限定程式開發與代理用途 |
| **Z.ai Coding** | ✅ | ✅ | – | – | 訂閱方案 |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | 包含「免費」的 Express 版本 |
| **Codex CLI (via ChatMock)** | ✅ | ✅ | ✅ | – | [設定](/zh-TW/self-hosting/local-endpoints/setup-chatmock/) |

### 圖片生成

| 供應商 | 文字生圖 | 圖片生圖 | 內補 | 備註 |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | – | – |
| **OpenRouter** | ✅ | ✅ | – | – |
| **NovelAI** | ✅ | ✅ | ✅ | 可以與其他供應商搭配使用 |
| **NVIDIA** | ✅ | – | – | 僅文字生圖；參考圖片會被忽略 |
| **Z.ai** | ✅ | – | – | – |

這些是供應商圖片模型起始時採用的**預設值**，而 NovelAI 走的是自己的流程，不使用這張表。透過 `/providers` 註冊圖片模型時，你可以宣告該模型自己的模式，這就是在 ComfyUI 工作流或 API 支援遮罩編輯的供應商模型上啟用內補的方式。沒有宣告過的模型會繼續沿用上方的預設值，所以之後修正預設值會自動套用到它。只宣告模型真正做得到的事：Tomori 提供工具的模式完全就是你勾選的那些，而 API 拒絕的模式就會變成失敗的生成。

### 影片生成

| 供應商 | 文字生影片 | 圖片生影片 | 備註 |
|---|---|---|---|
| **Google** | ✅ | ✅ | 非同步輪詢流程 |
| **OpenRouter** | ✅ | ✅ | 非同步輪詢流程 |
| **Z.ai** | ✅ | ✅ | 非同步輪詢流程 |

### 語音與音訊

| 供應商 | 文字轉語音 | 語音轉文字 |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

本機語音引擎收錄在[自架](/zh-TW/self-hosting/)底下。內建的網頁搜尋與 URL 抓取引擎請看[工具與擴充](/zh-TW/features/capabilities/tools-and-extensions/#網頁搜尋與-url-讀取)。
