---
title: "Chatterbox TTS"
aiGenerated: true
---

使用本機 [Chatterbox](https://github.com/resemble-ai/chatterbox) 文字轉語音伺服器，複製帶有情緒標籤的英語語音。

Chatterbox 透過 `servers/tts/chatterbox/server.py` 在本機執行。它預設使用快速的 Chatterbox-Turbo 模型（350M 參數），支援行內情緒事件標籤，例如 `[laugh]` 與 `[sigh]`。你也可以為 CPU 環境設定輕量級的 Chatterbox-Nano 模型（110M 參數），或為無分類器引導（classifier-free guidance，`cfg_weight`）與情緒誇張度（`exaggeration`）微調設定標準 0.5B 模型。此包裝器不載入 Chatterbox Multilingual V3。

## 設定

從 TomoriBot 存放庫根目錄（你複製 TomoriBot 的資料夾）執行這些指令：

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

當 TomoriBot 使用 Chatterbox 時，請保持該終端機開啟。預設端點 URL 為 `http://127.0.0.1:8011`；設定 `CHATTERBOX_PORT` 可使用其他連接埠。

### 選用：使用 Chatterbox-Nano

Nano 需要具備 `nano=True` 載入器選項的 Chatterbox 組建。在完成上述常規設定後，於同一個虛擬環境中安裝固定的上游修訂版本。提交雜湊值固定了相容的原始碼版本；這不是安全性保證。此指令需要 `git` 並會保留已安裝的執行時期相依套件：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

接著在啟動包裝器之前設定 `CHATTERBOX_FAST_MODEL=nano`。Turbo 則保持該變數未設定。在 Windows PowerShell 上，使用 `$env:CHATTERBOX_FAST_MODEL = "nano"` 設定；在 Linux 或 macOS 上，使用 `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health` 回應會回報 `fast_model`，以便你驗證載入的選擇。Nano 與 Turbo 使用相同的複製請求與支援的事件標籤。兩者皆僅支援英語。

`/config` 中的快速模型開關必須保持啟用才能使用 Nano 或 Turbo。停用它會選取標準 Chatterbox 0.5B 模型以進行 CFG 權重與誇張度微調。

### 標準 Chatterbox

若要使用 Standard 模型，請在 `/config` > 模型 > TTS 參數與語音 底下停用 `快速模型（Turbo）`。Standard 支援 `cfg_weight` 與 `exaggeration` 微調，但不支援括號事件標籤。

## 在 TomoriBot 中註冊

請在端點標籤或模型名稱中包含 `Chatterbox`。TomoriBot 僅依據該名稱（或包含該名稱的端點 URL）辨識 Chatterbox 端點，因此 Turbo 標籤白名單、標準模型的標籤移除以及 `/generate voice-message` 中的 Chatterbox 選項僅在該名稱存在時才會套用。

執行 `/providers`，選擇 `+ 新增自訂端點`，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

儲存連線後，選取它並從模型下拉選單中選擇 `+ 新增 Speech 模型`。將 `語音來源模式` 選擇為 `聲音複製`，`腳本標記風格` 選擇為 `方括號標籤`，讓語氣標籤能在發送時保留。

使用 `/providers` 進行端點註冊與模型設定。接著開啟 `/config` > 模型 > 切換模型 以選取並啟用已註冊的端點。

## 設定人格語音

1. 準備一段乾淨的 10 秒語音音訊，單一講者且無背景音樂。
2. 在 `/config` 的 模型 > TTS 參數與語音 底下上傳該音訊。
3. 在 `/config` 的 人格 > 語音 底下選擇人格與語音樣本。

Chatterbox 需要超過 5 秒的音訊。建議以 10 秒為目標；模型僅會使用較長音訊的有限部分進行條件引導。

## 選用微調

在 `/config` > 模型 > TTS 參數與語音 底下，可為 Standard 模型調整 `cfg_weight` 與 `exaggeration`。兩者預設皆為 `0.5`；較高的值分別代表更緊密貼合參考音訊以及增加表現力。

支援的 Turbo/Nano 事件標籤為 `[clear throat]`、`[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` 與 `[laugh]`。不支援的描述詞（例如 `[excited]`、`[whisper]` 或 `[smiles]`）會被移除，而不會發送到 TTS。
