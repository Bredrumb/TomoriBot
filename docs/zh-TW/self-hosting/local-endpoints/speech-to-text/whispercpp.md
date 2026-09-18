---
title: "whisper.cpp 轉錄"
sidebar:
  order: 2
---

當 whisper.cpp 的 HTTP 伺服器提供 OpenAI 相容的 `POST /v1/audio/transcriptions` 端點時，就可以使用它。

## 設定

啟動你的 whisper.cpp HTTP 伺服器，並確認它提供 OpenAI 相容的轉錄端點：

- `POST /v1/audio/transcriptions`
- `GET /v1/models` 或 `GET /models`

在 TomoriBot 使用期間請保持伺服器運行。端點 URL 是伺服器的根路徑，例如 `http://127.0.0.1:8022`。

如果你的 whisper.cpp 版本提供不同的端點形狀，請在它前面放一層輕薄包裝，將請求對應到 TomoriBot 預期的 OpenAI 相容形狀。

## 在 TomoriBot 中註冊

執行 `/providers`，選擇 **新增自訂端點**，並使用轉錄 API 相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：你的 whisper.cpp 伺服器根路徑

儲存連線之後，選取它並用它的模型下拉選單加入你的伺服器回報為 Transcription 模型的模型名稱。

端點註冊與模型設定請用 `/providers`。接著開啟 `/config` > 模型 > 切換模型，選取並啟用註冊好的端點。

## 使用逐字稿

註冊之後，TomoriBot 會在背景轉錄音訊附件，並將文字加入聊天脈絡。只有你也想讓逐字稿可見地張貼在聊天中時，才需要使用 `/config` > Engine > 通知。
