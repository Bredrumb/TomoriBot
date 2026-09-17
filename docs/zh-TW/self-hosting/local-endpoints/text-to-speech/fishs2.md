---
title: "Fish Audio S2 Pro"
aiGenerated: false
---

Fish Audio S2 Pro 是多語言的 4B TTS 模型，專注於高保真度的語音複製與有表情的語氣。TomoriBot 透過 `servers/tts/fishs2/` 中的本機包裝來使用它。

TomoriBot 的預設設定使用官方 BF16 權重（`fishaudio/s2-pro`），以提供最高的合成保真度並避免量化不相容。對記憶體受限的消費級 GPU 使用者，可以透過環境變數覆寫來選用僅權重的 INT8 量化（`Imagilux/fishaudio-s2-pro`）。

Fish S2 Pro 支援 `[whisper]`、`[excited]`、`[angry]` 這類方括號表情標籤。請以 **方括號標籤** 標記設定端點，讓 TomoriBot 在生成的語音腳本中保留這些控制。

## 授權條款

Fish Speech 的程式碼與 S2 Pro 模型權重依 Fish Audio Research License 散布。依其條款允許研究與非商業使用；商業使用需要另外取得 Fish Audio 授權。

TomoriBot 不重新散布模型權重。每位自架使用者都直接從 Hugging Face 下載 Fish S2 Pro，並自行負責遵守 Fish Audio Research License。必要的標示是：**Built with Fish Audio**。

## 硬體與作業系統

> [!IMPORTANT]
> **Fish Speech 請使用 Linux 或 WSL2：** Fish Audio 官方以 Linux 與 WSL2 為目標。Fish S2 Pro 使用雙自迴歸（Dual-AR）架構（36 層慢速 transformer 加 10 次快速 codebook 傳遞，等於每個 token 有 76 次層評估）。在 Linux 上，OpenAI Triton 可以將這個巢狀迴圈編譯成融合的 GPU kernel（`torch.compile(backend="inductor")`），上游的基準測試顯示這能在 Linux 伺服器 GPU 上實現即時合成。包裝預設關閉編譯，請設定 `FISH_S2_COMPILE=1` 來使用它。
>
> 在原生 Windows 上，Triton 不受支援，迫使 PyTorch 進入未編譯的 eager 模式，透過 Windows WDDM 驅動程式產生超過 120,000 次循序的 CUDA kernel 派送。這會造成嚴重的派送停滯，讓完全相同的片段生成速度降到 **約 8 到 10 分鐘**（每秒音訊約需 65 秒運算）。為了可用的推論，**請在 Linux 或 WSL2 中運行 Fish S2 Pro**。

建議的硬體：

- **Linux 或 WSL2（強烈建議）**
- 具備 **16 GB 到 24 GB VRAM** 的 NVIDIA GPU（BF16 搭配 KV 快取與卸載，可以舒適地塞進約 16 到 18 GB VRAM）
- 建議使用 Python 3.12
- `git`、`ffmpeg`，以及 Fish Speech 所需的標準音訊函式庫

## 設定

### Linux 與 WSL2（推薦）

從 TomoriBot 儲存庫根目錄：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安裝程式會：

1. 將 `Imagilux/fish-speech` 複製到 `servers/tts/fishs2/fish-speech/`，並簽出釘住的執行環境提交；
2. 建立隔離的 `.venv`；
3. 安裝 Fish Speech 加上 TomoriBot 包裝的相依套件；以及
4. 將官方 BF16 的 `fishaudio/s2-pro` 檢查點下載到 `fish-speech/checkpoints/fish-speech-s2-pro/`。

