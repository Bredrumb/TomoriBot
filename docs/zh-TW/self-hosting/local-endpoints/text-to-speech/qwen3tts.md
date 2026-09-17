---
title: "Qwen3-TTS"
aiGenerated: false
---

使用 `servers/tts/qwen3tts/server.py` 可同時支援 Qwen3-TTS 12Hz 1.7B 的兩種模式，它是目前 TomoriBot 選項中體積較大但最準確的 TTS。它預設以自動模式啟動，會依每個請求的形狀選擇 Base 語音複製模型或 VoiceDesign 模型。

## 設定

請從 TomoriBot repo 的根目錄執行這些指令，也就是你複製 TomoriBot 的那個資料夾：

### 使用 Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### 使用 Linux/macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

預設的自動模式端點 URL 是 `http://127.0.0.1:8012`。你也可以明確指定自動模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自動模式會檢視每個 `/synthesize` 請求：帶 `ref_audio` 的請求使用複製模型，帶 `instruct` 的請求則使用 VoiceDesign 模型。它一次只保持一個模型載入，並在請求類型改變時切換模型，所以切換後的第一次請求可能會比較慢。

## 在 TomoriBot 中註冊

對大多數使用者而言，請註冊自動模式的伺服器，讓單一端點同時支援語音複製與 VoiceDesign 人格。

執行 `/providers`，選擇 **新增自訂端點**，並使用語音 API 相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

儲存連線之後，選取它並用它的模型下拉選單加入一個 Speech 模型。模型表單會
詢問 **語音來源模式** 與 **腳本標記風格**；自動模式的伺服器請選 `自動` 與 `純文字`。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用註冊好的端點。

## 設定人格語音

### 語音複製

用於應該模仿參考片段的人格：

1. 準備一段乾淨、10 到 20 秒、只有一位說話者且沒有背景音樂的語音片段。
2. 開啟 `/config`，在模型 > TTS 參數與語音 底下上傳該片段。
3. 開啟 `/config`，在人格 > 語音 底下選擇人格與語音樣本。

### VoiceDesign

用於應該使用文字語音描述而不是樣本的人格：

1. 開啟 `/config`，在人格 > 語音 底下選擇 VoiceDesign。
2. 選擇人格。
3. 輸入一段自然語言的語音提示詞，例如說話者的年齡、語氣、口音與表達方式。

要移除某個人格的 VoiceDesign 提示詞，請在 `/config` 的人格 > 語音 底下操作。生成期間，TomoriBot 會將儲存的提示詞以 `instruct` 放進 `/synthesize` 的 JSON 內容；來自工具的單次 `voice_instructions` 會附加在後面

自動模式會同時保留兩種設定。在 `/config` 的人格 > 語音 底下設定好的人格，會依它們的選擇使用複製合成或 VoiceDesign 合成。

## （選用）僅 VoiceDesign 的伺服器

在提供 `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` 時，以 VoiceDesign 模式啟動同一個伺服器。

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

你也可以傳入 `--mode voice-design` 取代設定 `TOMORI_TTS_MODE`。僅 VoiceDesign 的預設端點 URL 是 `http://127.0.0.1:8014`。

註冊方式與自動模式相同，但端點 URL 請用 `http://127.0.0.1:8014`，並在 Speech 模型上將 `VoiceDesign`
選為語音來源模式。
