---
title: "設定：Crawl4AI"
sidebar:
  order: 4
---
# 設定：Crawl4AI

`fetch_url` 工具預設使用行程內的 `safe_http` 引擎。當你需要為大量使用 JavaScript 的網頁取得渲染後的內容時，它可以視情況在受信任的開發環境中嘗試瀏覽器渲染的本機伺服器。

預設的引擎順序是 `safe_http`。由於 Crawl4AI 會跟著重新導向離開 TomoriBot 受防護的 HTTP 用戶端，只有允許私有網路抓取的地方才會採用它。在正式環境之外這是自動的，不需要任何設定。在正式環境則需要明確選擇啟用 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`，並不建議這麼做。

Crawl4AI 是瀏覽器渲染的 markdown 伺服器。它運行以 Playwright 為基礎的無頭瀏覽器，並用自己的一套內容篩選器在伺服器端擷取對 LLM 友善的 markdown，TomoriBot 這一側不需要後處理。

從下列 Crawl4AI 設定路徑中選一條：

### A. Docker Compose（TomoriBot 跑在 Docker 時）

如果 TomoriBot 是用本 repo 的 Docker Compose 堆疊運行，請用這條路徑。首先，在 `.env` 設定 `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` 與 `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`。在正式環境之外不需要選擇啟用私有網路；只有當你用 `RUN_ENV=production` 運行這個堆疊時，才需要加上 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

接著，用下列指令啟動：

```sh
docker compose --profile fetch-crawl4ai up -d
```

這會啟動 Compose 堆疊，並讓 Crawl4AI 容器連上 TomoriBot 的 Docker 網路。

如果你是用 `bun run dev` 直接運行 TomoriBot，請改用底下的獨立路徑。

如果你也想要 SearXNG，請串接 profile：

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

如果你啟用了 Crawl4AI 的 API 權杖驗證，請在 `.env` 設定 `CRAWL4AI_TOKEN`；Compose 會將它以 `CRAWL4AI_API_TOKEN` 傳給容器，而 TomoriBot 會將它當作 bearer token 送出。

---

### B. 獨立 Docker（以 `bun run dev` 運行時）

首先，在 `.env` 設定 `CRAWL4AI_BASE_URL=http://localhost:11235/` 與 `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`，讓 bot 連到主機發佈的容器連接埠。在正式環境之外不需要選擇啟用私有網路；只有當你用 `RUN_ENV=production` 運行時，才需要加上 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

接著，不要直接用 `bun run dev` 運行 TomoriBot，改用 `bun run launch --crawl4ai`。它會自動處理容器生命週期，並在啟動 bot 之前等待伺服器健康：

```sh
bun run launch --crawl4ai
```

如果你也想要 SearXNG：

```sh
bun run launch --searxng --crawl4ai
```

如果你偏好自己管理容器，請在 `.env` 保留 `CRAWL4AI_BASE_URL=http://localhost:11235/`，然後執行：

**PowerShell：**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash（Linux/macOS）：**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

如果你為容器加上保護，請在 `docker run` 傳入 `-e CRAWL4AI_API_TOKEN=your_token`，並在 `.env` 設定 `CRAWL4AI_TOKEN=your_token`。

接著等容器健康（`docker ps` 顯示 `(healthy)`）之後執行 `bun run dev`。

---

### C. 不使用瀏覽器渲染伺服器

讓 `CRAWL4AI_BASE_URL` 保持未設定。`fetch_url` 工具會使用受防護的 `safe_http` 引擎。

---

## 啟動順序（重要）

TomoriBot 會在**啟動後第一次呼叫 `fetch_url`** 時探測伺服器健康狀態，並將結果快取 60 秒。如果第一次探測時容器還沒就緒，bot 會在下一次探測之前的一分鐘內將它視為無法使用。

對獨立 Docker 而言，請在啟動 TomoriBot 之前先啟動你的 Crawl4AI 容器。`bun run launch --crawl4ai` 已經幫你處理好了。

