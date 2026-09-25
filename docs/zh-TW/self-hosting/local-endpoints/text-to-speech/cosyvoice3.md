---
title: "CosyVoice 3"
---

CosyVoice 3 是 Alibaba 與 QwenAudio 多語言 CosyVoice TTS 專案的當代版本。TomoriBot 在 `servers/tts/cosyvoice3/` 中包裝官方執行環境，並提供與其他本機語音端點相同的 `POST /synthesize` 介面。

TomoriBot 預設使用官方 **`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`** 檢查點。它是上游推薦的現行 CosyVoice 3 版本，使用未量化的正常模型，而且小到可以在 16 GB 的 NVIDIA GPU 上舒適運行，同時保留 CosyVoice 的低延遲設計。

## 它支援什麼

現行的 CosyVoice 3 版本支援：

- 中文、英文、日文、韓文、德文、西班牙文、法文、義大利文與俄文
- 18 種以上的中文方言與口音
- 零樣本語音複製
- 多語言與跨語言語音複製
- 針對語言、方言、情緒、語速與音量的自然語言指示
- 上游執行環境中的精細控制，包括 `[breath]` 與 `[laughter]`
- 上游執行環境中的文字輸入與音訊輸出串流

官方 CosyVoice 3 範例目前包含一個重要的日文注意事項：日文文字是在轉換成片假名之後顯示的。日文是支援的語言，但如果一般日文拼寫導致發音不佳，將合成文字轉成片假名是上游推薦的變通做法。

## TomoriBot 如何對應請求

包裝接受一般的 `tts-clone` 欄位：

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

它依下列方式選擇目前的 CosyVoice 3 API：

| 請求 | CosyVoice 3 路徑 |
|---|---|
| 參考音訊加逐字稿 | `inference_zero_shot` |
| 參考音訊但沒有逐字稿 | `inference_cross_lingual` |
| `instruct` 或明確的 `language` | `inference_instruct2` |

若想要最佳的普通複製品質，請同時提供參考音訊與它對應的逐字稿。CosyVoice 3 目前的指示 API 以參考音訊為條件，但不同時接受參考逐字稿，所以使用 `instruct` 的請求會切換到官方的 `inference_instruct2` 路徑。

### 風格與情緒控制

請以 `純文字` 標記註冊端點。語氣指示屬於端點的全局
`voice_instructions` 欄位，不屬於任意的行內方括號標籤。這樣能保留指示對整段語句的意義，也避免把像
`[happy] Hello. [sad] Goodbye.` 這樣的腳本當成兩個互相矛盾的全局指示。原生的 `[breath]` 與 `[laughter]`
支援刻意延後，直到 TomoriBot 能宣告確切的供應商感知標籤能力。

`/synthesize` 的 `instruct` 欄位會傳入 CosyVoice 3 的指示條件。例子
包括 `sound relieved but still tired`、`speak as quickly as possible` 或 `speak quietly with
restrained excitement`。

## 串流

CosyVoice 3 上游支援雙向串流。專案同時記載文字輸入串流與音訊輸出串流，在其最佳化設定中首次音訊延遲可低至約 150 ms。

TomoriBot 目前的自訂 TTS 介面預期一則 Discord 語音訊息對應一個完整的音訊回應，所以這個伺服器會回傳完整的 WAV，並將上游推論預設為
`stream=False`。只有在你測試上游生成器時才設定 `COSYVOICE3_UPSTREAM_STREAM=1`；在串流語音傳輸存在之前，它不會降低 TomoriBot 的回應延遲。

## 硬體

建議的 TomoriBot 起點：

- 具備 **16 GB VRAM** 的 NVIDIA GPU
- Python **3.10**
- 與 CUDA 12 相容的近期 NVIDIA 驅動程式
- `git`
- `ffmpeg`，供 TomoriBot 正規化語音樣本
- 若遇到上游音訊相容性問題，Linux 上需要 `sox` 與 `libsox-dev`

模型本身是 0.5B 參數，不需要量化就能塞進 16 GB 的卡。Hugging Face 檢查點的下載量比參數數量暗示的大得多，因為它還附帶 flow 模型、語音 tokenizer、英文文字模型，以及 base 與 RL 兩套 LLM 權重。請為目前的模型包預留約 10 GB 磁碟空間，外加 Python 環境與執行環境。

透過上游執行環境可以進行 CPU 推論，但那不是低延遲 Discord 語音的建議路徑。

## 安裝

### Linux 與 WSL2（推薦）

從 TomoriBot 儲存庫根目錄：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或者把設定好的伺服器與 TomoriBot 一起啟動：

```bash
bun run launch --cosyvoice3
```

安裝程式會：

1. 以遞迴方式將已審閱的 `QwenAudio/CosyVoice` 提交 `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` 簽出到 `servers/tts/cosyvoice3/CosyVoice/`；
2. 建立 `servers/tts/cosyvoice3/.venv`；
3. 安裝目前的上游 CosyVoice 需求，加上小型包裝的相依套件集；以及
4. 將 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 在 Hugging Face 修訂版 `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` 下載到 `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`。

重新執行會維持那些確切的修訂版；若要改用較新的修訂版，請同時修改安裝程式中的兩個釘住值。如果執行環境的簽出有本機變更，安裝程式會拒絕在其上重新安裝。

上游需求目前使用 PyTorch 2.3.1 搭配 CUDA 12.1 套件索引、Linux 上的 CUDA 12 ONNX Runtime 套件，以及 Linux 上的 TensorRT 10.13 套件。如果你使用的硬體需要更新的 PyTorch CUDA 建置，請在上游需求之後，於伺服器的 venv 中安裝相容的 PyTorch 建置，並用你的驅動程式測試。

### Windows PowerShell

