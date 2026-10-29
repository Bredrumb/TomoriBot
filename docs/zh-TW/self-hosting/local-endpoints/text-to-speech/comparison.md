---
title: "TTS 引擎比較"
aiGenerated: false
sidebar:
  order: 1
---

在下方比較來自相同測試環境的合成時間與音訊樣本。

## 多語言與英文聲音複製

### 基準提示詞

- **標準提示詞** *（用於 Chatterbox Standard/Turbo/Nano、MOSS-TTS、CosyVoice 3、VoxCPM2、Qwen3-TTS）*：
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Fish Audio S2 Pro 提示詞** *（以括號表情標籤測試）*：
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### 效能與音訊比較

計時同時回報完整生成時間（從請求到完成音訊的總時鐘秒數）與即時係數（Real-Time Factor，RTF），定義為生成時間除以音訊長度：

- **RTF < 1.0（粗體）：** 引擎生成語音的速度比即時更快（例如 `0.50× RTF` 在 5 秒內渲染出 10 秒的音訊）。只有這些引擎能夠跟上即時語音通話，而 TomoriBot 目前並未實作此功能。
- **RTF > 1.0：** 生成時間長於朗讀音訊。TomoriBot 將每則語音訊息作為完整檔案發送，因此較高的 RTF 僅代表需要更長的等待時間。

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音訊樣本 |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 約 8 到 10 分鐘<sup>(2)</sup><br/>*（約 65× RTF）* | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox（Turbo，預設）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 5.0 秒 *（8.7 秒片段）*<br/>0.57× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox（Nano）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 3.0 秒 *（8.0 秒片段）*<br/>0.38× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox（Standard）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 6.0 秒 *（7.8 秒片段）*<br/>0.77× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 約 12.0 秒 *（8.8 秒片段）*<br/>1.36× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 約 6.0 秒 *（13.9 秒片段）*<br/>0.43× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 約 8.0 秒 *（7.4 秒片段）*<br/>1.09× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 約 10.0 秒 *（9.2 秒片段）*<br/>1.09× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **測試環境**：Windows 11（原生執行）上的 NVIDIA GeForce RTX 4070 Ti SUPER（16 GB GDDR6X，Ada Lovelace），使用 26.6 秒 24 kHz 單聲道參考音訊樣本與相符的逐字逐字稿。
- <sup>(2)</sup> **Fish Audio S2 Pro**：由於每個 token 需進行 76 次層評估所產生的 CUDA kernel 啟動延遲，Windows 執行以未編譯的 eager 模式運作（約 65× RTF）。建議在 Linux 或 WSL2 上搭配 OpenAI Triton 編譯器融合（`torch.compile`）執行以避免此調度停滯。

---

## 日文聲音複製

### 日文基準提示詞

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### 日文效能與音訊比較

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音訊樣本 |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 約 4.0 秒 *（8.5 秒片段）*<br/>0.47× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> 在相同的 RTX 4070 Ti SUPER Windows 11 測試環境中測量。

---

## 比較各引擎

TomoriBot 會傳回完整的 WAV 檔案。模型大小計算參數量；GPU 記憶體數值為設定指南。上述計時來自單一台 Windows 機器。

參考音訊長度包含上游建議與執行時期限制。詳細資訊請參閱各引擎指南。

| 引擎 | 模型大小；16 GB GPU | 語言 | 參考音訊片段 | 語音來源與控制 | 速度 / 串流路徑 | 適用情境 |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo（預設）、110M Nano 或 500M Standard；支援，Nano 可使用 CPU | 英語 | 10 秒；超過 10 秒提示視窗的部分會被靜默忽略 | 參考複製、支援的事件標籤；標準模型提供 CFG/誇張度 | 著重快速/輕量；包裝器傳回完整 WAV | 輕量英語複製設定或 CPU 實驗 |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 每種模式 1.7B；支援，模型可切換 | 10 種，包含英語/日語 | 3 秒起；無記載上限 | 複製或以文字描述的 VoiceDesign | 著重品質；上游支援串流，包裝器進行緩衝 | 通用多語言複製與日語 VoiceDesign |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 4B 複製 + 約 1.7B 設計，可切換；16 GB 為未經驗證的試用目標；8B 旗艦版可能無法 | 複製：31 種，包含日語；設計：英語/中文 | 上游未記載；無執行時期上限 | 複製或以文字描述的 VoiceGenerator；複製語言標籤 | 實驗性；本機複製具備上游串流後端，包裝器進行緩衝 | 比較 MOSS 複製品質或英語/中文語音設計 |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 目前 v4.1 Small 約 0.8B；單次本機執行觀察到約 3 到 4 GB VRAM | 僅日語 | 約 30 秒；受檢查點 120 秒上限裁切 | 複製或 VoiceDesign；表情符號風格提示 | 取樣步數在品質與速度間權衡；包裝器進行緩衝 | 佔用空間小的日語語音與表情符號驅動表達 |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B；官方 BF16 預設（約 16 到 18 GB），16 GB 可選用 INT8 | 上游宣稱 83 種 | 10 到 30 秒；無執行時期上限 | 參考複製（需要參考逐字稿）、自由格式括號表情標籤 | 重型 Dual-AR 模型；需要具備 Triton 的 Linux/WSL2 以達到快速合成（Windows eager 模式約 65× RTF） | 精細富有表現力的複製；請檢查研究授權條款 |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B；上游回報約 8 GB BF16 | 30 種 | 5 到 30 秒；文件記載範圍，無執行時期上限 | 複製、Voice Design、逐字稿輔助的 Ultimate Cloning、發音風格指示 | 上游在 RTX 4090 上約 0.30 RTF；上游支援串流，包裝器進行緩衝 | 單一多語言模型，具備最廣泛的語音來源控制 |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 0.5B 核心；16 GB 舒適，下載/執行時期較大 | 9 種，包含日語，以及中文方言 | 3 到 30 秒；較長者會裁切為前 30 秒 | 複製、跨語言複製、自然語言發音風格 | 著重低延遲；上游原生支援文字/音訊串流，包裝器進行緩衝 | 具備跨語言複製的未來串流候選 |

模型大小與語言數量遵循 [Chatterbox](https://github.com/resemble-ai/chatterbox)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、[MOSS](https://github.com/OpenMOSS/MOSS-TTS)、[Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro)、[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) 與 [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) 上游頁面。作業系統、驅動程式、授權條款、模型修訂版本與記憶體詳細資訊請參閱各指南。16 GB 的 GPU 不一定能同時裝載 TTS 模型與大型本機 LLM。

第一次 Qwen3-TTS 自動請求包含模型載入。MOSS 在設定期間會預先下載兩個模型，並在啟動時預設預熱複製模型，但任一自動伺服器在模式切換後仍必須載入另一個模型。TomoriBot 對於每個完整回應最多等待 `TTS_SYNTHESIZE_TIMEOUT_MS`（預設 240000 ms）。
