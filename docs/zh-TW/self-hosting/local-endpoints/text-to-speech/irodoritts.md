---
title: "IrodoriTTS"
aiGenerated: true
---

使用 [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS)，透過聲音複製、以說明文字為基礎的 VoiceDesign 與富有表現力的表情符號標記產生自然的日語語音。

Irodori-TTS v4.1 是一個專注於日語的文字轉語音模型，支援在單一檢查點內同時進行聲音複製與以文字描述的 VoiceDesign。TomoriBot 透過 `servers/tts/irodoritts/` 中的本機 FastAPI 包裝器連接到 Irodori，預設為 `Aratako/Irodori-TTS-v4.1-Small`。

可透過 `IRODORI_TTS_MODEL_ID` 選取相容的 Hugging Face 檢查點，包含 `phasefield-audio/Irodori-TTS-v4.1-Anime` 等社群微調版本。

## 設定

Irodori 使用 `uv` 進行相依套件與 PyTorch 後端管理。伺服器維護自己的 `pyproject.toml`，並固定 Irodori 與 `dacvae` 相依套件以實現可重現的安裝。請先安裝 `uv`，接著從 TomoriBot 存放庫根目錄執行設定腳本：

### Windows PowerShell（NVIDIA）

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash（NVIDIA）

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

設定腳本會建立 `servers/tts/irodoritts/.venv`，因此安裝後 `bun run launch --irodoritts` 仍可正常運作。

可用後端：

- `cu128`：Windows 與 Linux 上的 NVIDIA CUDA 12.8
- `cpu`：僅 CPU，或透過 PyPI 的 macOS CPU/MPS
- `rocm`：Linux/WSL 上的 AMD ROCm
- `xpu`：Windows 與 Linux 上的 Intel XPU

預設端點 URL 為 `http://127.0.0.1:8013`。

## 使用不同的檢查點

預設模型為 `Aratako/Irodori-TTS-v4.1-Small`。你可透過環境變數選取其他官方檢查點（包含 3.29B 參數的大型模型及其量化變體）、社群微調版本或本機檢查點檔案。

### 檢查點與變體

| 模型 / `IRODORI_TTS_MODEL_ID` | 參數量 | 檢查點大小 | 建議 VRAM | 說明 |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4 到 6 GB | 預設模型：推論快速且記憶體佔用低。 |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10 到 14 GB | 完整未量化大型模型，採用 T5Gemma 2 文字骨幹。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6 到 8 GB | FP8 權重搭配 BF16 活化值：推薦用於 NVIDIA Ada（RTX 40 系列）與更新架構。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6 到 8 GB | 通用 INT8 權重，在 NVIDIA CUDA 上使用 BF16 計算。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5 到 6 GB | 最小的 Large 變體：需要 NVIDIA Ampere（RTX 30 系列）或更新架構。 |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4 到 6 GB | 社群微調版本，適用於動漫風格語音表達。 |

對於聲音複製，Small 模型提供相似的品質與更快的推論速度。Large 模型則具備更強大的文字編碼器，能更緊密貼合 VoiceDesign 描述。

伺服器會讀取存放庫根目錄的 `.env` 或本機 `servers/tts/irodoritts/.env`。

### 透過 `.env`（持久生效）

在 TomoriBot 根目錄的 `.env` 中加入：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 透過各工作階段環境變數

在 Windows PowerShell 中：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

在 Linux Bash 中：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### 使用本機檢查點檔案

若你已在本機下載了檢查點檔案（`.pt` 或 `.safetensors`），請將 `IRODORI_TTS_CHECKPOINT` 設定為其路徑：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

