---
title: "MCP 登入設定"
description: "讓自架的 TomoriBot 新增需要帳號登入的 MCP 伺服器。"
sidebar:
  order: 1
---

有些 MCP 伺服器會要求管理員登入帳號，而不是貼上權杖。自架的 bot 只有在設定了 `TOMORI_PUBLIC_BASE_URL` 時才會提供這項登入功能。若未設定，則只有接受在 `驗證權杖` 中填入權杖的 MCP 伺服器能運作。

如果你使用的是[公開部署的 bot](https://discord.com/oauth2/authorize?client_id=841644102059556915)，則不需要這份說明；請參閱 [MCP 伺服器](/features/capabilities/tools-and-extensions/mcp-servers/)。

## 選擇基礎 URL

在 `.env` 中將 `TOMORI_PUBLIC_BASE_URL` 設為不含路徑的位址，然後重新啟動 bot：

| 值 | 適用時機 |
|---|---|
| `http://127.0.0.1:8080` 或 `http://localhost:8080` | 在 bot 自己所在機器的瀏覽器中完成登入。不需要網域或通道。 |
| `https://<your-host>` | 管理員從各自的電腦登入。你需要一個會轉發到 bot 的公開 HTTPS 位址。 |

設定此變數會使 bot 的 HTTP 伺服器在 `PORT`（預設 `8080`）上啟動，且該伺服器會接聽所有網路介面。進行中的登入狀態存放在記憶體中，如果在過程中重新啟動 bot，就必須從 Discord 重新發起登入。

## 回環位址

- 請使用 `PORT` 中設定的連接埠。兩者不同時，bot 會在啟動時記錄警告。
- 請在 bot 所在機器的瀏覽器中完成登入。若要從另一台電腦操作，請先透過 SSH 轉發該連接埠，再於該電腦的瀏覽器中選擇 `登入`：

  ```sh
  ssh -L 8080:127.0.0.1:8080 <user>@<bot-host>
  ```

- 每個服務會自行決定是否接受回環位址。如果某個服務拒絕，請改用 HTTPS 位址或權杖。

## HTTPS 位址

將下列路徑從你的公開位址轉發至 bot 的 `PORT`：

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

各服務會透過 `https://<your-host>/oauth/client.json` 來識別你的 bot，因此在第一次登入前就請決定好主機名稱並維持不變。

## Docker Compose

Compose 不會公開 bot 的連接埠。請在 `docker-compose.yaml` 旁建立 `docker-compose.override.yaml`：

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

請保留 `127.0.0.1:` 前綴，因為少了它，你網路上的每台電腦都能連上 bot 的 HTTP 伺服器。同一台機器上執行的反向代理或通道依然能轉發到此連接埠。