原生 Windows 是以盡量支援的方式提供：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

若使用 NVIDIA GPU，**建議使用 WSL2**。目前的上游需求在 Linux 上會安裝 GPU ONNX Runtime，在 Windows 上則安裝 CPU ONNX Runtime，所以 WSL2 更貼近 CosyVoice 專案為低延遲最佳化與測試的設定。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `新增自訂端點`，並設定語音端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8017`
- Voice Source Mode：`Clone`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線之後，選取它並加入一個 Speech 模型。清楚的模型代號是 `Fun-CosyVoice3-0.5B-2512`。

接著開啟 `/config` > 模型 > 切換模型，啟用 CosyVoice 3 語音端點。

## 指派人格語音

一般的零樣本複製：

1. 準備一段乾淨、3 到 30 秒、只有一位說話者且背景噪音很少或沒有的樣本。
2. 開啟 `/config`，在模型 > TTS 參數與語音 底下上傳該樣本。
3. 盡可能輸入對應的逐字稿。CosyVoice 3 會用它走有逐字稿的零樣本路徑，而它會以提示前綴的形式被 tokenizer 處理，所以它應該描述實際被使用的音訊：也就是片段最前面的 30 秒。
4. 開啟 `/config`，在人格 > 語音 底下將該樣本指派給人格。

CosyVoice 的語音 tokenizer 以 30 秒的提示窗運作，而上游是用失敗來強制這一點：上游自己的網頁介面會請你把提示音訊保持在 30 秒以下，而 tokenizer 會斷言這個上限，而不是縮短音訊本身。本機伺服器改為截短，所以較長的片段會被截到最前面的 30 秒並繼續合成，截短會記錄在伺服器的主控台。

截短會就地讀取片段，這表示說話者嵌入取自與提示語音 token 相同的最前面 30 秒。CosyVoice 用來做條件設定的就是這個配對，所以較長的參考音訊不會失去引擎原本會用到的任何內容。實際影響是，較長的上傳只有最前面的 30 秒會影響聲音，其餘部分會被上傳並儲存，卻不會被使用。

把指派給人格的樣本保持在 10 到 20 秒，就能從容地落在這個窗內，也能讓儲存的逐字稿與模型讀取的音訊保持一致。

跨語言複製是支援的。參考說話者可以說與生成文字不同的語言。如果沒有參考逐字稿，包裝會使用 CosyVoice 3 專屬的跨語言路徑。

## 用 `/generate voice-message` 測試

使用 `/generate voice-message` 測試作用中的端點，不必等一般聊天輪次去挑選語音工具。你可以使用人格設定好的樣本，或上傳一次性的樣本。上傳樣本時，請盡可能在表單中提供它的逐字稿。

若要有表情的語氣，請在表單中輸入全局語氣指示，或讓語音工具送出
`voice_instructions`。請讓朗讀的腳本維持純文字；任意的行內風格標籤會在合成前被移除，而不是被誤認為整段語句的指示。

## 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本機檢查點目錄 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包裝綁定位址; 請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 包裝連接埠 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 啟用 CosyVoice 內部的串流生成器 |
| `COSYVOICE3_SPEED` | `1.0` | 傳給上游推論的全局數值速度倍率 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空 | 請求未提供指示時加入的選用指示 |
| `COSYVOICE3_FP16` | `0` | 要求官方執行環境使用它的 fp16 模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 在正確準備之後啟用上游 TensorRT 載入 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 在安裝其獨立相依套件後啟用上游 vLLM 載入 |

預設會關閉 TensorRT、vLLM 與 fp16。一般的 PyTorch 執行環境已經能塞進目標的 16 GB GPU、安裝更簡單，也避免把預設路徑變成特定最佳化的設定。

## 效能與模型變體

### 預設：base `Fun-CosyVoice3-0.5B-2512`

這是 TomoriBot 的推薦預設。它有很強的說話者相似度、支援目前所有 CosyVoice 3 複製與指示模式，而且在 16 GB GPU 上不需要量化。

### RL 權重

目前的檢查點包也包含 `llm.rl.pt`。上游分別發布 base 與 RL 的結果。RL 權重改善部分內容錯誤指標，而 base 結果在已發布的表格中保有些微更強的說話者相似度分數。因為 TomoriBot 強調人格語音複製，包裝讓一般的 `llm.pt` 維持為預設。

目前的官方載入器一律讀取名為 `llm.pt` 的檔案。若想在不覆寫預設安裝的情況下試用 RL 權重，請複製模型目錄、用 `llm.rl.pt` 取代複本的 `llm.pt`，並將 `COSYVOICE3_MODEL_DIR` 指向那個複本。

### vLLM 與 TensorRT

CosyVoice 3 也支援選用的 vLLM 與 TensorRT 路徑。上游目前記載使用 V1 引擎的 vLLM 0.11.x 以上，以及作為舊路徑的 vLLM 0.9.0。這些執行環境有額外的版本與硬體限制，所以 TomoriBot 預設不安裝也不啟用它們。

請先讓普通的 PyTorch 伺服器可以運作，再使用它們。對 Discord 語音訊息的工作負載而言，避免額外的執行環境複雜度，通常比最佳化一個本來就小的 0.5B 模型更有用。

## 授權條款

目前的 CosyVoice 程式碼儲存庫採用 **Apache License 2.0**，而 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 的 Hugging Face 儲存庫同樣標示為 **Apache-2.0**。

上游的模型卡另外包含一段免責聲明，說明所顯示的內容是學術示範，且部分範例可能來自網際網路。一則上游的公開討論要求明確釐清該免責聲明與權重商業使用之間的關係。TomoriBot 不重新散布該模型。自架者應就自己的部署檢視目前的上游授權條款與模型卡條款，尤其是在商業使用之前。
