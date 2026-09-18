---
title: "配置：SearXNG（边车服务）"
sidebar:
  order: 3
---

> **关于这份翻译：** 本页是英文版[配置：SearXNG（边车服务）](https://docs.tomoribot.app/en/self-hosting/local-endpoints/setup-searxng/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

`web_search` 工具会走一条引擎链：**Brave → SearXNG → DuckDuckGo → IAsk**。通过运行我们自己的 SearXNG 实例，我们避开了单引擎的速率限制和抓取失效，并解锁 SearXNG 独有的分类：`science`、`it`、`files` 和 `music`。

SearXNG 的配置路径选一条：

### A. Docker Compose（TomoriBot 跑在 Docker 里时）

如果你用本仓库的 Docker Compose 技术栈运行 TomoriBot，就走这条路径。然后用 `searxng` profile 运行：

```sh
docker compose --profile searxng up -d
```
这会启动 `searxng` 服务，与 TomoriBot 并列。bot 会自动通过 `http://searxng:8080/` 访问它。

如果你直接用 `bun run dev` 运行 TomoriBot，请改用下面的独立路径。

如果在生产环境使用，请在 `.env` 里把 `SEARXNG_SECRET` 设为任意 32 字符以上的字符串（开发环境会自动给默认值）。

---

### B. 独立 Docker（用 `bun run dev` 运行时）
首先，在 `.env` 里设置 `SEARXNG_BASE_URL=http://localhost:8080/`，让 bot 知道该连哪里。

然后，不要直接用 `bun run dev` 运行 TomoriBot，改用 `bun run launch --searxng`。它会自动处理容器的生命周期，并在启动 bot 之前等容器进入健康状态：

```sh
bun run launch --searxng
```

如果你更喜欢自己管理容器，就在 `.env` 里保留 `SEARXNG_BASE_URL=http://localhost:8080/`，然后运行：

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

等容器进入健康状态（`docker ps` 显示 `(healthy)`）之后，运行 `bun run dev`。

---

### C. 不用 SearXNG
不要设置 `SEARXNG_BASE_URL`。这条链会退回到 `Brave → DuckDuckGo → IAsk`。

没有配置 SearXNG 边车服务时，组装出来的 `web_search` schema 不再对外声明 SearXNG 独有的分类。常见分类（`text`、`image`、`video`、`news`）在配置了 Brave 时依然会出现，而只有 DuckDuckGo 与 IAsk 的 MCP 兜底可用时，则只出现纯文本搜索。

---

## 图像结果调优

SearXNG 的图像结果会经过 HEAD 校验，可选压缩，然后作为 Discord 附件发送：用户体验与 Brave 图像完全一致。如果所有候选 URL 都没通过校验，SearXNG 会返回一份图像链接的文本列表，而不是直接失败。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3`（最大 10） | 发送到 Discord 的有效图像数量。会被 LLM 的 `count` 参数覆盖。 |
| `SEARXNG_IMAGE_POOL` | `10` | LLM 未指定 `count` 时的候选 URL 池。指定 `count` 时，池大小为 `count × 3`（上限 30），用来吸收防盗链失败。 |
| `IMAGE_MIN_SIZE_BYTES` | `5120`（5 KB） | 小于该大小的图像会被拒绝：用于过滤占位图和错误图。与 Brave 图像搜索共用。 |
| `WEB_SEARCH_TIMEOUT_MS` | — | 单个引擎的请求超时。 |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | `60` | 健康探测结果在重新检查之前缓存多久。 |

*（所有可调项见 `.env.optional.example`。）*
