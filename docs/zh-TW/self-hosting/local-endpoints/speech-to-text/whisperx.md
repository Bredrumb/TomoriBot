---
title: "WhisperX 轉錄"
sidebar:
  order: 1
aiGenerated: true
---

使用隨附的 [WhisperX](https://github.com/m-bain/whisperX) 伺服器為 TomoriBot 設定準確的本機語音轉文字功能。WhisperX 提供具備字詞層級對齊的高速音訊轉錄。

## 設定

從 TomoriBot 存放庫根目錄執行以下指令：

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

當 TomoriBot 使用 WhisperX 時，請保持該終端機視窗開啟。預設端點 URL 為 `http://127.0.0.1:8021`。在 Windows 上，請使用 `127.0.0.1` 代替 `localhost`。

## 選擇模型

在啟動伺服器前設定 `WHISPERX_MODEL`。

| `WHISPERX_MODEL` | 大小 | 用途 |
|---|---|---|
| `large-v3` | 1.55B | 多語言準確度最佳；比 turbo 多約 0.6 GiB VRAM |
| `large-v3-turbo` | 809M | 多語言，解碼器更快；日語準確度略遜 |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | 僅支援日語；在日語測試片段上的準確度高於 turbo，速度相同 |

在簡短片段上以編碼器運算為主，因此這三者的執行速度差不多。請依語言與 VRAM 需求挑選。不建議使用 `small` 與 `base`，因為其日語準確度下降過多。在極短或接近無聲的片段上，Whisper 模型仍可能憑空捏造文字。

## GPU

伺服器會在有可用 NVIDIA GPU 時自動使用。請檢查 `http://127.0.0.1:8021/health`：`device` 應顯示為 `cuda`。在 Windows 上，語音辨識需要將 CUDA 12 的 cuBLAS 與 cuDNN DLL 放在 `PATH` 中。如果缺少這些檔案，伺服器在啟動時會輸出 `GPU found but unusable` 並改在 CPU 上執行，速度會慢很多：請安裝這些 DLL 並重新啟動伺服器。若設定了 `WHISPERX_DEVICE=cuda`，伺服器則會在啟動時直接停止。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `+ 新增自訂端點`，並使用轉錄 API 相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

儲存連線後，選取它並使用其模型下拉選單將 `WHISPERX_MODEL` 的確切值（預設為 `large-v3`，或是完整的存放庫 ID，如 `kotoba-tech/kotoba-whisper-v2.0-faster`）新增為 Transcription 模型。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用已註冊的端點。

## 使用逐字稿

註冊後，TomoriBot 會在背景轉錄音訊附件並將文字加入聊天脈絡。只有當你也希望在聊天室中公開張貼逐字稿時，才使用 `/config` > 行為 > 通知行為。
