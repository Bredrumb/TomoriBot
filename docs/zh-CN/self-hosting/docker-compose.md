---
title: "Docker Compose"
sidebar:
  order: 3
---

> **关于这份翻译：** 本页是英文版[Docker Compose](https://docs.tomoribot.app/en/self-hosting/docker-compose/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

Docker Compose 把 TomoriBot **加上** PostgreSQL 一起构建并作为容器运行。它是继[安装向导](/zh-CN/self-hosting/setup-wizard/)和
[手动安装](/zh-CN/self-hosting/manual-setup/)之后的第三条安装路径：当你宁愿把所有东西都跑在 Docker 里，而不是在主机上安装 Bun 和 PostgreSQL 时，就选它。它**不**使用安装向导；数据库连接已经替你自动配置好了。

:::caution[主机端脚本仍然需要主机上的工具]
把 bot 和数据库跑在 Docker 里，并不会把维护脚本也容器化。
`bun run backup`、`bun run restore-backup`、`bun run update`、`bun run rotate-keys` 之类的命令
仍然走主机端的 Bun 和主机的 PostgreSQL 客户端工具。Compose 专属流程见
[维护与备份](/zh-CN/self-hosting/maintenance/)。
:::

## 1. 获取代码

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必须的 `.env` 值

从示例文件开始：

```sh
cp .env.example .env
```

然后至少设置：

| 变量 | 值 |
|---|---|
| `DISCORD_TOKEN` | 你的 Discord bot 令牌（请开启 `GuildMembers`、`MessageContent`、`GuildPresences` 这三项特权 intent）。 |
| `CRYPTO_SECRET` | 一个 32 字符的加密密钥，用于加密存储的 API 密钥。 |
| `POSTGRES_PASSWORD` | 数据库密码。其他所有 `POSTGRES_*` 值都会自动配置。 |

与安装向导不同，Compose 不会替你生成 `CRYPTO_SECRET`，所以请自己设置
（任意 32 字符的字符串）。可选的调优值可以从
`.env.optional.example` 复制。

:::note[数据库连接是自动的]
Compose 的 PostgreSQL 服务以开发模式运行（不使用 SSL），位于 Docker 内部网络，
并且自带的镜像已经配置好 `pgvector` 和 `pg_cron`，所以文档与 RAG 记忆以及定时清理
开箱即用。使用 Compose 时不要设置 `POSTGRES_HOST`、
`POSTGRES_PORT`、`POSTGRES_USER` 或 `POSTGRES_DB`，它们会替你管理。
:::

## 3. 构建并运行

```sh
docker compose build   # 首次，或代码与依赖变更之后
docker compose up      # bot 加数据库
```

之后的启动，只要没改代码或依赖，单独一条 `docker compose up` 就够了。bot 上线后，在 Discord 里运行 `/setup` 添加你的 AI
提供方密钥：Discord 里那一侧的操作见[快速上手](/zh-CN/introduction/quickstart/)。

## 4. 可选边车服务（Compose profile）

边车服务通过 Compose profile 选择启用，所以你只会跑需要的那几个：

```sh
# SearXNG（私密网页搜索）加 Crawl4AI（浏览器渲染抓取）
docker compose --profile searxng --profile fetch-crawl4ai up
```

逐个边车服务的细节见 [SearXNG](/zh-CN/self-hosting/local-endpoints/setup-searxng/)、[Crawl4AI](/zh-CN/self-hosting/local-endpoints/setup-crawl4ai/)，
以及[本地监控](/zh-CN/self-hosting/local-monitoring/)。

## 维护、更新与备份

Compose 部署上先备份再更新的流程，请用 `bun run update --docker`。备份与还原 Compose 数据库（包括对它运行主机端脚本）写在[维护与备份](/zh-CN/self-hosting/maintenance/)页面。拉取新版本之前，请先看[安全迁移](/zh-CN/self-hosting/safe-migration/)。