### 首次設定

1. 啟動容器，並等到 `docker ps` 顯示 `(healthy)`：
   ```powershell
   docker ps
   ```
2. 用上面對應你設定路徑的值，在 `.env` 設定 `CRAWL4AI_BASE_URL`。
3. 啟動 TomoriBot（`bun run dev` 或 `docker compose up`）。

### 重新啟動後再次使用

如果容器在先前執行時已經存在，請用 `docker start` 而不是 `docker run`，以避免名稱衝突：

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

接著照常啟動 TomoriBot。重新啟動 `bun run dev` 會重置記憶體中的健康快取，所以只要容器先就緒，正確的引擎就會立刻被採用。

---

## Cookie 注入（需要驗證的抓取，選用）

Crawl4AI 支援注入瀏覽器層級的 cookie，讓無頭瀏覽器在抓取網頁時看起來已經登入。這對需要工作階段才能看到內容的網站很實用（例如付費牆新聞、私人論壇、需要登入的儀表板）。

`safe_http` 備援**不**支援 cookie 注入，cookie 只在 Crawl4AI 作用中時才生效。

> **限制：** Cookie 注入能繞過登入牆，但繞不過 bot 指紋辨識。具備積極反機器人偵測的網站（特別是 Twitter/X）會透過 canvas 與 WebGL 指紋辨識偵測無頭 Playwright，即使帶著有效的工作階段 cookie 也回傳空白頁面。Cookie 注入對只靠驗證把關的網站效果良好。

### 取得你的 cookie

1. 開啟瀏覽器並登入目標網站。
2. 開啟 DevTools（`F12`）→ **Application** 分頁 → **Storage** → **Cookies** → 選取該網站的網域。
3. 複製每個必要 cookie 的 `Value`（通常是工作階段權杖，請檢查該網站的 cookie 名稱）。

### Crawl4AI

在 `.env` 設定 `CRAWL4AI_COOKIES_JSON` 為 JSON 陣列：

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

設定之後，`fetch_url` 會自動從 `/md` 端點改用 `/crawl` 加 `browser_config.cookies`，因為 `/md` 不支援 cookie 注入。

### Cookie 物件欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `name` | 是 | Cookie 名稱 |
| `value` | 是 | Cookie 值 |
| `domain` | 否 | 網域範圍（例如 `.x.com`）。為了正確性建議填寫。 |
| `path` | 否 | 路徑範圍。省略時預設為 `/`。 |

> **注意：** Cookie 值是敏感資料，請當作密碼看待。它們能取得你帳號的完整工作階段存取權。不要把 `.env` 提交到版本控制。

---

## 引擎順序與環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未設定 | 設定後即啟用 Crawl4AI。從 Docker Compose 使用時填 `http://crawl4ai:11235/`，TomoriBot 直接跑在你的機器上時填 `http://localhost:11235/`。 |
| `CRAWL4AI_TOKEN` | 未設定 | 選用的 bearer token。啟用時必須與 Crawl4AI 容器上的 `CRAWL4AI_API_TOKEN` 相符。 |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | 以逗號分隔的引擎清單。`safe_http` 一律附加為最後的備援；舊名稱 `mcp_fetch` 是它的別名。不允許私有網路抓取的地方（正式環境且未選擇啟用），Crawl4AI 項目會被忽略。 |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AI 與其他 URL 抓取引擎的每引擎請求逾時。 |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 單次抓取呼叫在需要接續之前可回傳的最大字元數。 |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 僅正式環境的選擇性啟用。在正式環境之外（`RUN_ENV` 不等於 `production`），SSRF 防護會自動放寬，所以 localhost、私有與內部抓取以及 Crawl4AI 派送都不需要設定就能運作。只有要在受信任的正式部署中允許私有網路抓取時，才設為 `true`。 |
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI 的 `/md` 篩選模式。`fit` 會讓 markdown 對 LLM 使用更乾淨；`fetch_url(..., raw=true)` 會逐請求覆寫它。 |
