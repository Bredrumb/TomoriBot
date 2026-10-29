---
title: "VoxCPM2"
aiGenerated: true
---

使用 OpenBMB 的 [VoxCPM2](https://github.com/OpenBMB/VoxCPM) 文字轉語音模型，合成跨 30 種語言的富有表現力的 48 kHz 語音。

VoxCPM2 是一個 2B 參數的多語言語音模型，支援聲音複製、逐字稿輔助的 Ultimate Cloning 與自然語言 Voice Design。TomoriBot 透過 `servers/tts/voxcpm2/` 中的伺服器連接至官方 `voxcpm` Python 函式庫，在 16 GB VRAM 內舒適執行官方未量化的 `openbmb/VoxCPM2` BF16 檢查點。

## 授權條款

VoxCPM2 程式碼與模型權重均在 Apache-2.0 授權條款下發布，包含遵循條款的商業用途。TomoriBot 不重新散布模型權重；安裝程式會直接從官方 Hugging Face 存放庫下載。

官方上游資源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 on Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM documentation](https://voxcpm.readthedocs.io/)

## 支援語言

VoxCPM2 官方支援 30 種語言且不需要指定語言標籤：

阿拉伯語、緬甸語、中文、丹麥語、荷蘭語、英語、芬蘭語、法語、德語、希臘語、希伯來語、印地語、印尼語、義大利語、日語、高棉語、韓語、寮語、馬來語、挪威語、波蘭語、葡萄牙語、俄語、西班牙語、史瓦希里語、瑞典語、他加祿語、泰語、土耳其語與越南語。

OpenBMB 亦記錄了多種中文方言。TomoriBot 仍可能為了符合通用的 TTS 協定而發送 `language` 欄位，但 VoxCPM2 會從合成文字中偵測語言，且包裝器不會強制加上語言標籤。

## 語音模式

聲音複製與語音設計請使用 `自動` 與 `純文字` 標記。參考逐字稿可啟用 Ultimate Cloning；發音風格指示具有較高優先權，且在該次請求中會省略逐字稿。

## 硬體與執行時期

建議起點規格：

- Python 3.10 到 3.12
- 官方 BF16 執行時期建議配備 8 GB VRAM 或以上的 NVIDIA GPU；12 到 16 GB 具備舒適的餘裕
- 最新的 NVIDIA 驅動程式以及支援 CUDA 的 PyTorch 組建以進行 GPU 加速
- 支援 CPU 作為備援，但速度大幅放緩

官方套件亦提供 CPU 與 Apple MPS 裝置選取。在 Windows 上的 TomoriBot 可以原生執行標準 Python 套件；不需要 WSL。Windows PowerShell 安裝程式預設會安裝支援 CUDA 的 PyTorch 組建（`cu124`）。

若要在純 CPU 機器上明確安裝，請傳入 `-Cpu` 參數：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

若你原生 Windows 的 PyTorch 安裝需要手動重新安裝或重新對齊驅動程式，請直接將支援 CUDA 的 PyTorch 組建安裝至伺服器的虛擬環境中：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## 安裝

伺服器固定目前的穩定版 `voxcpm` 2.0.3 套件，並將 `openbmb/VoxCPM2` 下載至一般的 Hugging Face 快取中。

### Linux 與 WSL Bash

從 TomoriBot 存放庫根目錄執行：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

從 TomoriBot 存放庫根目錄執行：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

首次設定會下載數 GB 的模型權重。若要僅安裝 Python 環境而不預先擷取模型，請設定 `VOXCPM2_PREFETCH=0`；官方函式庫會在伺服器首次啟動時下載檢查點。

Linux 與 WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

設定完成後，`bun run launch --voxcpm2` 可與 TomoriBot 一同啟動伺服器。預設端點為 `http://127.0.0.1:8016`。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `+ 新增自訂端點`，並設定 Speech 端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8016`
- 語音來源模式：`Auto`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線後，選取它並使用其模型下拉選單新增 Speech 模型。接著開啟 `/config` > 模型 > 切換模型 並選取 VoxCPM2 語音模型。

建議使用 `Auto`，因為同一伺服器支援參考音訊複製與 Voice Design。你不需要為兩種模式啟動各自獨立的 VoxCPM2 行程。

## 人格聲音複製

適用於需要複製既有講者的人格：

1. 準備一段乾淨的參考音訊，單一講者且背景音樂極少或無背景音樂。上游將 5 到 30 秒視為實用範圍。
2. 在 `/config` 的 模型 > TTS 參數與語音 底下上傳該音訊。
3. 若有對應的參考音訊逐字稿請一併加入。VoxCPM2 會將其用於 Ultimate Cloning，並能重現更多參考音訊的節奏、情緒與風格。
4. 在 `/config` 的 人格 > 語音 底下選擇人格並指派已儲存的樣本。

若未儲存逐字稿，VoxCPM2 仍會執行一般的參考音訊複製。

## 人格語音設計

適用於從書面語音描述而非音訊樣本建立的人格：

1. 開啟 `/config` 底下的 人格 > 語音，並選擇 VoiceDesign。
2. 選擇人格。
3. 輸入自然語言描述，例如 `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`。

對於已複製的語音，單次的發音風格指示優先於參考逐字稿。

## 環境變數

| 變數 | 預設值 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face 模型 ID 或本機模型目錄 |
| `VOXCPM2_DEVICE` | `auto` | 執行時期裝置：`auto`、`cuda`、`cuda:N`、`cpu` 或 `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 啟用官方執行時期的最佳化 / 編譯路徑 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 載入選用的上游降噪器；預設停用以節省記憶體 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引導強度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Flow-matching 推論步數；更多步數可提升品質，但會犧牲速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 最大生成長度 |
| `VOXCPM2_NORMALIZE` | `0` | 啟用上游文字正規化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 為異常生成啟用上游重試行為 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 最大自動重試次數 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游瑕疵案例長度門檻值 |
| `VOXCPM2_PREFETCH` | `1` | 僅安裝程式：設定時下載模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2 本機伺服器連接埠 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 本機伺服器繫結位址；請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |

參考音訊必須為解碼後不超過 10 MB 的非空 WAV 容器，包裝器會在寫入暫存檔前進行檢查。
