---
title: "KoboldCPP 轉錄"
sidebar:
  order: 3
---

KoboldCPP 有以 Whisper 為基礎的 STT 支援，但端點形狀會因版本而異。TomoriBot 第四階段的轉接器預期 OpenAI 相容的 `POST /v1/audio/transcriptions`。

## 設定

以啟用 Whisper 與 STT 的方式啟動 KoboldCPP，並確認你的版本提供：

- `POST /v1/audio/transcriptions`
- `GET /v1/models` 或 `GET /models`

在 TomoriBot 使用 KoboldCPP 期間請保持它運行。如果你的版本只提供 `/api/extra/transcribe` 或其他自訂形狀，請先用一層包裝，等 TomoriBot 有專屬的轉接器再說。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 `新增自訂端點`，並使用轉錄 API 相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：你的 KoboldCPP 伺服器根路徑

儲存連線之後，選取它並用它的模型下拉選單加入你的伺服器回報為 Transcription 模型的模型名稱。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用註冊好的端點。

## 使用逐字稿

註冊之後，TomoriBot 會在背景轉錄音訊附件，並將文字加入聊天脈絡。只有你也想讓逐字稿可見地張貼在聊天中時，才需要使用 `/config` > Engine > 通知。