正常的重新安裝會維持在釘住的執行環境提交 `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f`，
而不是跟著移動的分支。模型修訂版預設為 `main`；當部署必須可重現時，請將 `FISH_S2_MODEL_REVISION` 釘住到
不可變的 Hugging Face 修訂版。安裝程式設定列在[安裝程式變數](#installer-variables)底下。

Hugging Face 模型有使用門檻。請先在 Hugging Face 接受它的授權。如果下載要求驗證，請執行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

接著重新執行安裝程式。

### Windows PowerShell（僅盡量支援）

原生 Windows 只提供作為評估用途。由於未編譯 eager 模式下的驅動程式派送延遲，生成會極慢（每個片段約 8 到 10 分鐘）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

PowerShell 安裝程式預設以 CUDA GPU 加速（`cu124`）為目標。若要在沒有 NVIDIA GPU 的純 CPU 機器上安裝，請傳入 `-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

如果 Windows 上的 PyTorch 需要手動安裝或更新 CUDA 支援，請執行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot 會在 `TTS_SYNTHESIZE_TIMEOUT_MS`（預設 240000 ms）之後停止等待語音訊息，那比原生 Windows 生成一個片段所需的時間還短。在 Windows 上評估期間，請在 TomoriBot 的 `.env` 調高它（例如
`TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 必要的參考逐字稿

> [!WARNING]
> **語音複製必須提供 Reference Text（`ref_text`）：** Fish S2 Pro 的交叉注意力機制需要參考音訊的逐字稿，才能將語音 token 與聲學碼對齊。
>
> 如果你上傳語音樣本卻沒有提供對應的參考逐字稿，Fish Speech 會**默默丟棄參考音訊 token**，退回隨機的零參考語音。TomoriBot 的 Fish 包裝會驗證並以 `400 Bad Request` 拒絕缺少參考文字的合成請求，以避免意外的無條件生成。

在 `/config` 的 **模型 > TTS 參數與語音** 底下加入人格語音時，請務必在 **參考逐字稿** 欄位填入參考音訊片段中所說的逐字文字。

## 在 TomoriBot 中註冊

在 `/providers` 中選擇 **新增自訂端點**，並設定：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8015`
- Voice Source Mode：`Clone`
- Script Markup：`Bracket Tags`
- API key：預設的回送設定請留空。如果啟用了 bearer 驗證，請輸入確切的 `FISH_S2_API_KEY` 值。

接著加入該端點的模型項目，並透過 `/config` 的 模型 > 切換模型 啟用它。

## 加入人格語音

1. 準備一段乾淨、10 到 20 秒、只有一位說話者且背景噪音很少或沒有的參考片段。
2. 在 `/config` 中開啟 模型 > TTS 參數與語音 並上傳語音樣本。
3. **輸入確切的逐字稿**，也就是參考片段中所說的文字，放進參考文字欄位。
4. 在 `/config` 中開啟 人格 > 語音，並將樣本指派給人格。
5. 用 `/generate voice-message` 生成語音訊息，或讓 TomoriBot 透過它的語音訊息工具生成。

## 表情控制

Fish S2 Pro 可以用方括號標籤在同一段語句中改變語氣。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

因為端點使用 `Bracket Tags` 標記，TomoriBot 會保留這些標籤，而不是在合成前移除它們。

## 設定

| 變數 | 預設 | 用途 |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Fish Speech 執行環境目錄 |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro 檢查點目錄 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 已設定檢查點的模型 repository 與健康狀態中繼資料標籤 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | TomoriBot 包裝綁定位址 |
| `FISH_S2_PORT` | `8015` | Fish 包裝連接埠；未設定時退回 `TOMORI_TTS_PORT` |
| `TOMORI_TTS_PORT` | 未設定 | 向後相容的共用連接埠覆寫 |
| `FISH_S2_API_KEY` | 未設定 | 選用的 bearer token，需要驗證的遠端綁定也必須提供 |
| `TOMORI_TTS_API_KEY` | 未設定 | `FISH_S2_API_KEY` 未設定時的共用 bearer token 備援 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | 明確允許在沒有 bearer token 的情況下使用非回送位址綁定 |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | 解碼後參考 WAV 大小上限 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | 未設定 | 共用解碼後參考音訊上限的備援 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | 內部 Fish API 綁定位址 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 內部 Fish API 連接埠 |
| `FISH_S2_COMPILE` | `0` | 啟用 Fish Speech 的 `torch.compile`（需要帶 Triton 的 Linux 或 WSL2） |
| `FISH_S2_HALF` | `0` | 要求 FP16 執行階段模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish 迭代提示詞的區塊長度 |
| `FISH_S2_TOP_P` | `0.8` | 取樣的 top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 取樣溫度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重複懲罰 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每個請求生成的語意 token 上限 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在 Fish 執行環境中快取編碼後的參考語音 |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | 包裝接受的腳本長度上限 |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | 等待巢狀 Fish API 的最長時間 |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | 等待單一上游合成請求的最長時間 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | `bun run launch --fishs2` 等待包裝健康檢查的時間 |

### 安裝程式變數

由 `install-fishs2.sh` 與 `install-fishs2.ps1` 讀取。請記錄你覆寫的任何值，讓部署可以重現。

| 變數 | 預設 | 用途 |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Fish Speech 執行環境 repository，例如已審閱的鏡像 |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | 安裝時簽出的執行環境提交 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下載的 Hugging Face repository |
| `FISH_S2_MODEL_REVISION` | `main` | 要下載的 Hugging Face 修訂版 |
| `FISH_S2_UPDATE` | `0` | 設為 `1` 以刻意更新執行環境並重新下載模型 |
| `FISH_S2_UPDATE_REF` | 未設定 | 更新時使用的執行環境 ref。沒有它時，會保留明確的 `FISH_S2_RUNTIME_REF`；否則更新使用 `main` |
| `FISH_S2_UPDATE_MODEL_REVISION` | 未設定 | 更新時使用的模型修訂版，優先順序與 `FISH_S2_UPDATE_REF` 相同 |

參考音訊必須是非空、未壓縮的 PCM RIFF 或 WAVE 檔。解碼後的大小限制會在推論之前檢查，以避免過大的 base64 請求耗用無上限的記憶體。

## 低 VRAM 選項（INT8 量化）

在 VRAM 受限的 GPU 上（例如 8 到 12 GB）、無法塞進官方 BF16 檢查點的使用者，可以選擇 INT8 量化模型（`Imagilux/fishaudio-s2-pro`）。

要安裝並運行 INT8 檢查點：

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

請從同一個 shell 啟動 `server.py`，或在啟動之前設定同樣的三個變數，讓包裝載入 INT8 目錄而不是預設的 BF16。

INT8 檢查點會把 transformer 權重從約 10.3 GB 降到約 5.1 GB，同時讓音訊嵌入與編解碼層維持 BF16，整體塞進約 10 GB 的 VRAM。
