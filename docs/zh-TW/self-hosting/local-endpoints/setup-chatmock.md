---
title: "設定：透過 ChatMock 使用 Codex CLI"
sidebar:
  order: 5
---

如果你想讓 TomoriBot 透過本機的 OpenAI 相容橋接使用你的 ChatGPT 帳號，可以運行 [ChatMock](https://github.com/RayBytes/ChatMock)，並把 TomoriBot 的 `custom` 供應商指向它。

## ChatMock 做什麼

- ChatMock 運行一個本機的 OpenAI 相容 API 伺服器
- TomoriBot 可以透過 `custom` 供應商使用那個本機伺服器

## 1. 啟動 ChatMock

依 GitHub 上的說明安裝並啟動 ChatMock：

- [ChatMock repository](https://github.com/RayBytes/ChatMock)

安裝之後，執行：
```sh
chatmock login
chatmock serve
```

ChatMock 預設監聽 `http://127.0.0.1:8000/v1`

## 2. 設定 TomoriBot 使用 ChatMock

在 Discord 中設定 TomoriBot 的 `custom` 供應商，並使用：

- **Endpoint URL**：`http://127.0.0.1:8000/v1`
- **Model Name**：ChatMock 應該收到的確切模型字串，例如 `gpt-5.4` 或 `gpt-5.3-codex`

單純的 `http://127.0.0.1:8000` 也可以：TomoriBot 會將它正規化為 `/v1`，再附加 `/chat/completions`。

為 ChatMock 啟用這些功能旗標：
- **Function Calling / Tools**：是
- **Image Understanding**：是
- **Video Understanding**：否
- **Structured Output**：是

**注意**：Codex CLI 不允許你變更它的 `system` 提示詞，所以 TomoriBot 的 `system` 提示詞會以變通做法轉成脈絡中的 `user` 輪。請將 `CHATMOCK_PORT` 這個 `.env` 變數設為你實際的 ChatMock 連接埠，讓這個變通做法正常運作（預設為 8000）。
