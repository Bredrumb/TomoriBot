---
title: "CosyVoice 3"
aiGenerated: true
---

使用阿里巴巴的 [CosyVoice 3](https://github.com/QwenAudio/CosyVoice)，透過基於指示的情緒表達來合成自然的多語言角色語音。

CosyVoice 3 提供跨 9 種語言與超過 18 種中文方言的零樣本與跨語言聲音複製。TomoriBot 在 `servers/tts/cosyvoice3/` 中封裝了官方執行時期，以公開標準的 `POST /synthesize` 語音介面。隨附的安裝程式預設使用官方未量化的 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 模型，可在 16 GB VRAM 內執行。

CosyVoice 支援九種語言與多種中文方言。若日語發音不佳，上游建議將文字轉換為片假名。

請使用 `Plain` 腳本標記，並透過 `voice_instructions` 提供發音風格指導。相符的參考逐字稿可啟用零樣本複製；若無逐字稿，伺服器會使用跨語言複製。指示模式會使用參考音訊而不使用其逐字稿。

## 硬體需求

建議硬體規格：

- 配備 16 GB VRAM 的 NVIDIA GPU
- Python 3.10
- 與 CUDA 12 相容的 NVIDIA 驅動程式
- `git`
- 用於語音樣本正規化的 `ffmpeg`
- 若在 Linux 上遇到音訊相容性問題，請安裝 `sox` 與 `libsox-dev`

0.5B 參數模型在無需量化的情況下可輕鬆放入 16 GB VRAM。下載的檢查點包含 flow 模型、語音 tokenizer、文字模型與強化學習權重，大約需要 10 GB 磁碟空間加上 Python 相依套件。

雖然上游在技術上支援 CPU 推論，但對於 Discord 語音互動而言速度過慢。

## 安裝

### Linux 與 WSL2（推薦）

從 TomoriBot 存放庫根目錄執行：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或同時啟動已設定好的伺服器與 TomoriBot：

```bash
bun run launch --cosyvoice3
```

安裝程式會下載固定的執行時期與模型修訂版本，並拒絕覆寫包含未提交變更的簽出版本。

上游需求會安裝隨附 CUDA 12.1 套件的 PyTorch 2.3.1、Linux 上的 CUDA 12 ONNX Runtime 套件，以及 Linux 上的 TensorRT 10.13 套件。若你的 GPU 需要較新的 PyTorch 組建，請在設定完成後於虛擬環境內安裝相容的 PyTorch 組建。

### Windows PowerShell

原生 Windows 提供作為盡力支援的路徑：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

在 Windows 上使用 NVIDIA GPU 強烈建議採用 WSL2。上游需求在 Windows 上安裝僅支援 CPU 的 ONNX Runtime，而 Linux 與 WSL2 則會安裝 GPU 加速套件。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `+ 新增自訂端點`，並設定語音端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8017`
- 語音來源模式：`Clone`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線後，選取它並新增 Speech 模型。清晰的模型代碼為 `Fun-CosyVoice3-0.5B-2512`。

接著開啟 `/config` > 模型 > 切換模型 並啟用 CosyVoice 3 語音端點。

## 指派人格語音

零樣本聲音複製步驟：

1. 準備一段乾淨的 3 到 30 秒音訊片段，單一講者且背景雜音極小。
2. 在 `/config` 的 模型 > TTS 參數與語音 底下上傳該樣本。
3. 若有對應的逐字稿請一併輸入。CosyVoice 3 會將此逐字稿 tokenize 為零樣本複製的提示前綴；它應描述該音訊的前 30 秒。
4. 在 `/config` 的 人格 > 語音 底下將該樣本指派給人格。

包裝器會將參考音訊裁切為前 30 秒。跨語言複製可以使用與生成文字不同語言的參考語音。

## 使用 `/generate voice-message` 測試

使用 `/generate voice-message` 測試語音合成，無需等待自動對話觸發。你可以使用指派給人格的樣本進行測試，或上傳附有逐字稿的單次音訊片段。

若要引導情緒與發音風格，請在互動視窗中輸入指示，或由人格提示詞提供 `voice_instructions`。請將朗讀文字保持為純對話文字；行內風格標籤會在合成前被移除。

## 環境變數

| 變數 | 預設值 | 用途 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本機檢查點目錄 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包裝器繫結位址；請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 包裝器連接埠 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 啟用 CosyVoice 內部串流產生器 |
| `COSYVOICE3_SPEED` | `1.0` | 傳遞給上游推論的全域數值速度乘數 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空 | 當請求未提供指示時加入的選用指示 |
| `COSYVOICE3_FP16` | `0` | 要求官方執行時期使用其 fp16 模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 在正確準備後啟用上游 TensorRT 載入 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 在安裝獨立相依套件時啟用上游 vLLM 載入 |

預設情況下，TensorRT、vLLM 與 fp16 保持停用。標準 PyTorch 執行時期可在 16 GB GPU 上舒適執行，無需額外的執行時期相依套件。

## 模型變體

若要嘗試隨附的 RL 權重，請複製模型目錄，在複本中將 `llm.rl.pt` 重新命名為 `llm.pt`，並將 `COSYVOICE3_MODEL_DIR` 指向該目錄。選用的 vLLM 與 TensorRT 執行時期需要獨立安裝相依套件。

## 授權條款

CosyVoice 程式碼庫與 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 權重均在 Apache-2.0 授權條款下發布。

上游模型卡指出展示材料僅供學術評估。TomoriBot 不散布模型權重。在進行商業部署之前，請針對你的特定使用情境檢視上游授權與條款。
