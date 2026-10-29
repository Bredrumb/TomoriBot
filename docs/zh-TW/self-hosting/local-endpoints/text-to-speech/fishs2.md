---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

使用 [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech)，透過精細的情緒標籤合成極具表現力的多語言角色語音。

Fish Audio S2 Pro 是一個多語言 4B 參數文字轉語音模型，專為高傳真聲音複製而打造。TomoriBot 透過 `servers/tts/fishs2/` 中的本機包裝器連接至該模型。它預設使用官方 BF16 權重（`fishaudio/s2-pro`），並為配備 8 到 12 GB VRAM 的 GPU 提供選用的 INT8 量化檢查點（`Imagilux/fishaudio-s2-pro`）。

Fish S2 Pro 支援括號表情標籤，例如 `[whisper]`、`[excited]` 與 `[angry]`。將端點設定為 `方括號標籤` 標記，TomoriBot 便會在產生的語音腳本中保留這些控制標籤。

## 授權條款

Fish Speech 程式碼與 S2 Pro 模型權重依據 Fish Audio Research License 發布。依其條款允許研究與非商業用途；商業使用需要取得獨立的 Fish Audio 授權。

TomoriBot 不重新散布模型權重。每位自架使用者均直接從 Hugging Face 下載 Fish S2 Pro，並有責任遵守 Fish Audio Research License。要求的標示為：Built with Fish Audio。

## 硬體與作業系統

> [!IMPORTANT]
> 為了達到實用的推論速度，請使用 Linux 或 WSL2。包裝器預設停用編譯；設定 `FISH_S2_COMPILE=1` 可啟用 Triton 編譯。原生 Windows 每個音訊片段可能需耗時 8 到 10 分鐘。

建議硬體規格：

- **Linux 或 WSL2（強烈建議）**
- 配備 16 GB 至 24 GB VRAM 的 NVIDIA GPU（BF16 搭配 KV 快取與卸載可舒適容納於約 16 到 18 GB VRAM 內）
- 建議使用 Python 3.12
- `git`、`ffmpeg` 以及 Fish Speech 所需的標準音訊函式庫

## 設定

### Linux 與 WSL2（推薦）

從 TomoriBot 存放庫根目錄執行：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安裝程式會下載固定的 Fish Speech 執行時期與官方 BF16 檢查點。將 `FISH_S2_MODEL_REVISION` 設定為不可變的修訂版本以實現可重現的模型下載。

Hugging Face 上的該模型需要權限申請（gated）。請先在 Hugging Face 上同意其授權。若下載時提示身分驗證，請執行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

接著重新執行安裝程式。

### Windows PowerShell（僅供評估支援）

原生 Windows 僅提供作為評估用途。由於未編譯 eager 模式下的驅動程式調度延遲，生成速度會極為緩慢（每個片段約需 8 到 10 分鐘）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

PowerShell 安裝程式預設以 CUDA GPU 加速（`cu124`）為目標。若要在沒有 NVIDIA GPU 的純 CPU 機器上安裝，請傳入 `-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

若 Windows 上的 PyTorch 需要手動安裝或更新 CUDA 支援，請執行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot 在 `TTS_SYNTHESIZE_TIMEOUT_MS`（預設 240000 ms）後會停止等待語音訊息，這比原生 Windows 處理片段所需的時間更短。在 Windows 上評估時，請在 TomoriBot 的 `.env` 中調高此數值（例如 `TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 必要參考逐字稿

> [!WARNING]
> Fish S2 Pro 需要參考音訊的確切逐字稿。請在 `/config` > 模型 > TTS 參數與語音 底下的 `參考逐字稿` 欄位中輸入；若缺少此資訊，包裝器會拒絕請求。

## 在 TomoriBot 中註冊

在 `/providers` 中，選擇 `+ 新增自訂端點` 並設定：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8015`
- 語音來源模式：`Clone`
- Script Markup：`方括號標籤`
- API key：留空。包裝器沒有身分驗證機制；請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access)。

接著新增該端點的模型項目，並透過 `/config` 底下的 模型 > 切換模型 啟用它。

## 新增人格語音

1. 準備一段乾淨的 10 到 20 秒參考音訊，單一講者且背景雜音極少或無雜音。
2. 在 `/config` 中開啟 模型 > TTS 參數與語音，並上傳語音樣本。
3. **輸入確切的逐字稿**：將參考音訊中朗讀的確切文字輸入到參考文字欄位中。
4. 在 `/config` 中開啟 人格 > 語音，並將該樣本指派給人格。
5. 使用 `/generate voice-message` 生成語音訊息，或讓 TomoriBot 透過其語音訊息工具生成。

上游建議使用 10 到 30 秒的參考樣本。

## 表情控制

Fish S2 Pro 可以使用括號標籤在單一發話中改變語氣。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

由於端點使用 `方括號標籤` 標記，TomoriBot 會保留這些標籤，而不是在合成前將其移除。

## 設定

| 變數 | 預設值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro 檢查點目錄 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 已設定檢查點的模型存放庫與健康中繼資料標籤 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包裝器繫結位址；請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Fish 包裝器連接埠 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 內部 Fish API 連接埠 |
| `FISH_S2_COMPILE` | `0` | 啟用 Fish Speech 的 `torch.compile`（需要具備 Triton 的 Linux/WSL2） |
| `FISH_S2_HALF` | `0` | 請求 FP16 執行時期模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish 疊代提示詞區塊長度 |
| `FISH_S2_TOP_P` | `0.8` | 取樣 top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 取樣溫度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重複懲罰 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每個請求生成的語意 token 上限 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在 Fish 執行時期中快取編碼後的參考語音 |

### 安裝程式變數

由 `install-fishs2.sh` 與 `install-fishs2.ps1` 讀取。請記錄你覆寫的任何值，以確保部署可以重現。

| 變數 | 預設值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下載的 Hugging Face 存放庫 |
| `FISH_S2_MODEL_REVISION` | `main` | 要下載的 Hugging Face 修訂版本 |

參考音訊必須為非空、未壓縮的 PCM RIFF/WAVE 檔案，解碼後不超過 10 MB。此限制會在推論前檢查，以防止過大的 base64 請求消耗無限記憶體；以 TomoriBot 發送的 22.05 kHz 單聲道 WAV 而言，約可容納 237 秒。

## 低 VRAM 選項（INT8 量化）

在 VRAM 受限（例如 8 到 12 GB）且無法容納官方 BF16 檢查點的 GPU 上執行的使用者，可以選用 INT8 量化模型（`Imagilux/fishaudio-s2-pro`）。

安裝並執行 INT8 檢查點：

```bash
# 在 Linux / WSL2 中：
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# 在 Windows PowerShell 中：
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

從相同的 shell 啟動 `server.py`，或在啟動前設定相同的三個變數，讓包裝器載入 INT8 目錄而非預設的 BF16。

INT8 檢查點將 Transformer 權重從約 10.3 GB 縮減至約 5.1 GB，同時將音訊嵌入與編解碼器層保持在 BF16，可容納於約 10 GB 的總 VRAM 內。
