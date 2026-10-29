---
title: "Qwen3-TTS"
aiGenerated: true
---

使用 [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS)，在聲音複製與文字描述的 VoiceDesign 兩種模式下合成高度準確的多語言角色語音。

Qwen3-TTS 12Hz 1.7B 提供高精確度的本機語音合成。在預設的自動模式下執行 `servers/tts/qwen3tts/server.py`，會根據每個傳入的請求動態選取 Base 聲音複製模型或 VoiceDesign 模型。

## 設定

從 TomoriBot 存放庫根目錄（你複製 TomoriBot 的資料夾）執行這些指令：

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux 與 macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

預設的自動模式端點 URL 為 `http://127.0.0.1:8012`；設定 `QWEN3TTS_PORT` 可使用其他連接埠。你也可以明確指定自動模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自動模式會檢查每個 `/synthesize` 請求：帶有 `ref_audio` 的請求使用複製模型，而帶有 `instruct` 的請求使用 VoiceDesign 模型。它一次只會在記憶體中保留一個模型，並在請求類型變更時切換模型，因此切換後的第一次請求可能會較慢。

## 在 TomoriBot 中註冊

對於大多數使用者，請註冊自動模式伺服器，讓單一端點能同時支援聲音複製與 VoiceDesign 人格。

執行 `/providers`，選擇 `+ 新增自訂端點`，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

儲存連線後，選取它並使用其模型下拉選單新增 Speech 模型。模型表單會詢問 `語音來源模式` 與 `腳本標記風格`；自動模式伺服器請選擇 `自動` 與 `純文字`。

使用 `/providers` 進行端點註冊與模型設定。接著開啟 `/config` > 模型 > 切換模型 以選取並啟用已註冊的端點。

## 設定人格語音

### 聲音複製

適用於需要模仿參考音訊的人格：

1. 準備一段乾淨的 10 到 20 秒語音音訊，單一講者且無背景音樂。
2. 在 `/config` 的 模型 > TTS 參數與語音 底下上傳該音訊。
3. 在 `/config` 的 人格 > 語音 底下選擇人格與語音樣本。

Qwen3-TTS 支援短至 3 秒的參考音訊片段。

### VoiceDesign

適用於使用文字語音描述而非音訊樣本的人格：

1. 開啟 `/config` 底下的 人格 > 語音，並選擇 VoiceDesign。
2. 選擇人格。
3. 輸入自然語言語音提示詞，例如講者的年齡、語氣、口音與發音風格。

## 選用：僅限 VoiceDesign 伺服器

提供 `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` 服務時，可直接以 VoiceDesign 模式啟動同一個伺服器。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

你也可以傳入 `--mode voice-design` 代替設定 `TOMORI_TTS_MODE`。預設的僅限 VoiceDesign 端點 URL 為 `http://127.0.0.1:8014`。

註冊方式與自動模式相同，但端點 URL 請使用 `http://127.0.0.1:8014`，並在 Speech 模型上選擇 `VoiceDesign` 作為語音來源模式。
