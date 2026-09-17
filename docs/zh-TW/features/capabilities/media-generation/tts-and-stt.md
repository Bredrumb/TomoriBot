---
title: "語音：TTS 與 STT"
sidebar:
  order: 3
---

TomoriBot 可以**說話**（文字轉語音），也可以**聆聽**（語音轉文字）：

- **TTS** 讓她能用 Discord 原生語音訊息回覆。
- **STT** 把使用者的音訊附件轉成文字，讓她能當作對話脈絡使用。

兩者都透過同一套端點系統運作。最快的方式是 **ElevenLabs**（雲端，下方有完整說明）。如果你比較想用自己的硬體跑語音，請使用本機引擎，並跟著自架指南操作。

## 文字轉語音

### ElevenLabs（雲端，最簡單）

1. 從 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) 取得 API 金鑰。
2. 執行 `/providers`，選擇 **+ 新增供應商**，選 **ElevenLabs**，然後貼上金鑰。這個流程會：
   - 註冊 ElevenLabs 的**語音**端點（也會註冊**轉錄**端點），
   - 把它們選為使用中，
   - 可以當場為某一個人格指派語音。
3. 在 `/config` 的 人格 > 語音 底下為更多人格指派語音。在 [ElevenLabs 語音庫](https://elevenlabs.io/app/voice-library)瀏覽語音，在那裡你也可以複製自己的聲音。

在 `/providers` 中選擇 ElevenLabs，之後需要更新金鑰時隨時選擇 **編輯端點**。

注意事項：

- **免費方案只能使用預製語音**。請瀏覽[預製語音清單](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)。
- 她生成與朗讀語音訊息時都會計算字元數；免費方案有每月上限，請查看你的 ElevenLabs 儀表板。
- 語音回覆由 `voice_message_enabled` 管制，而且需要生效中的人格已指派語音。
- `/config` 的 人格 > 語音 在伺服器中需要管理伺服器權限，而在以私訊為基礎的工作區中，擁有者仍然可以使用。

在 `/help` 中選擇 **功能**，然後選 **語音生成**，就能在 Discord 裡看到同樣的逐步說明。

### 本機語音複製引擎（自架）

在自架執行個體上，你可以改跑本機的語音複製伺服器。大致流程是：啟動包裝伺服器、用 `/providers` 註冊它的連線與模型、用 `/providers` 選取它、在 `/config` 的 模型 > TTS 參數與語音 底下用 `/config` 上傳樣本，然後在 `/config` 的 人格 > 語音 底下指派它。任何音訊格式都接受（會自動轉成單聲道 WAV）；10 到 20 秒、沒有背景音樂的片段效果最好。

各引擎有自己的設定指南：

- [Chatterbox-Turbo/Nano](/en/self-hosting/local-endpoints/text-to-speech/chatterbox/)：快速、僅支援英文的語音複製，支援 `[laugh]` 這類事件標籤。
- [Qwen3-TTS](/en/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多語言（10 種語言），另有自然語言的 VoiceDesign 模式。
- [MOSS-TTS](/en/self-hosting/local-endpoints/text-to-speech/moss/)：供多語言複製或英文與中文語音設計試用的自動端點。
- [IrodoriTTS](/en/self-hosting/local-endpoints/text-to-speech/irodoritts/)：日文專精，會把表情符號讀成情緒提示。

完整清單與硬體建議請看[文字轉語音比較表](/en/self-hosting/local-endpoints/text-to-speech/)。

## 語音轉文字

轉錄端點會把使用者的音訊附件轉成文字，作為背景對話脈絡。逐字稿是否**明確發布**在聊天中，則由 `/config` > 行為 > 通知行為 另外控制。

### ElevenLabs（雲端）

上面已經涵蓋：從 `/providers` 新增 ElevenLabs 時，會連同語音一起註冊轉錄端點。用 `/providers` 在轉錄端點之間挑選。

### 本機引擎（自架）

- [WhisperX](/en/self-hosting/local-endpoints/speech-to-text/whisperx/)：推薦的本機路線；約 100 種語言、GPU 加速、多種模型大小。
- [KoboldCPP](/en/self-hosting/local-endpoints/speech-to-text/koboldcpp/)：如果你的版本提供與 OpenAI 相容的轉錄端點就能使用。
- [whisper.cpp](/en/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

完整清單請看[語音轉文字](/en/self-hosting/local-endpoints/speech-to-text/)中樞。Discord 裡的摘要請執行 `/help`，然後選擇 **功能** 與 **轉錄**。
