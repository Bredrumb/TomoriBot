---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
aiGenerated: true
---

使用 [ChatMock](https://github.com/RayBytes/ChatMock) 將 TomoriBot 連線至本機 Chat Completions 橋接工具。

:::caution[使用 CLI 帳號代理需自行承擔風險]
透過 CLI 帳號進行第三方存取可能會違反供應商條款，並有帳號遭到停權的風險。訂閱方案並不代表獲得 bot 或 API 使用許可。登入前請先檢視[帳號風險指南](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk)；TomoriBot 不提供任何帳號安全保證。
:::

## 1. 啟動 ChatMock

1. 依照 [ChatMock 儲存庫](https://github.com/RayBytes/ChatMock) 的說明安裝 ChatMock。
2. 如果你的帳號與存取方式允許此用途，請驗證並啟動伺服器：

```sh
chatmock login
chatmock serve
```

3. 確認本機 API 可於 `http://127.0.0.1:8000/v1` 存取。

## 2. 設定 TomoriBot

1. 執行 `/providers` 或 `/personal providers`，新增一個 `OpenAI 相容` 自訂端點。
2. 輸入連線設定：

| 欄位 | 值 |
|---|---|
| 端點 URL | 當 bot 在本機非生產環境運行時，填入 `http://127.0.0.1:8000/v1` |
| 驗證權杖 | 若已啟用驗證，則填入橋接工具的用戶端金鑰 |

3. 選取已儲存的端點並新增一個`文字模型`，填入 ChatMock 提供的確切 API ID。可在同一連線下註冊更多 ID 來切換模型。

- 裸位址 `http://127.0.0.1:8000` 會自動正規化為 `/v1`；請勿附加 `/chat/completions`。
- 請在 TomoriBot 的開發環境 `ALLOW_PRIVATE_NETWORK` 設定中允許 `127.0.0.1:8000`。Docker 的回環位址指的是容器本身。
- 請先測試橋接工具與選定的模型，再啟用工具、圖片或結構化輸出功能。影片功能請保持關閉。
- 若為分開架設的生產環境 bot，請依照 [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/) 指南設定。生產環境需要公開 HTTPS。直接以回環與連接埠為基準的 ChatMock 提示詞偵測不適用於中繼的公開主機名稱，因此請另外驗證系統指示的運作狀況。

:::note[系統提示詞處理與連接埠設定]
TomoriBot 會偵測 `CHATMOCK_PORT`（預設為 `8000`）上的回環端點，並將系統指示轉換為初始使用者對話輪，以相容於 ChatMock。若你使用不同的本機 ChatMock 連接埠，請設定 `CHATMOCK_PORT` 以對應之。
:::
