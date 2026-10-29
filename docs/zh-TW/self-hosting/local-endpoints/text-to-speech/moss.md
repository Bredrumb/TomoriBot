---
title: "MOSS-TTS"
aiGenerated: true
---

使用 [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS)，透過統一的語音端點在本機評估聲音複製與自然語言語音設計。

預設的 4B 複製模型與 1.7B VoiceGenerator 會在語音模式變更時於 GPU 記憶體中切換，因此切換後的第一次請求需要較長時間。8B 複製模型則需要更多 VRAM。

## 設定

在 TomoriBot 存放庫根目錄使用 Python 3.12 與相容於 CUDA 12.8 的驅動程式執行指令：

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux 或 WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

預先擷取（prefetch）指令會在啟動伺服器之前，將複製模型、VoiceGenerator 與音訊 tokenizer 下載至你的 Hugging Face 快取中。若磁碟空間有限，請將 `HF_HOME` 設定至較大的分割區。若只需下載單一模型，請傳入 `--mode clone` 或 `--mode voice-design`。

預設端點為 `http://127.0.0.1:8018`。執行 `bun run launch --moss` 可在啟動 TomoriBot 的同時啟動伺服器。自動模式會從本機快取預熱複製模型。設定 `MOSS_TTS_WARM_MODE=voice-design` 可改為預熱 VoiceGenerator，或設定 `MOSS_TTS_WARM_MODE=none` 進行延遲初始化。可查看 `GET /health` 確認目前的 `warm_mode`、`active_mode` 與 `model_id`。包裝器使用 Hugging Face 的 `trust_remote_code=True`，因此更新前請檢視上游程式碼。

## 在 TomoriBot 中註冊

在 `/providers` 中，選擇 `+ 新增自訂端點`，將 API 相容性設定為 `tts-clone`，並使用端點 URL `http://127.0.0.1:8018`。新增一個 Speech 模型，將 `語音來源模式` 設定為 `自動`，`腳本標記風格` 設定為 `純文字`。在 `/config` > 模型 > 切換模型 底下啟用它。

對於聲音複製，請在 `/config` > 模型 > TTS 參數與語音 底下上傳乾淨的參考音訊，並在 人格 > 語音 底下進行指派。較短且乾淨的音訊片段可產生最一致的結果。對於語音設計，請在 人格 > 語音 底下儲存自然語言描述。請注意 MOSS-VoiceGenerator 是專為英語與中文設計的。雖然 4B 複製模型支援日語，但明確指定語言標籤可提升合成清晰度。

TomoriBot 的複製轉接器不會自動發送語言標籤。對於單一語言使用情境，請在啟動伺服器前設定 `MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或 `English`、`Chinese` 等）。手動 `/synthesize` 呼叫可以直接傳遞 `language`。

伺服器會讀取自己的 shell 環境；bot 的 `.env` 中的設定不適用於獨立啟動的 Python 終端機。

若要在高記憶體硬體上執行 8B 模型，請在預先擷取前設定 `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE` 與 `MOSS_TTS_MAX_NEW_TOKENS` 可在 `.env.optional.example` 中設定。若模型切換或 CPU 執行導致逾時，請調高 TomoriBot 中的 `TTS_SYNTHESIZE_TIMEOUT_MS`。
