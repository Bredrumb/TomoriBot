---
title: "設定精靈"
sidebar:
  label: "設定精靈"
  order: 1
aiGenerated: false
---

:::note
想用 Docker Compose 的人請跳過這個精靈，容器化安裝路徑請看
[Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

`bun run setup` 是推薦的本機 Bun 自架路徑。它會建立你的 `.env`、產生 `CRYPTO_SECRET`、詢問你的 Discord bot 權杖、設定 PostgreSQL，並以互動方式安裝 `bun.lock` 裡指定的確切相依套件，所以你只要照著提示走就好。重複執行也沒有問題；既有的 `.env` 值會保留，除非你選擇重新設定它們。

## 取得程式碼

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 選擇一條路徑

執行指令之後，你會從兩條路徑中挑一條：

```bash
bun run setup
```


| 路徑 | 什麼時候用 | 它會做什麼 |
|---|---|---|
| 完整安裝 | 你想要推薦的設定，加上幾個輕量的額外項目。 | 先跑基礎安裝，接著嘗試底下四個額外項目。 |
| 基礎安裝 | 你只想要最低限度可運作的 bot。 | 建立並設定 `.env`、Discord 權杖、PostgreSQL 與相依套件。 |



## 事前要準備好的東西

- [Bun](https://bun.sh/)，用來執行 bot 與精靈本身。
- 一個 Discord bot 權杖，並已啟用 `GuildMembers`、`MessageContent` 與 `GuildPresences`
  特權意圖。
- 一個資料庫。 TomoriBot 把所有東西都存在 PostgreSQL。你不需要手動設定，精靈會幫你處理：
  你已經裝了 PostgreSQL 的話它就沿用，沒有的話它會在 [Docker](https://www.docker.com/) 幫你跑一個。
  只要確定開始之前兩者之一已經裝好就好。

:::caution
- 內附的 Docker PostgreSQL 只把資料庫放進 Docker。 bot 本身、啟動備份、`bun run backup`
  與 `restore-backup` 仍然透過主機的 Bun 與主機的 PostgreSQL 用戶端工具執行。如果你想把所有東西
  都放進 Docker，請改用 [Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

如果缺少 `psql` 或自動佈建失敗，精靈會印出手動執行的 SQL。不論是哪一種，TomoriBot 都會在首次啟動時自動初始化它的結構描述、種子資料、移轉、`pgcrypto` 與 RAG 結構描述。

## 完整安裝的額外項目

完整安裝會先跑基礎安裝，再嘗試安裝底下的額外項目。任何一項失敗，它會印出完成該項目的指令或指南，然後繼續往下走：

| 額外項目 | 用途 |
|---|---|
| `pgvector` | 文件與 RAG 記憶用的向量搜尋。 |
| `pg_cron` | 選用的排程冷卻與提醒資料列清理。 |
| Tokenizer 資產 | 本機 tokenizer 資產，支援依模型調整的 logit 偏權值。 |

想手動安裝其中任何一項，請看
[手動設定的額外項目](/zh-TW/self-hosting/manual-setup/#選用額外項目手動的完整安裝)。

## 設定完成之後

```bash
bun run dev                          # 只有 bot
bun run launch --searxng --crawl4ai  # bot 加本機伺服器（請看 bun run launch --help）
```

bot 上線後，在 Discord 執行 `/setup`。它會引導你連接 AI 供應商；各步驟要求請看[快速開始](/introduction/quickstart/)。

## 更新

使用備份優先的更新指令：`bun run update`

它會先執行 `bun run backup`，接著執行
`git pull --rebase --autostash`，再執行 `bun install --frozen-lockfile`。如果你是從 `dist/` 執行，加上
`--build`，Compose 部署則加上 `--docker`。完整細節在
[維護與備份](/zh-TW/self-hosting/maintenance/)頁面。
