---
title: "配置：Crawl4AI"
sidebar:
  order: 4
---

使用本地 [Crawl4AI](https://github.com/unclecode/crawl4ai) 服务器将JavaScript密集型网页渲染为TomoriBot的干净Markdown。

内置的`fetch_url`工具默认使用轻量级的`safe_http`引擎。Crawl4AI添加了一个可选的无头Playwright浏览器，该浏览器在将Markdown返回给机器人之前执行客户端脚本并提取页面内容。

由于Crawl4AI遵循TomoriBot受保护的HTTP客户端外部的重定向，因此仅在允许私网获取的情况下才允许其进行。外部生产（`RUN_ENV`！= `production`），私网抓取会自动启用。在生产环境中，需要设置`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

选择安装路径：

### 选项A：Docker Compose（当TomoriBot在Docker中运行时）

如果你使用存储库的Docker Compose堆栈运行TomoriBot，请使用此路径。首先，在`.env`中设置`CRAWL4AI_BASE_URL=http://crawl4ai:11235/`和`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`。外部制作无需选择加入专用网络； 仅当你使用`RUN_ENV=production`运行此堆栈时才添加`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后，从以下开始：

```sh
docker compose --profile fetch-crawl4ai up -d
```

这将使用TomoriBot的Docker网络上的Crawl4AI容器启动Compose堆栈。

如果你直接与`bun run dev`一起运行TomoriBot，请改用下面的独立路径。

如果你还想要SearXNG，请链接配置文件：

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

如果启用Crawl4AI API-token认证，则在`.env`中设置`CRAWL4AI_TOKEN`； Compose将其作为`CRAWL4AI_API_TOKEN`传递给容器，TomoriBot将其作为不记名令牌发送。

---

### 选项B：独立Docker（运行`bun run dev`时）

首先，在`.env`中设置`CRAWL4AI_BASE_URL=http://localhost:11235/`和`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`，以便机器人连接到主机发布的容器端口。外部制作无需选择加入专用网络； 如果你使用`RUN_ENV=production`运行，则仅添加`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后，不要直接使用`bun run dev`运行TomoriBot，而是使用`bun run launch --crawl4ai`。这会自动处理容器生命周期，并在启动机器人之前等待服务器健康：

```sh
bun run launch --crawl4ai
```

如果你还想要SearXNG：

```sh
bun run launch --searxng --crawl4ai
```

如果你更喜欢自己管理容器，请将`CRAWL4AI_BASE_URL=http://localhost:11235/`保留在`.env`中并运行：

电源外壳：

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

Bash（Linux/macOS）：

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

如果保护容器，请将`-e CRAWL4AI_API_TOKEN=your_token`传递给`docker run`并在`.env`中设置`CRAWL4AI_TOKEN=your_token`。

然后在容器正常运行后运行`bun run dev`（`docker ps`显示`(healthy)`）。

---

### 选项C：无浏览器渲染服务器

保留`CRAWL4AI_BASE_URL`未设置。`fetch_url`工具使用受保护的`safe_http`引擎。

---

## 起始订单

TomoriBot在启动后第一次调用`fetch_url`时探测服务器运行状况，并将结果缓存60秒。如果在第一个探测器触发时容器尚未准备好，机器人将在下一分钟将其视为不可用。

对于独立的Docker，请在启动TomoriBot之前启动Crawl4AI容器。`bun run launch --crawl4ai`已经为你做到了这一点。

### 首次设置

1. 启动容器，等待`docker ps`中显示`(healthy)`：
   ```powershell
   docker ps
   ```
2. 使用上面设置路径的值在`.env`中设置`CRAWL4AI_BASE_URL`。
3. 启动TomoriBot（`bun run dev`或`docker compose up`）。

### 重启后返回

如果容器在上次运行中已存在，请使用`docker start`而不是`docker run`以避免命名冲突：

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

然后正常启动TomoriBot。重新启动`bun run dev`会重置内存中的运行状况缓存，因此只要容器先准备好，就会立即选择正确的引擎。

---

## Cookie注入

Crawl4AI支持注入浏览器级cookie，因此无头浏览器在获取页面时会显示为已登录。这对于需要会话来查看内容的网站（例如付费新闻、私人论坛、登录控制仪表板）非常有用。

`safe_http`后备不支持cookie注入。Cookie仅在Crawl4AI处于活动状态时适用。

:::note[Bot detection limits]
Cookie注入绕过登录墙，但不能绕过机器人指纹识别。具有积极反机器人检测功能的网站（特别是Twitter/X）通过画布/WebGL指纹识别来检测无头剧作家，并提供空页面，即使具有有效的会话cookie。Cookie注入对于仅进行身份验证的网站效果很好。
:::

### 获取你的cookie

1. 打开浏览器并登录目标站点。
2. 打开DevTools (`F12`) > `Application`选项卡 > `Storage` > `Cookies` > 选择站点的域。
3. 复制每个所需cookie的`Value`（通常是会话令牌；检查站点的cookie名称）。

### Crawl4AI

将`.env`中的`CRAWL4AI_COOKIES_JSON`设置为JSON数组：

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

设置此值后，`fetch_url`自动从`/md`端点切换到`/crawl`和`browser_config.cookies`。`/md`不支持cookie注入。

### Cookie对象字段

| 场地 | 必需的 | 描述 |
|---|---|---|
| `name` | 是的 | 饼干名称 |
| `value` | 是的 | Cookie值 |
| `domain` | 不 | 域范围（例如`.x.com`）。推荐的正确性。|
| `path` | 不 | 路径范围。如果省略，则默认为`/`。|

:::caution[Protect session tokens]
Cookie值很敏感，因此请将它们视为密码。他们授予你帐户的完整会话访问权限。不要将`.env`提交到版本控制。
:::

---

## 引擎顺序和环境变量

| 多变的 | 默认 | 描述 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未设置 | 设置后启用Crawl4AI。使用Docker Compose中的`http://crawl4ai:11235/`，或者当TomoriBot直接在计算机上运行时使用`http://localhost:11235/`。|
| `CRAWL4AI_TOKEN` | 未设置 | 可选的不记名令牌。启用时必须与Crawl4AI容器上的`CRAWL4AI_API_TOKEN`匹配。|
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | 以逗号分隔的引擎列表。`safe_http`始终作为最终后备附加； 旧的`mcp_fetch`名称为其别名。在不允许专用网络获取的情况下（无需选择加入的生产），Crawl4AI条目将被忽略。|
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AI和其他URL获取引擎的每个引擎请求超时。|
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 在需要继续之前，一次fetch调用返回的最大字符数。|
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 仅限生产选择加入。外部生产（`RUN_ENV`！= `production`）SSRF防护自动放松，因此localhost/private/internal获取和Crawl4AI调度工作无需设置。仅设置`true`以允许在受信任的生产部署中进行专用网络提取。|
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md`滤波模式。`fit`保持降价更干净，供LLM使用； `fetch_url(..., raw=true)`根据请求覆盖它。|
