---
title: "MOSS-TTS"
---

用 `servers/tts/moss/server.py`，透過單一本機端點試用 MOSS 的語音複製與以文字描述的語音設計。當 TomoriBot 送出 `ref_audio` 時，自動模式會選擇複製模型；送出 `instruct` 時則選擇 MOSS-VoiceGenerator。它一次只保持一個模型載入。這是試用性質的 sidecar，不是串流的 Discord 語音通話整合。

預設的複製模型是 [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5)（4B），選它是因為它是 16 GB GPU 的實務起點。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) 是 8B 的替代方案，但在 BF16 下通常需要超過 16 GB 的 VRAM。語音設計使用 [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)（約 1.7B）。自動模式會切換模型，而不是把兩個都留在 VRAM，所以切換模式仍然會有一段 GPU 載入延遲。

## 設定

請從 TomoriBot 儲存庫根目錄執行。使用 Python 3.12 與可相容於上游 CUDA 12.8 PyTorch wheel 的 CUDA 驅動程式。上游的 runtime extra 會釘住 PyTorch 與 Torchaudio 2.9.1+cu128；請讓這個 sidecar 待在自己的虛擬環境中。其他 CUDA 或 CPU 堆疊需要另行驗證過的安裝。

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

prefetch 指令會在伺服器啟動之前，把複製模型、VoiceGenerator 與每個模型各自的音訊 tokenizer 下載到 Hugging Face 快取。它會在每次下載 repository 之前檢查快取磁碟區可用空間並重複使用已快取的檔案，但兩個模型都需要相當大的空間。如果檢查失敗，請清出空間，或在 shell 中把 `HF_HOME` 設到較大的磁碟區，再進行 prefetch 與啟動伺服器。變更任何一個模型 ID 之後請重新執行 prefetch。若只想為有限度的試用下載其中一個模式，請傳入 `--mode clone` 或 `--mode voice-design`；另一個模式仍然可能在第一次使用時下載。

端點是 `http://127.0.0.1:8018`，`bun run launch --moss` 會把伺服器和 TomoriBot 一起啟動。自動模式會在回報啟動完成之前，先從本機快取預熱複製模型。如果沒有預先抓取複製模型，啟動會失敗，而不是意外地下載它。`MOSS_TTS_WARM_MODE=voice-design` 改為預熱 VoiceGenerator；`MOSS_TTS_WARM_MODE=none` 維持先前的延遲啟動。同一時間只有一個模式留在 GPU 記憶體中。用 `GET /health` 查看 `warm_mode`、`active_mode` 與 `model_id`。包裝使用 Hugging Face 的 `trust_remote_code=True`，所以請只從你信任的來源安裝，並在更新之前檢視上游變更。

## 在 TomoriBot 中註冊

在 `/providers` 中選擇 **新增自訂端點**，將 API 相容性設為 `tts-clone`，並使用端點 URL `http://127.0.0.1:8018`。加入一個 Speech 模型，**語音來源模式** 設為 `自動`，**腳本標記風格** 設為 `純文字`。接著在 `/config` > 模型 > 切換模型 底下啟用它。

若要複製，請在 `/config` > 模型 > TTS 參數與語音 底下上傳一段乾淨的參考片段，並在人格 > 語音 底下指派它。MOSS-TTS 的上游並未記載建議的參考長度，其執行環境也沒有長度上限，因此片段長度由你自己調整；較短而乾淨的片段仍然是較安全的預設值。若要語音設計，改為在人格 > 語音 底下儲存一段自然語言的語音描述。MOSS-TTS 使用音訊參考；它不使用 TomoriBot 選填的參考逐字稿。MOSS-VoiceGenerator 的文件涵蓋英文與中文，不含日文。4B 複製模型支援日文，但帶上已知的語言標記能改善多語言合成。

TomoriBot 目前的複製轉接器不送出語言標記。若要做單一語言試用，請在啟動伺服器之前設定 `MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或 `English`、`Chinese` 等）。手動的 `/synthesize` 請求則可以逐請求提供 `language`。混合語言使用時請讓該變數保持未設定；在依賴日文輸出之前請先評估它。

sidecar 會讀取自己的行程環境。把值加進 bot 的 `.env` 並不會自動傳給另外啟動的 Python 行程。

若要在記憶體足夠的機器上試用 8B 旗艦模型，請在 prefetch 之前設定 `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE` 與 `MOSS_TTS_MAX_NEW_TOKENS` 也都可以在 `.env.optional.example` 中設定。bot 的 `TTS_SYNTHESIZE_TIMEOUT_MS` 在切換模式或 CPU 推論時可能需要調高。
