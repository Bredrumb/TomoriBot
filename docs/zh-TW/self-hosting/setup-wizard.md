---
title: "設定精靈"
aiGenerated: false
sidebar:
  label: "設定精靈"
  order: 1
---

:::note
想使用 Docker Compose 的使用者請跳過此精靈，容器化安裝路徑請參閱
[Docker Compose](/self-hosting/docker-compose/)。
:::

`bun run setup` 是推薦的本機 Bun 自架路徑。該指令會在載入精靈之前先從 `bun.lock` 安裝相依套件，包含在全新複製的環境中。精靈會建立你的 `.env`、產生 `CRYPTO_SECRET`、詢問你的 Discord bot 權杖、詢問是否[允許私人網路](#private-networks)，並設定 PostgreSQL。重複執行也很安全；既有的 `.env` 值會保留，除非你選擇重新設定它們。

## 事前準備

- **[Bun](https://bun.sh/)**：用來執行 bot 與精靈本身。
- **Discord bot 權杖**：已啟用 `GuildMembers`、`MessageContent` 與 `GuildPresences` 特權意圖。
- **已安裝 PostgreSQL**：TomoriBot 把所有東西都存放在 PostgreSQL 中。你不需要手動設定，精靈會幫你處理：如果你已經安裝了 PostgreSQL 它就會直接使用，沒有的話會在 [Docker](https://www.docker.com/) 中為你執行一個。只要確保在開始前兩者之一已安裝好即可。TomoriBot 會在首次啟動時自動初始化其結構描述、種子資料、遷移、`pgcrypto` 與 RAG 結構描述。

## 取得程式碼

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 執行精靈

使用以下指令執行設定精靈：

```bash
bun run setup
```

執行指令後，你會從兩條路徑中選擇一條：

| 路徑 | 何時使用 | 功能說明 |
|---|---|---|
| 完整安裝 | 你想要推薦的設定加上輕量的額外項目。 | 先執行基礎安裝，接著嘗試底下的額外項目。 |
| 基礎安裝 | 你只需要最低限度可運作的 bot。 | 建立/設定 `.env`、Discord 權杖、PostgreSQL 與相依套件。 |

### 私人網路
<!-- anchor: private-networks -->

精靈會詢問 TomoriBot 是否可以存取 `localhost` 與你的區域網路，並將答案儲存為 `.env` 中的 `ALLOW_PRIVATE_NETWORK`。在非生產環境中，未設定此項目時 TomoriBot 將無法啟動，因此手動設定時也需要加上這一行。任何能新增自訂端點或 MCP 伺服器的成員，都能存取你在這裡允許的對象，請依使用 bot 的對象來選擇：

| 值 | 適用時機 |
|---|---|
| `true` | 只有你或受信任的 Discord 社群使用這個 bot。位於 `localhost` 或區域網路上的本機模型與 MCP 伺服器皆可使用，包含透過純 HTTP 連線。 |
| `host:port` 清單，例如 `localhost:5001,localhost:8188` | 你與並非完全信任的成員共用本機伺服器（例如 KoboldCPP 或 ComfyUI）。只有列出的伺服器能正常運作，因此對方的端點無法存取你網路上的其他服務。 |
| `false` | 有不受信任的成員使用 bot，且你沒有共用任何本機伺服器。 |

公開 HTTPS 端點（例如託管的 OpenAI 相容 API）在任何設定值下都能運作。若模型位於另一台電腦上，請使用[經授權的遠端連線](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)。通道本身僅提供連線能力，還需要另外設定存取控制。無論 `ALLOW_PRIVATE_NETWORK` 為何，生產環境一律拒絕私人端點。

清單會依照端點註冊時的位址進行完全比對，因此 `localhost:5001` 不涵蓋 `127.0.0.1:5001`；請列出所有會用到的寫法。列出的伺服器依然對所有成員開放其任何路徑，因此請替該伺服器自身的管理功能加上密碼保護（例如 KoboldCPP 使用 `--adminpassword`）。

Tailscale 位址與 `*.ts.net` 名稱也視為私人位址，因此需要設為 `true` 或加入清單；若設為 `false`，則只有 Tailscale Funnel 能夠運作。

無論你選擇哪個設定，成員張貼的圖片、檔案與連結預覽都絕對不會存取私人位址。`fetch_url` 工具則有自己獨立的設定 `FETCH_URL_ALLOW_PRIVATE_NETWORK`（預設為關閉）。

### 完整安裝的額外項目

完整安裝會先執行基礎安裝，接著嘗試安裝底下的額外項目。若有任何一項失敗，它會印出手動完成的指令或指南，並繼續進行：

| 額外項目 | 用途 |
|---|---|
| `pgvector` | 文件/RAG 記憶的向量搜尋。 |
| `pg_cron` | 選用的排程冷卻/提醒資料列清理。 |
| Tokenizer 資產 | 本機 tokenizer 資產，用於 NovelAI 文字生成與依模型調整的 logit 偏權值。 |

若要手動安裝其中任何一項，請參閱
[手動設定的額外項目](/self-hosting/manual-setup/#optional-extras-the-manual-full-install)。

## 設定完成後

```bash
bun run dev                          # 僅 bot
bun run launch --searxng --crawl4ai  # bot + 本機伺服器（請參閱 bun run launch --help）
```

當 bot 上線後，在 Discord 中執行 `/setup`。它會引導你連接 AI 供應商或你的自訂端點。

## 更新

使用備份優先的更新指令：`bun run update`

這會執行 `bun run backup`，接著執行
`git pull --rebase --autostash`，再執行 `bun install --frozen-lockfile`。若你從 `dist/` 執行請加上 `--build`，
若是 Compose 部署請加上 `--docker`。完整詳細資訊請參閱
[維護與備份](/self-hosting/maintenance/)頁面。