目前的 Irodori 會將檢查點與 Hugging Face 存放庫中隨附的任何 tokenizer 資產一起下載。當模型存放庫提供 Hugging Face 子資料夾變體時，`IRODORI_TTS_MODEL_ID` 亦支援該類變體。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `+ 新增自訂端點`，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8013`

儲存連線後，選取它並使用其模型下拉選單新增 Speech 模型。對於 v4.1，建議的設定為：

- `語音來源模式`：`自動`
- `腳本標記風格`：`表情符號`

`自動` 讓同一個 Irodori 端點同時支援兩種 TomoriBot 語音模式，因此情緒提示能在發送時保留：

- 在 人格 > 語音 底下指派了語音樣本的人格會發送儲存的參考音訊以進行聲音複製。
- 在 人格 > 語音 底下設定了 VoiceDesign 提示詞的人格會將儲存的自然語言提示詞作為 Irodori 說明文字條件發送。

若你只需要參考音訊聲音複製，仍可選擇 `聲音複製` 作為語音來源模式。

使用 `/providers` 進行端點註冊與模型設定。接著開啟 `/config` > 模型 > 切換模型 以選取並啟用已註冊的端點。

## 設定人格語音

### 聲音複製

1. 準備一段乾淨的日語語音片段，單一講者且無背景音樂。大約 30 秒即已足夠：超過此長度的額外音訊對於音色保真度的提升微乎其微，反而會增加上傳大小與推論時間。
2. 在 `/config` 的 模型 > TTS 參數與語音 底下上傳該音訊。
3. 在 `/config` 的 人格 > 語音 底下選擇人格與語音樣本。

Irodori 預設使用 120 秒參考上限，並會裁切較長的音訊。設定 `IRODORI_MAX_REF_SECONDS` 可調整此限制。

### VoiceDesign

1. 開啟 `/config` 底下的 人格 > 語音。
2. 選擇人格。
3. 輸入所需語音與表達風格的自然語言描述。

TomoriBot 會將此提示詞作為 `instruct` 發送；Irodori 包裝器會將其對應至 v4.1 的 `caption` 條件。VoiceDesign 請求不需要儲存的參考音訊片段。

TomoriBot 在將文字發送到 TTS 之前會先清除 Discord 自訂表情符號語法。若設定為 `script_markup: emoji`，Unicode 表情符號會被保留用於 Irodori 的文字條件引導。

### 表情符號風格控制

IrodoriTTS 支援輸入文字中的表情符號註解以影響音效、說話風格與情緒表達。將 TomoriBot 的 `腳本標記風格` 設定為 `表情符號` 後，這些 Unicode 表情符號會被保留並發送到 Irodori。

支援的表情符號及其含意請參閱[上游表情符號註解](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md)。表情符號屬於風格提示，生成結果可能有所不同。

## 長語音訊息

長文字會被分割為多個區塊，並作為單一語音訊息傳回。較長的請求可能會超過預設的 240 秒逾時時間；如有需要請調整 `TTS_SYNTHESIZE_TIMEOUT_MS`。設定 `IRODORI_CHUNKING_ENABLED=false` 可停用分塊，或設定 `IRODORI_CHUNK_MIN_CHARS` 調整分割門檻值。

## 使用 Sway 取樣加快推論

預設仍為 Irodori 較高品質的 40 步線性取樣。若要降低延遲，可嘗試使用較少步數的 Sway 取樣：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

這是在推論品質與速度之間的權衡，因此在將其設為永久設定前，請先使用你所選的檢查點與語音進行測試。

## 環境變數

| 變數 | 預設值 | 用途 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face 模型存放庫或支援的存放庫/子資料夾來源 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 選用的本機 `.pt` 或 `.safetensors` 檢查點；覆寫 Hugging Face 模型 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 伺服器繫結位址；請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 伺服器連接埠 |
| `IRODORI_MODEL_DEVICE` | `auto` | 模型裝置（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 編解碼器裝置 |
| `IRODORI_MODEL_PRECISION` | CUDA 上為 `bf16`，否則為 `fp32` | 模型精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 編解碼器精度 |
| `IRODORI_COMPILE_MODEL` | `false` | 為 Irodori 模型啟用 `torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 編譯時啟用動態形狀 |
| `IRODORI_NUM_STEPS` | `40` | Euler 取樣步數 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 取樣排程（`linear` 或 `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用 `sway` 排程時的 Sway 係數 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文字引導縮放比例 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 說明文字 / VoiceDesign 引導縮放比例 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 參考講者引導縮放比例 |
| `IRODORI_MAX_REF_SECONDS` | 檢查點預設值 | 參考音訊長度的選用上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 在符合條件的標點符號邊界分割長文字並串接產生的區塊 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 強句子邊界分割前的最小非空白字元數；逗號為後備邊界，約為此值的 1.5 倍 |
