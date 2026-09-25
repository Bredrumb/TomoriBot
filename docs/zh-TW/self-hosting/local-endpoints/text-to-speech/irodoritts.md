---
title: "IrodoriTTS"
---

Irodori-TTS v4.1 是以日語為主的 TTS 模型，在單一檢查點中同時具備語音複製與以說明文字為基礎的 VoiceDesign。TomoriBot 透過 `servers/tts/irodoritts/` 中的本機 FastAPI 包裝來運行它。

預設模型是 `Aratako/Irodori-TTS-v4.1-Small`。相容的 Hugging Face 檢查點可以用 `IRODORI_TTS_MODEL_ID` 選用，包括像 `phasefield-audio/Irodori-TTS-v4.1-Anime` 這樣的社群微調版本。

## 設定

Irodori 現在使用 `uv` 管理相依套件與 PyTorch 後端。請先安裝 `uv`，再從 TomoriBot repo 根目錄執行設定指令稿。

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

設定指令稿會建立 `servers/tts/irodoritts/.venv`，所以安裝之後 `bun run launch --irodoritts` 仍然可以運作。

可用的後端有：

- `cu128`：Windows 與 Linux 上的 NVIDIA CUDA 12.8
- `cpu`：僅 CPU，或 macOS 上透過 PyPI 使用 CPU 與 MPS
- `rocm`：Linux 與 WSL 上的 AMD ROCm
- `xpu`：Windows 與 Linux 上的 Intel XPU

預設的端點 URL 是 `http://127.0.0.1:8013`。

## 使用不同的檢查點

預設模型是 `Aratako/Irodori-TTS-v4.1-Small`。相容的 Hugging Face repository、社群微調版本（例如 `phasefield-audio/Irodori-TTS-v4.1-Anime`），或本機檢查點檔案，都可以透過環境變數設定。

啟動伺服器時（直接用 Python 或透過 `bun run launch --irodoritts`），它會自動讀取儲存庫根目錄的 `.env`（或 `servers/tts/irodoritts/` 中的本機 `.env`），並在啟動時記錄目前使用的模型 ID。

### 透過 `.env`（持續生效）

在 TomoriBot 根目錄的 `.env` 加入：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 透過環境變數逐次設定

在 Windows PowerShell：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

在 Linux Bash：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### 使用本機檢查點檔案

如果你已經把檢查點檔案（`.pt` 或 `.safetensors`）下載到本機，請將 `IRODORI_TTS_CHECKPOINT` 指向它的路徑：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

