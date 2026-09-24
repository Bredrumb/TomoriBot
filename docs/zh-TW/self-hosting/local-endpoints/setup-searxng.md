---
title: "設定：SearXNG（Sidecar）"
sidebar:
  order: 3
---

`web_search` 工具會走一條引擎鏈：**Brave → SearXNG → DuckDuckGo → IAsk**。自己運行一個 SearXNG 執行個體，就能避開單一引擎的速率限制與爬取中斷，並解鎖 SearXNG 專屬的分類：`science`、`it`、`files` 與 `music`。

從下列 SearXNG 設定路徑中選一條：

### A. Docker Compose（TomoriBot 跑在 Docker 時）

如果 TomoriBot 是用本 repo 的 Docker Compose 堆疊運行，請用這條路徑。接著以 `searxng` profile 執行：

```sh
docker compose --profile searxng up -d
```
這會在 TomoriBot 旁邊啟動 `searxng` 服務，bot 會自動在 `http://searxng:8080/` 連到它。

如果你是用 `bun run dev` 直接運行 TomoriBot，請改用底下的獨立路徑。

如果是在正式環境，請在 `.env` 將 `SEARXNG_SECRET` 設為任何 32 個字元以上的字串（開發環境會自動套用預設值）。

---

### B. 獨立 Docker（以 `bun run dev` 運行時）
首先，在 `.env` 設定 `SEARXNG_BASE_URL=http://localhost:8080/`，讓 bot 知道要連去哪裡。

接著，不要直接用 `bun run dev` 運行 TomoriBot，改用 `bun run launch --searxng`。它會自動處理容器生命週期，並在啟動 bot 之前等待容器健康：

```sh
bun run launch --searxng
```

如果你偏好自己管理容器，請在 `.env` 保留 `SEARXNG_BASE_URL=http://localhost:8080/`，然後執行：

**PowerShell：**
```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:rw" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng:latest
```

**Bash（Linux/macOS）：**
```bash
docker run -d --name searxng -p 8080:8080 \
  -v "${PWD}/servers/searxng:/etc/searxng:rw" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng:latest
```

接著等容器健康（`docker ps` 顯示 `(healthy)`）之後執行 `bun run dev`。

---

### C. 不使用 SearXNG
讓 `SEARXNG_BASE_URL` 保持未設定。鏈會退回 `Brave → DuckDuckGo → IAsk`。

沒有設定 SearXNG sidecar 時，組裝出來的 `web_search` 結構描述就不再宣告 SearXNG 專屬的分類。常見分類（`text`、`image`、`video`、`news`）在有設定 Brave 時仍然會出現，而只支援文字的搜尋會在只有 DuckDuckGo 與 IAsk MCP 備援可用時出現。

---

## 圖片結果調校

SearXNG 的圖片結果會經過 HEAD 驗證、視情況壓縮，並以 Discord 附件形式貼出，使用體驗與 Brave 圖片完全相同。如果所有候選 URL 都通不過驗證，SearXNG 會改成回傳一份圖片連結的文字清單，而不是直接失敗。

| 變數 | 預設 | 說明 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3`（上限 10） | 送往 Discord 的合格圖片數量。會被 LLM 的 `count` 參數覆寫。 |
| `SEARXNG_IMAGE_POOL` | `10` | LLM 未指定 `count` 時的候選 URL 池。指定 `count` 時，池的大小為 `count × 3`（上限 30），以吸收防盜連保護造成的失敗。 |
| `WEB_SEARCH_TIMEOUT_MS` | — | 每個引擎的請求逾時。 |

*（所有可調項目請看 `.env.optional.example`。）*
