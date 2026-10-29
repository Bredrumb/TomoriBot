---
title: "設定：本機 LLM"
aiGenerated: false
sidebar:
  label: "本機 LLM"
  order: 1
---

TomoriBot 可以使用任何 OpenAI 相容的本機 LLM 伺服器進行文字生成與嵌入。

:::note[不需要環境變數]
本機模型透過 Discord 斜線指令註冊，並加密儲存在資料庫中。它們沒有 `.env` 設定。
:::

## 1. 執行你的模型伺服器

本指南以 Ollama 為例逐步說明，因為它最容易上手；你也可以使用任何你想要的伺服器，特別是如果你已經具備更多技術背景！

安裝 [Ollama](https://ollama.com)。底下的範例使用 Google 的 Gemma 4，但 [Ollama 的模型庫](https://ollama.com/library)中任何模型都可以使用。

### 我該拉取哪種大小？
<!-- anchor: which-size-should-i-pull -->

本機模型執行在你的 GPU VRAM（顯示卡內建的記憶體，與系統 RAM 分開）中。經驗法則：模型至少需要等於其下載大小的可用 VRAM，再加上約 1 到 2 GB 的餘裕給對話脈絡。挑選適合你顯示卡的最大 Gemma 4：

| 你的 GPU VRAM | 最合適 | 下載大小（約） |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b`（可完整容納）或 `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` 或 `gemma4:31b` | 18 / 20 GB |

下載大小是 Ollama 預設量化的大小；確切數值請參閱[模型頁面](https://ollama.com/library/gemma4)。不確定自己有多少 VRAM 嗎？在 Windows 上：`工作管理員` > `效能` > `GPU`，查看「專用 GPU 記憶體」。

拉取你選擇的大小並啟動伺服器：

```sh
ollama pull gemma4:12b     # 替換為適合你 VRAM 的標籤
ollama serve               # 接聽 http://127.0.0.1:11434
```

確認從 TomoriBot 執行的機器可以連線到它：

```sh
curl http://127.0.0.1:11434/v1/models
```

記下確切安裝的標籤，因為這就是你要註冊的 Model Name：

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. 在 Discord 中註冊

執行 `/providers`（全伺服器）或 `/personal providers`（僅個人），選擇 `+ 新增自訂端點`，並輸入：

| 欄位 | Ollama 的值 |
|-------|------------------|
| `endpoint_label` | 你自訂的名稱，例如 `home-ollama` |
| API Compatibility | `OpenAI-Compatible`（推薦）或 `Ollama` |
| `endpoint_url` | OpenAI-Compatible 使用 `http://127.0.0.1:11434/v1` · Ollama 使用 `http://127.0.0.1:11434` |
| `auth_token` | *（留空）* |

:::tip[選擇與 API 相容性相符的 URL]
`OpenAI-Compatible` 與 `Ollama` 均接受單純的根路徑並將其正規化為 `/v1` 基底。`/chat/completions` 會自動附加，因此請勿手動新增。已帶有路徑的 URL（例如 `https://openrouter.ai/api/v1` 或閘道前綴）會逐字儲存。
:::

儲存連線後，選取它並從其模型下拉選單中選擇 `+ 新增 Text 模型`。填寫：

- **Model Name（確切 API ID）：** `gemma4:12b`，即來自 `ollama list` 的確切標籤。
- **Context Window Override：** 選填，僅限 Ollama / KoboldCPP。設定此值（例如 `8192`、`16384`）可提高 Ollama 的預設 `num_ctx`，否則預設值過小可能會截斷 TomoriBot 的長脈絡。留空則使用伺服器預設值。
- **開關：** 若模型支援函式呼叫請啟用 `工具呼叫`；僅對視覺模型啟用 `圖片輸入`；若模型能良好處理 JSON 結構描述請啟用 `結構化輸出`。在我們的範例中，Gemma 4 全部支援，因此請全部勾選。

TomoriBot 會在你儲存時驗證連線。若回報端點無法連線，通常是因為 `localhost`/Docker 不一致或缺少/多餘的 `/v1`（請參閱[注意事項與陷阱](#notes--gotchas)）。

新增模型會自動讓它成為作用中的 `text` 模型。開始聊天即可測試。若因某種原因未處於作用中狀態，請執行 `/config` > 模型 > 切換模型 並選取你新註冊的模型。

## 3.（選用）RAG 用的本機嵌入

選取已儲存的端點，並使用其模型下拉選單新增 Embedding 模型（例如 `ollama pull nomic-embed-text`，Model Name 為 `nomic-embed-text:latest`）。RAG 功能還需要在 Postgres 中安裝 pgvector。你可以在此查看[手動設定](/self-hosting/manual-setup/)指南。

## 4.（選用）與 ComfyUI 共用單一 GPU
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

若文字模型與 ComfyUI 執行在同一個 GPU 上，TomoriBot 可以在 ComfyUI 圖片或影片工作執行期間卸載文字模型。在工作期間抵達的文字回覆會等待至 GPU 再次可用為止。

開啟已儲存的端點，按下 `編輯端點`，並在 `端點行為` 底下勾選 `ComfyUI 工作期間卸載模型`。TomoriBot 會在你儲存時檢查該 URL 上的伺服器類型：

- **Ollama：** 安裝即可直接運作。TomoriBot 會在工作執行前要求 Ollama 卸載模型，Ollama 則會在下一個文字請求時重新載入。
- **KoboldCpp：** 啟動 KoboldCpp 時加上 `--admin` 與 `--admindir`，並將端點的驗證權杖設定為管理員密碼。TomoriBot 會使用 KoboldCpp 的管理員重新載入 API 卸載模型，並在之後重新載入。

儲存時會拒絕任何其他伺服器，因為通用的 OpenAI 相容伺服器沒有通用的模型卸載方式。

## 其他伺服器

TomoriBot 支援任何 OpenAI 相容的端點，但推薦使用以下伺服器。所有這些伺服器都使用相同的流程：只有 URL 與少數注意事項不同。

### KoboldCPP

- 啟動時啟用 OpenAI 相容性（內建）。預設：`http://127.0.0.1:5001/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:5001/v1`。
- 與 Ollama 一樣遵循 `Context Window Override`。
- 若要在 ComfyUI 工作期間卸載模型，啟動時請一併加上 `--admin` 與 `--admindir`（請參閱[與 ComfyUI 共用單一 GPU](#4-optional-share-one-gpu-with-comfyui)）。
- 載入 GGUF 模型；Model Name 是已載入模型所回報的名稱（通常是檔名主幹），請檢查 KoboldCPP 的 `/v1/models` 回應。

### llama.cpp（`llama-server`）

- 建置或安裝 [llama.cpp](https://github.com/ggml-org/llama.cpp)，接著使用其隨附的 OpenAI 相容伺服器提供 GGUF：
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8080/v1`。
- 在啟動時使用 `-c` 設定脈絡視窗；互動視窗中的 `Context Window Override` 僅限 Ollama/KoboldCPP，在此處無效。
- Model Name 是 `/v1/models` 回報的名稱；可以使用 `--alias my-model` 給予簡潔的名稱。
- 若使用 `--api-key` 啟動，請將該金鑰填入 `auth_token`。

### LM Studio

- 在 LM Studio 中，啟動 `Local Server`（`Developer` 標籤頁）。預設：`http://127.0.0.1:1234/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:1234/v1`。
- Model Name 是 LM Studio 為已載入模型顯示的識別碼。

### vLLM

- 使用 OpenAI 相容伺服器提供服務：`vllm serve <model>` → `http://127.0.0.1:8000/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8000/v1`。
- 若使用 `--api-key` 啟動 vLLM，請將該金鑰填入 `auth_token`。
- Model Name 是提供的模型路徑/名稱（與 `/v1/models` 相符）。

### LiteLLM（多後端代理）

- 執行 LiteLLM 代理；預設：`http://127.0.0.1:4000/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:4000/v1`。
- Model Name 是你在 LiteLLM 設定中定義的模型別名。
- 若代理強制要求主金鑰，請在 `auth_token` 中設定。

### ChatMock（ChatGPT 帳號 / Codex CLI）

因為需要系統提示詞變通方案，擁有專門的指南：
[設定：ChatMock](/self-hosting/local-endpoints/setup-chatmock/)。

## 從 Hugging Face 選擇模型

除了 Ollama 精選的模型庫之外，[Hugging Face](https://huggingface.co) 還託管了成千上萬個社群模型。KoboldCPP、llama.cpp 與 LM Studio 都可以載入 GGUF 格式：這是一種下載後將伺服器指向該檔案的單一檔案套件。

1. **尋找 GGUF：** 在 Hugging Face 上搜尋你的模型加上「GGUF」；像 [bartowski](https://huggingface.co/bartowski) 這樣的社群量化者通常在多數熱門模型發布後不久就會推出 GGUF 版本。偏好使用 instruct/chat 變體（名稱結尾為 `-Instruct` 或 `-Chat`）；基礎模型無法進行對話。
2. **挑選適合你 VRAM 的量化版本：** 存放庫會列出同一個模型的多種量化等級，檔案大小約略等於所需的 VRAM（再加上約 1 到 2 GB 用於脈絡，規則與上方的[大小規格表](#which-size-should-i-pull)相同）。下載符合你選擇的單一 `.gguf` 檔案。
3. **載入模型：** 使用該檔案啟動 KoboldCPP 或 `llama-server`（請參閱[其他伺服器](#other-servers)），然後如常在 Discord 中註冊端點。

:::tip[該選哪種量化？Q4 或 Q5 是最佳平衡點]
量化透過以較少位元儲存每個權重來縮小模型，代價是微小的品質損失。像 `Q4_K_M` / `Q5_K_M` 這樣的代號表示每個權重的位元數：**4-bit（Q4）或 5-bit（Q5）通常是最佳平衡點**，能以約 8-bit 一半的體積保留大部分品質。低於 4-bit 品質會迅速下降。而且在固定的 VRAM 預算下，**Q4 的較大模型通常優於 Q8 的較小模型**。
:::

## 注意事項與陷阱
<!-- anchor: notes--gotchas -->

- **每個標籤一個端點項目：** 若要註冊共用同一個伺服器的多個模型，請選取已儲存的端點並再次使用其模型下拉選單。真正不同的伺服器或 API 協定才使用相異的標籤。
- **Model Name 即為 API 識別碼：** 它是發送到伺服器的確切字串。填寫錯誤是「已連線但回覆失敗」最常見的原因。
- **在 Docker 中執行 TomoriBot？** 容器內的 `localhost` 並非你的主機。請使用 `http://host.docker.internal:<port>`（Windows/macOS）或主機的區域網路 IP，並將模型伺服器繫結到 `0.0.0.0`。
- **使用 Compose？** 其 `RUN_ENV=development` 設定允許本機 HTTP 端點。生產環境執行時期強制使用 HTTPS 並封鎖私人網路目的地，除非呼叫端明確允許。`FETCH_URL_ALLOW_PRIVATE_NETWORK=true` 允許在生產環境中將私人目標用於 `fetch_url`；這不會改變供應商端點規則。雲端中繼資料位址在所有模式下均保持封鎖。