目前的 Irodori 會連同 Hugging Face repo 中綑綁的任何 tokenizer 資產一起下載檢查點。當模型 repo 提供 Hugging Face 子資料夾變體時，`IRODORI_TTS_MODEL_ID` 也支援它們。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `新增自訂端點`，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8013`

儲存連線之後，選取它並用它的模型下拉選單加入一個 Speech 模型。對 v4.1 而言，
建議的設定是：

- `Voice Source Mode`：`自動`
- `Script Markup Style`：`表情符號`

`自動` 讓同一個 Irodori 端點同時支援 TomoriBot 的兩種語音模式，讓情緒提示能撐過送出流程：

- 在人格 > 語音 底下指派了語音樣本的人格，會送出已儲存的參考片段進行語音複製。
- 在人格 > 語音 底下設定了 VoiceDesign 提示詞的人格，會送出已儲存的自然語言提示詞，
  作為 Irodori 的說明文字條件。

如果你只想要參考音訊的語音複製，仍然可以把 `Voice Clone` 選為語音來源模式。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，
選取並啟用註冊好的端點。

## 設定人格語音

### 語音複製

1. 準備一段乾淨、只有一位說話者且沒有背景音樂的日語語音片段。大約 30 秒就已經足夠：超過這個長度之後，多出的音訊對音色還原度幫助不大，卻會增加上傳大小與推論時間。
2. 開啟 `/config`，在模型 > TTS 參數與語音 底下上傳該片段。
3. 開啟 `/config`，在人格 > 語音 底下選擇人格與語音樣本。

Irodori v4.1 支援比舊的 v2 模型更長的參考條件，但乾淨的來源音訊仍然比單純的長度更重要。

v4.1 的執行階段會把參考片段限制在檢查點預設值，而 v4.1 檢查點將這個值設為 120 秒。超過上限的音訊會被截斷，而不是被拒絕，`IRODORI_MAX_REF_SECONDS` 可以覆寫這個上限。因此，位於 TomoriBot 130 秒上傳上限的片段仍然可用：Irodori 會以其中的前 120 秒作為條件。

在這裡，越長並不代表越好。上游指出，大約 30 秒的乾淨參考語音就已經能取得大部分可測量的說話者相似度提升，而且同一位說話者的多段較短片段會勝過一段長錄音。片段越長，伴隨的參考 latent 步驟也越多，會讓每次合成請求都更久。只有在說話者的音色在整段錄音中變動時，才需要超過 30 秒。

### VoiceDesign

1. 開啟 `/config`，在人格 > 語音 底下。
2. 選擇人格。
3. 輸入一段自然語言描述，說明你想要的聲音與表達方式。

TomoriBot 會將這個提示詞以 `instruct` 送出；Irodori 的包裝會將它對應到 v4.1 的 `caption` 條件。VoiceDesign 請求不需要已儲存的參考片段。

TomoriBot 會在把文字送給 TTS 之前移除 Discord 自訂表情符號語法。使用 `script_markup: emoji` 時，Unicode 表情符號會被保留，供 Irodori 的文字條件使用。

### Emoji 風格控制

IrodoriTTS 支援在輸入文字中插入 emoji 標註，以影響音效、說話方式與情緒表達。當 TomoriBot 的 `Script Markup Style` 設定為 `Emoji` 時，這些 Unicode emoji 會被保留並傳送給 Irodori。

| Emoji | 含義 / 情緒 / 風格 |
| --- | --- |
| 👂 | 耳語、貼近耳邊的聲音 |
| 😮‍💨 | 呼吸、嘆氣、睡眠時的呼吸聲 |
| ⏸️ | 停頓、靜默 |
| 🤭 | 輕笑、咯咯笑、忍笑 |
| 🥵 | 喘息、呻吟、低哼 |
| 📢 | 回聲、殘響 |
| 😏 | 調侃、撒嬌 / 哄勸 |
| 🥺 | 聲音顫抖、膽怯 / 不確定 |
| 🌬️ | 氣短、粗重呼吸、呼吸聲 |
| 😮 | 倒吸一口氣 |
| 👅 | 舔舐聲、咀嚼聲、水聲 |
| 💋 | 咂嘴聲 / 唇音 |
| 🫶 | 溫柔、柔和 |
| 😭 | 嗚咽、哭泣、悲傷 |
| 😱 | 尖叫、喊叫、驚叫 |
| 😪 | 睏倦、慵懶 |
| 😴 | 夢話、打鼾 |
| ⏩ | 快速說話、連珠炮式、匆忙 |
| 📞 | 電話或揚聲器傳出的聲音 |
| 🐢 | 緩慢 |
| 🥤 | 吞嚥聲 |
| 🤧 | 咳嗽、吸鼻子、打噴嚏、清嗓 |
| 😒 | 嘖舌 |
| 😰 | 慌張、激動、緊張、口吃 |
| 😆 | 開心、喜悅 |
| 💥 | 有衝勁、用力 |
| 😠 | 生氣、不滿、鬧彆扭 |
| 😲 | 驚訝、讚嘆 / 感嘆 |
| 🥱 | 打哈欠 |
| 😖 | 痛苦、難受 |
| 😟 | 焦慮、擔心 |
| 🫣 | 害羞、靦腆 |
| 🙄 | 無奈、翻白眼 |
| 😊 | 愉快、高興 |
| 😎 | 自信、得意 |
| 👌 | 附和、表示同意的聲音 |
| 🙏 | 懇求、哀求 |
| 🥴 | 醉酒狀態 |
| 🎵 | 哼唱 |
| 🤐 | 被摀住嘴時的悶聲 |
| 😌 | 放鬆、滿足 |
| 🤔 | 疑問語氣、思索 |
| 💪 | 用力、強勁 |
| 👃 | 嗅聞聲 |
| 📖 | 旁白、獨白 |

重複同一個 emoji 可以增強效果。Emoji 控制並不完全一致，因此更適合作為風格提示，而不是保證得到某種輸出。完整的上游清單與後續更新請參閱 [IrodoriTTS 官方 emoji 標註](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md)。

## 用 Sway Sampling 加快推論

預設仍然是 Irodori 品質較高的 40 步線性取樣。若想降低延遲，可以試試步數更少的 Sway Sampling：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

這是推論品質與速度之間的取捨，所以請先用你選定的檢查點與聲音測試過，再將它變成永久設定。

## 為什麼安裝指令稿現在更簡單

先前的 TomoriBot 安裝程式會複製並修補 Irodori 的 `pyproject.toml`、手動安裝 `dacvae`，並釘住一個 v2 時代的舊 Irodori 提交。那些變通做法對較舊的上游套件配置是必要的，但對目前的 Irodori 已經不再合適。

這個伺服器現在有自己的 `pyproject.toml`，並遵循上游的 `uv` 後端設定。Irodori 與 `dacvae` 在那裡仍然釘住已知的提交以確保安裝可重現，但 TomoriBot 不再於安裝期間修改上游原始碼。

## 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face 模型 repo，或支援的 repo 與子資料夾來源 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 選用的本機 `.pt` 或 `.safetensors` 檢查點；會覆寫 Hugging Face 模型 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 伺服器綁定位址; 請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 伺服器連接埠 |
| `IRODORI_MODEL_DEVICE` | `auto` | 模型裝置（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 編解碼器裝置 |
| `IRODORI_MODEL_PRECISION` | CUDA 上為 `bf16`，其餘為 `fp32` | 模型精確度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 編解碼器精確度 |
| `IRODORI_COMPILE_MODEL` | `false` | 為 Irodori 模型啟用 `torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 編譯時啟用動態形狀 |
| `IRODORI_NUM_STEPS` | `40` | Euler 取樣步數 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 取樣排程（`linear` 或 `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用 `sway` 排程時的 Sway 係數 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文字引導強度 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 說明文字與 VoiceDesign 的引導強度 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 參考說話者的引導強度 |
| `IRODORI_MAX_REF_SECONDS` | 檢查點預設 | 參考音訊時長的選用上限 |
