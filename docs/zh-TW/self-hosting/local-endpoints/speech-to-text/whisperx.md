---
title: "WhisperX 轉錄"
sidebar:
  order: 1
---

WhisperX 是推薦的、適合初學者的本機轉錄路徑。

## 設定

請從 TomoriBot repo 的根目錄執行這些指令，也就是你複製 TomoriBot 的那個資料夾。第一個指令會進入 STT 伺服器資料夾：

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

在 TomoriBot 使用 WhisperX 期間請保持那個終端機開著。預設的端點 URL 是 `http://127.0.0.1:8021`。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 **新增自訂端點**，並使用轉錄 API 相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

儲存連線之後，選取它並用它的模型下拉選單加入 `large-v3`，或 `WHISPERX_MODEL` 目前設定的值，作為 Transcription 模型。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用註冊好的端點。

## 使用逐字稿

註冊之後，TomoriBot 會在背景轉錄音訊附件，並將文字加入聊天脈絡。只有你也想讓逐字稿可見地張貼在聊天中時，才需要使用 `/config` > Engine > 通知。
