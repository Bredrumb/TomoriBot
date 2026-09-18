---
title: "配置：Crawl4AI（边车服务）"
sidebar:
  order: 4
---
# 配置：Crawl4AI 边车服务

> **关于这份翻译：** 本页是英文版[配置：Crawl4AI（边车服务）](https://docs.tomoribot.app/en/self-hosting/local-endpoints/setup-crawl4ai/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

`fetch_url` 工具默认使用进程内的 `safe_http` 引擎。在可信的开发环境里，当你需要为依赖 JS 的页面获取渲染后的内容时，它可以改为尝试一个浏览器渲染的边车服务。

默认的引擎顺序是 `safe_http`。由于 Crawl4AI 会在 TomoriBot 受保护的 HTTP 客户端之外跟随重定向，它只在允许抓取私有网络的地方才会被采用。在生产环境之外这是自动的（无需配置）。在生产环境里，它需要显式选择启用 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`，而这并不推荐。

Crawl4AI 是一个做浏览器渲染 Markdown 的边车服务。它运行基于 Playwright 的无头浏览器，并在服务端用它自己的内容过滤器提取适合 LLM 的 Markdown（TomoriBot 这一侧不需要后处理）。

Crawl4AI 的配置路径选一条：

### A. Docker Compose（TomoriBot 跑在 Docker 里时）

如果你用本仓库的 Docker Compose 技术栈运行 TomoriBot，就走这条路径。首先，在 `.env` 里设置 `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` 和 `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`。在生产环境之外不需要私有网络选择启用；只有当你以 `RUN_ENV=production` 运行这套技术栈时才加上 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后这样启动：

```sh
docker compose --profile fetch-crawl4ai up -d
```

这会启动 Compose 技术栈，并把 Crawl4AI 边车服务接到 TomoriBot 的 Docker 网络上。

如果你直接用 `bun run dev` 运行 TomoriBot，请改用下面的独立路径。

如果你还想要 SearXNG 边车服务，就把 profile 串起来：

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

如果你为 Crawl4AI 启用了 API 令牌认证，请在 `.env` 里设置 `CRAWL4AI_TOKEN`；Compose 会以 `CRAWL4AI_API_TOKEN` 把它传给容器，而 TomoriBot 会以 bearer 令牌发送它。

---

### B. 独立 Docker（用 `bun run dev` 运行时）

首先，在 `.env` 里设置 `CRAWL4AI_BASE_URL=http://localhost:11235/` 和 `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`，这样 bot 会连接到主机发布的容器端口。在生产环境之外不需要私有网络选择启用；只有当你以 `RUN_ENV=production` 运行时才加上 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后，不要直接用 `bun run dev` 运行 TomoriBot，改用 `bun run launch --crawl4ai`。它会自动处理容器的生命周期，并在启动 bot 之前等边车服务进入健康状态：

```sh
bun run launch --crawl4ai
```

如果你还想要 SearXNG 边车服务：

```sh
bun run launch --searxng --crawl4ai
```

如果你更喜欢自己管理容器，就在 `.env` 里保留 `CRAWL4AI_BASE_URL=http://localhost:11235/`，然后运行：

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

如果你给边车服务加了安全防护，请给 `docker run` 传 `-e CRAWL4AI_API_TOKEN=your_token`，并在 `.env` 里设置 `CRAWL4AI_TOKEN=your_token`。

等容器进入健康状态（`docker ps` 显示 `(healthy)`）之后，运行 `bun run dev`。

---

### C. 不用浏览器边车服务

不要设置 `CRAWL4AI_BASE_URL`。`fetch_url` 工具会使用受保护的 `safe_http` 引擎。

---

## 启动顺序（重要）

TomoriBot 会在**启动后第一次调用 `fetch_url` 时**探测边车服务的健康状态，并把结果缓存 60 秒。如果第一次探测发生时容器还没就绪，bot 就会在接下来一分钟里把它当作不可用。

对于独立 Docker，请先启动边车容器，再启动 TomoriBot。`bun run launch --crawl4ai` 已经替你做好了这件事。

### 首次配置

1. 启动容器，等它在 `docker ps` 里显示 `(healthy)`：
   ```powershell
   docker ps
   ```
2. 按上面属于你的那条配置路径，在 `.env` 里设置 `CRAWL4AI_BASE_URL`。
3. 启动 TomoriBot（`bun run dev` 或 `docker compose up`）。

### 重启之后重新接入

如果容器在之前的运行中已经存在，请用 `docker start` 而不是 `docker run`，以避免名字冲突：

```powershell
# 启动一个已存在的容器
docker start crawl4ai

# 在启动 TomoriBot 之前确认它是健康的
docker ps
```

然后照常启动 TomoriBot。重启 `bun run dev` 会重置内存中的健康缓存，所以只要容器先就绪，正确的引擎会立刻被采用。

---

## Cookie 注入（需要认证的抓取：可选）

Crawl4AI 支持注入浏览器层面的 cookie，让无头浏览器在抓取页面时看起来已经登录。对于需要会话才能查看内容的站点（例如付费墙新闻、私密论坛、需要登录的面板）很有用。

`safe_http` 兜底**不**支持 cookie 注入。Cookie 只在 Crawl4AI 生效时才起作用。

> **限制：** Cookie 注入能绕过登录墙，但绕不过机器人指纹识别。带有激进反机器人检测的站点（尤其是 Twitter/X）会通过 canvas 或 WebGL 指纹识别出无头 Playwright，即使带着有效的会话 cookie 也返回空页面。Cookie 注入对只靠认证把关的站点效果很好。

### 获取你的 cookie

1. 打开浏览器并登录目标站点。
2. 打开开发者工具（`F12`）→ **Application** 标签 → **Storage** → **Cookies** → 选择该站点的域名。
3. 复制每个必需 cookie 的 `Value`（通常是一个会话令牌；具体看该站点的 cookie 名称）。

### Crawl4AI

在 `.env` 里把 `CRAWL4AI_COOKIES_JSON` 设为一个 JSON 数组：

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

设置它之后，`fetch_url` 会自动从 `/md` 端点切换到带 `browser_config.cookies` 的 `/crawl`。`/md` 不支持 cookie 注入。

### Cookie 对象字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | Cookie 名称 |
| `value` | 是 | Cookie 值 |
| `domain` | 否 | 域作用范围（例如 `.x.com`）。为了正确性建议填写。 |
| `path` | 否 | 路径作用范围。省略时默认为 `/`。 |

> **注意：** Cookie 值很敏感，请像对待密码一样对待它们。它们能让你账户的完整会话被访问。不要把 `.env` 提交进版本控制。

---

## 引擎顺序与环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未设置 | 设置后启用 Crawl4AI。在 Docker Compose 里用 `http://crawl4ai:11235/`；当 TomoriBot 直接跑在你的机器上时用 `http://localhost:11235/`。 |
| `CRAWL4AI_TOKEN` | 未设置 | 可选的 bearer 令牌。启用时它必须与 Crawl4AI 容器上的 `CRAWL4AI_API_TOKEN` 一致。 |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | 逗号分隔的引擎列表。`safe_http` 总是作为最后的兜底被追加；旧名 `mcp_fetch` 是它的别名。在不允许抓取私有网络的地方（生产环境且未选择启用），Crawl4AI 条目会被忽略。 |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AI 与 URL 抓取边车服务的单引擎请求超时。 |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 一次抓取调用在需要续读之前返回的最大字符数。 |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | Crawl4AI 健康探测结果在重新检查之前缓存多久。 |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 仅生产环境选择启用。在生产环境之外（`RUN_ENV` 不等于 `production`），SSRF 防护会自动放宽，所以 localhost、私有和内部地址的抓取以及 Crawl4AI 调度都无需配置即可工作。只有在可信的生产部署里需要允许私有网络抓取时才设为 `true`。 |
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI 的 `/md` 过滤器模式。`fit` 会让 Markdown 更适合给 LLM 使用；`fetch_url(..., raw=true)` 会按请求覆盖它。 |
