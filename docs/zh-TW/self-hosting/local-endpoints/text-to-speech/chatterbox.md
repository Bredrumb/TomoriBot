---
title: "Chatterbox TTS"
---

使用 `servers/tts/chatterbox/server.py` 進行帶支援事件標籤的英文語音複製。快速模型路徑預設為 Chatterbox-Turbo（350M 參數）。Chatterbox-Nano（110M 參數）可以為較小、偏向 CPU 的部署選用。這個包裝不會載入 Chatterbox Multilingual V3。

## 設定

請從 TomoriBot repo 的根目錄執行這些指令，也就是你複製 TomoriBot 的那個資料夾：

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

在 TomoriBot 使用 Chatterbox 期間請保持那個終端機開著。預設的端點 URL 是 `http://127.0.0.1:8011`；若要使用其他連接埠，請設定 `CHATTERBOX_PORT`。

### 選用：使用 Chatterbox-Nano

Nano 需要帶有 `nano=True` 載入器選項的 Chatterbox 版本。完成上面的正常設定之後，在同一個虛擬環境中安裝釘住的上游修訂版。該提交雜湊固定了相容的原始碼版本，它不是安全性的保證。這個指令需要 `git`，並保留已經安裝的執行階段相依套件：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

接著在啟動包裝之前設定 `CHATTERBOX_FAST_MODEL=nano`。要使用 Turbo 就讓該變數保持未設定。在 Windows PowerShell 上用 `$env:CHATTERBOX_FAST_MODEL = "nano"` 設定；在 Linux 或 macOS 上，使用 `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health` 回應會回報 `fast_model`，讓你可以確認實際載入的選擇。Nano 與 Turbo 使用相同的複製請求與支援的事件標籤。兩者都只支援英文。

要使用 Nano 或 Turbo，`/config` 的快速模型開關必須維持啟用。停用它會改選標準的 Chatterbox 0.5B 模型，以進行 CFG 權重與誇張程度調校。

### 標準 Chatterbox（0.5B，含 CFG 與誇張程度）

原本的 0.5B 基礎 Chatterbox 模型（`ChatterboxTTS`）直接內建在伺服器包裝中。它用 **Classifier-Free Guidance（`cfg_weight`）** 與情緒 **`exaggeration`** 的精細聲音控制，換掉 Turbo 的行內方括號事件標籤。

要使用標準模型：
1. 照常啟動伺服器包裝。
2. 在 Discord 執行 `/config` > **模型** > **TTS 參數與語音**。
3. 將 **快速模型（Turbo）** 選項切換為 **OFF**。
4. 下一次生成時，包裝會延遲下載標準 0.5B 模型並載入記憶體。

這兩個值都是 **編輯參數** 表單中的文字欄位。它們隨時可以編輯，而頁面會註明它們在快速模型啟用時會被忽略：
- **`cfg_weight`**（預設 `0.5`）：調整合成音訊貼近參考節奏與聲音風格的程度。
- **`exaggeration`**（預設 `0.5`）：控制語氣的情緒強度與戲劇性起伏。

> [!NOTE]
> 標準 Chatterbox 不支援行內方括號事件標籤（例如 `[laughs]` 或 `[sigh]`）。當快速模型開關關閉時，TomoriBot 會自動從提示詞文字中移除方括號標籤。

## 在 TomoriBot 中註冊

請在端點標籤或模型名稱中包含 `Chatterbox`。TomoriBot 只靠那個名稱（或包含它的端點 URL）辨識 Chatterbox 端點，所以 Turbo 的標籤白名單、標準模型的標籤移除，以及 `/generate voice-message` 中的 Chatterbox 選項，都只有在它存在時才適用。

執行 `/providers`，選擇 **新增自訂端點**，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

儲存連線之後，選取它並用它的模型下拉選單加入一個 Speech 模型。將
`Voice Clone` 選為語音來源模式，並將 `Bracket Tags` 選為腳本標記風格，讓語氣標籤能撐過送出流程。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用註冊好的端點。

## 設定人格語音

1. 準備一段乾淨、10 秒、只有一位說話者且沒有背景音樂的語音片段。
2. 開啟 `/config`，在模型 > TTS 參數與語音 底下上傳該片段。
3. 開啟 `/config`，在人格 > 語音 底下選擇人格與語音樣本。

較長的片段對 Chatterbox 沒有幫助，但也不會被拒絕。它的執行階段會在做條件設定之前截斷參考音訊，所以超出這個窗的音訊會被上傳、儲存，然後被忽略（[`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py)、[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)）：

- 聲學提示在所有變體上都是最前面的 10 秒。
- 語音 token 上下文在 Turbo 與 Nano 上是前 15 秒，在 Standard 上是前 6 秒。

這些窗是上游執行階段中的常數，而不是對外公布的指引：儲存庫的 README 沒有提供參考片段的長度，範例檔名也只有 `your_10s_ref_clip.wav`。執行階段真正強制的長度只有下限，也就是要求提示長於 5 秒。

因此，10 秒是實際的目標。這個長度會填滿聲學提示，音色與語氣就是在這裡決定的，而介於 10 到 15 秒的片段只會在 Turbo 與 Nano 上增加語音 token 上下文。說話者嵌入仍會從整段片段計算，所以拉長不會改變說話者身分，只會改變有多少提示在未被讀取的情況下被丟棄。

當快速模型開關啟用時，Turbo 與 Nano 可以使用 `[laugh]` 與 `[sigh]` 這類方括號事件標籤。

## 選用調校

使用 `/config`，在模型 > TTS 參數與語音 底下調校 Chatterbox 的請求內容：

- 快速模型開關預設為啟用。TomoriBot 會保留支援的 Turbo 與 Nano 事件標籤，並在包裝呼叫 `ChatterboxTurboTTS.generate(...)` 之前移除不支援的方括號描述詞。
- `cfg_weight` 預設為 `0.5`。最小值是 `0`；TomoriBot 沒有設定硬性上限。它只在 `turbo` 為 `false` 時生效；較低的值可以幫助放慢過快的參考語音，較高的值則會更強烈地跟隨參考。
- `exaggeration` 預設為 `0.5`。最小值是 `0`；TomoriBot 沒有設定硬性上限。它只在 `turbo` 為 `false` 時生效；較高的值會讓語氣更有表情或更戲劇化，並可能加快語速。

支援的 Turbo 與 Nano 事件標籤是 `[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]` 與 `[laugh]`。像 `[excited]`、`[whisper]` 或 `[smiles]` 這類不支援的描述詞會被移除，而不是送給 TTS。

當 `turbo` 停用時，TomoriBot 會先把所有方括號描述詞從文字中移除再送給 TTS，接著包裝會延遲載入標準的 `ChatterboxTTS` 模型並呼叫 `model.generate(..., cfg_weight, exaggeration)`。
