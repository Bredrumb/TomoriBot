---
title: "VoxCPM2"
---

VoxCPM2 是 OpenBMB 的 2B 參數多語言文字轉語音模型。它支援 30 種語言、48 kHz 輸出、自然語言語音設計、參考音訊語音複製、可控複製，以及逐字稿輔助的「Ultimate Cloning」。TomoriBot 透過 `servers/tts/voxcpm2/` 中的輕薄包裝使用官方的 `voxcpm` Python 套件。

預設模型是官方的 `openbmb/VoxCPM2` BF16 檢查點。OpenBMB 回報標準執行環境約需 **8 GB VRAM**，所以正常模型能舒適地塞進 16 GB 的 NVIDIA GPU，預設不需要量化檢查點。

## 授權條款

VoxCPM2 的程式碼與模型權重依 **Apache-2.0** 發布，包含商業使用，但受授權條款約束。TomoriBot 不重新散布權重；安裝程式會從官方 Hugging Face repository 下載它們。

官方上游資源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 on Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM documentation](https://voxcpm.readthedocs.io/)

## 支援的語言

VoxCPM2 官方支援 30 種語言，不需要語言標記：

阿拉伯文、緬甸文、中文、丹麥文、荷蘭文、英文、芬蘭文、法文、德文、希臘文、希伯來文、印地文、印尼文、義大利文、日文、高棉文、韓文、寮文、馬來文、挪威文、波蘭文、葡萄牙文、俄文、西班牙文、史瓦希里文、瑞典文、他加祿文、泰文、土耳其文與越南文。

OpenBMB 另外記載了數種中文方言。TomoriBot 仍然可能為了與通用的 TTS 契約相容而送出 `language` 欄位，但 VoxCPM2 會從合成文字偵測語言，包裝不會強制加上語言標記。

## 語音模式

單一 VoxCPM2 端點就能處理所有實用的 TomoriBot 語音來源模式：

| TomoriBot 請求 | VoxCPM2 行為 |
|---|---|
| 只有 `text` | 拒絕；請選擇參考樣本或 VoiceDesign 提示詞 |
| `text` 加 `instruct` | 依自然語言描述進行語音設計 |
| `text` 加 `ref_audio` | 參考音訊語音複製 |
| `text` 加 `ref_audio` 加 `instruct` | 可控複製：保留說話者，同時引導語氣 |
| `text` 加 `ref_audio` 加 `ref_text` | 使用參考音訊與其逐字稿的 Ultimate Cloning |
| `text` 加 `ref_audio` 加 `ref_text` 加 `instruct` | 可控複製；單次指示優先，逐字稿不會送出 |

VoxCPM2 以在要合成的文字前面加上括號包住的自然語言描述，來表現語音設計與風格控制。TomoriBot 已經有為此用途設計的 `instruct` 欄位，所以包裝會自動完成那個轉換。

請使用 `純文字` 腳本標記風格。VoxCPM2 不需要 TomoriBot 保留方括號標籤或表情符號控制語法，也不需要新的腳本標記模式。

## 硬體與執行環境

建議起點：

- Python **3.10 到 3.12**
- 官方 BF16 執行環境需要具備 **8 GB VRAM 以上**的 NVIDIA GPU；12 到 16 GB 有舒適的餘裕
- 目前的 NVIDIA 驅動程式，以及支援 CUDA 的 PyTorch 建置以進行 GPU 加速
- 支援 CPU 作為備援，但明顯較慢

官方套件也提供 CPU 與 Apple MPS 裝置選擇。在 Windows 上的 TomoriBot，標準 Python 套件可以原生運行；不需要 WSL。Windows PowerShell 安裝程式預設安裝支援 CUDA 的 PyTorch 建置（`cu124`）。

若要在純 CPU 機器上明確安裝，請傳入 `-Cpu` 參數：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

如果你原生 Windows 的 PyTorch 安裝需要手動重裝或重新對齊驅動程式，請直接將支援 CUDA 的 PyTorch 建置安裝進伺服器的虛擬環境：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB 回報標準執行環境在 RTX 4090 上約為 0.30 RTF。上游也支援串流生成，並記載更快的 Nano-vLLM 與 vLLM-Omni 服務選項。TomoriBot 目前的 `POST /synthesize` 契約回傳單一 WAV 回應，所以這個伺服器刻意緩衝生成的語句，而不是另外提供串流協定。

## 安裝

這個伺服器釘住目前穩定的 `voxcpm` 2.0.3 套件，並將 `openbmb/VoxCPM2` 下載到一般的 Hugging Face 快取。

### Linux 與 WSL Bash

從 TomoriBot 儲存庫根目錄：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

從 TomoriBot 儲存庫根目錄：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

第一次設定會下載數 GB 的模型權重。若只想安裝 Python 環境而不預先抓取模型，請設定 `VOXCPM2_PREFETCH=0`；官方函式庫接著會在伺服器第一次啟動時下載檢查點。

Linux 與 WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

設定完成之後，`bun run launch --voxcpm2` 會將伺服器與 TomoriBot 一起啟動。預設端點是 `http://127.0.0.1:8016`。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `新增自訂端點`，並設定 Speech 端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8016`
- Voice Source Mode：`Auto`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線之後，選取它並用它的模型下拉選單加入一個 Speech 模型。接著開啟 `/config` > 模型 > 切換模型，選取 VoxCPM2 語音模型。

建議使用 `Auto`，因為同一台伺服器同時支援參考音訊複製與語音設計。兩種模式不需要各自獨立的 VoxCPM2 行程。

## 人格語音複製

用於應該複製既有說話者的人格：

1. 準備一段乾淨、只有一位說話者且背景音樂很少或沒有的參考片段。上游把 5 到 30 秒視為實用範圍。
2. 開啟 `/config`，在模型 > TTS 參數與語音 底下上傳該片段。
3. 在可以取得時加入參考片段的確切逐字稿。VoxCPM2 會用它做 Ultimate Cloning，並能重現更多參考的節奏、情緒與風格。
4. 開啟 `/config`，在人格 > 語音 底下選擇人格並指派已儲存的樣本。

如果沒有儲存逐字稿，VoxCPM2 仍然會進行一般的參考音訊複製。

5 到 30 秒這個數字是經過記載的品質範圍，而不是強制上限：VoxCPM2 本身不施加任何參考音訊長度限制，所以真正擋下更長片段的是 TomoriBot 的上傳上限。

## 人格語音設計

用於應該以文字語音描述而不是樣本建立的人格：

1. 開啟 `/config`，在人格 > 語音 底下選擇 VoiceDesign。
2. 選擇人格。
3. 輸入一段自然語言描述，例如 `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`。

TomoriBot 會將儲存的描述以 `instruct` 送出。VoxCPM2 會將它轉成自己原生的語音設計控制前綴。

當一個複製人格同時收到單次語音指示時，VoxCPM2 會使用可控複製：參考樣本提供說話者身分，而指示引導情緒、節奏或語氣這些特質。如果同時儲存了逐字稿，指示會優先，因為上游的 Ultimate Cloning 路徑沒有提供可靠的控制指示模式；那個請求會刻意省略逐字稿。

## `/generate voice-message`

一旦 VoxCPM2 成為作用中的 Speech 模型，`/generate voice-message` 就會以與一般語音訊息工具呼叫相同的方式，使用該人格設定好的語音來源：

- 複製人格送出已儲存的 `ref_audio` 與選用的 `ref_text`；
- VoiceDesign 人格將它們儲存的提示詞以 `instruct` 送出；
- 啟用指令支援且支援複製的端點會顯示語氣指示欄位，並透過 `instruct` 傳遞單次指示；
- 當有指示且帶複製樣本時，TomoriBot 只使用 `reference_wav_path`，不會送出逐字稿提示詞欄位。

## 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face 模型 ID 或本機模型目錄 |
| `VOXCPM2_DEVICE` | `auto` | 執行階段裝置：`auto`、`cuda`、`cuda:N`、`cpu` 或 `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 啟用官方執行環境的最佳化與編譯路徑 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 載入選用的上游去噪器；預設停用以節省記憶體 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引導強度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Flow-matching 推論步數；更多步可以提升品質，代價是速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 生成長度上限 |
| `VOXCPM2_NORMALIZE` | `0` | 啟用上游文字正規化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 為異常生成啟用上游重試行為 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 自動重試次數上限 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游的壞例長度門檻 |
| `VOXCPM2_PREFETCH` | `1` | 僅安裝程式：設定時下載模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2 本機伺服器連接埠 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 本機伺服器綁定位址; 請參閱[網路存取](/self-hosting/local-endpoints/text-to-speech/#network-access) |

參考音訊必須是解碼後不超過 10 MB 的非空 WAV 容器，包裝會在寫入暫存檔之前檢查這一點。

## 替代檢查點與執行環境

官方 BF16 模型已經能塞進預期的 16 GB 消費級 GPU 目標，所以 TomoriBot 不以量化檢查點為預設。社群量化版本是存在的，但它們多了一層相容性與維護負擔，對正常設定而言並不必要。

對高吞吐量的部署，OpenBMB 目前指向 Nano-vLLM-VoxCPM 與 vLLM-Omni 作為加速的服務選項。那些執行環境可以提供超出這個參考伺服器的串流與並行服務功能。它們不是 TomoriBot 一般本機語音訊息流程的必要條件，而這個包裝刻意留在官方 `voxcpm` API 上，讓上游的模型升級容易跟上。
