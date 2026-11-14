---
title: "安装向导"
sidebar:
  label: "安装向导"
  order: 1
aiGenerated: false
---

:::note
想使用 Docker Compose 的用户请跳过此向导，容器化安装路径请参见
[Docker Compose](/self-hosting/docker-compose/)。
:::

`bun run setup` 是本地基于 Bun 安装自部署的推荐路径。该命令会在加载向导前先从 `bun.lock` 安装依赖，包括在全新的代码克隆上。向导会创建你的 `.env`，生成 `CRYPTO_SECRET`，询问你的 Discord bot 令牌、是否[允许私有网络](#private-networks)，并配置 PostgreSQL。重复运行也是安全的；既有的 `.env` 值会被保留，除非你选择重新配置它们。

## 准备工作

- **[Bun](https://bun.sh/)**：用于运行 bot 和向导本身。
- **Discord bot 令牌**：需启用 `GuildMembers`、`MessageContent` 和 `GuildPresences`
  特权 intent。
- **已安装 PostgreSQL**：TomoriBot 将所有数据存放在 PostgreSQL 中。你不需要手动配置，向导会为你完成：如果你已安装 PostgreSQL，它将直接使用；如果你没有安装，它会在 [Docker](https://www.docker.com/) 中为你运行一个。只要确保在开始前已安装两者之一即可。TomoriBot 会在首次启动时自动初始化其数据表结构、种子数据、迁移、`pgcrypto` 和 RAG 数据结构。

## 获取代码

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 运行向导

使用以下命令运行安装向导：

```bash
bun run setup
```

运行该命令后，你将选择以下两条路径之一：

| 路径 | 何时选用 | 作用 |
|---|---|---|
| 完整安装（Full Install） | 需要推荐的配置及轻量附加项。 | 运行基础安装，随后尝试配置下方的附加项。 |
| 基础安装（Base Install） | 只需要能够运行的最小化 bot。 | 创建并配置 `.env`、Discord 令牌、PostgreSQL 和依赖。 |

### 私有网络
<!-- anchor: private-networks -->

向导会询问是否允许 TomoriBot 访问 `localhost` 和你的局域网，并将结果保存为 `.env` 中的 `ALLOW_PRIVATE_NETWORK`。在非生产环境下，不设置该项 TomoriBot 就无法启动，因此手动配置时也必须加上这一行。任何有权添加自定义端点或 MCP 服务器的成员都可以访问这里所允许的目标，因此请根据实际使用 bot 的人群来选择：

| 值 | 何时选用 |
|---|---|
| `true` | 只有你本人或受信任的 Discord 社区使用此 bot。`localhost` 或局域网中的本地模型与 MCP 服务器均可使用，包括纯 HTTP 连接。 |
| `host:port` 列表，例如 `localhost:5001,localhost:8188` | 你需要与并非完全信任的成员共享本地服务器（例如 KoboldCPP 或 ComfyUI）。只有列表中的服务器可以连接，因此他们的端点无法访问你网络中的其他服务。 |
| `false` | 不受信任的成员也会使用此 bot，且你不打算共享任何本地服务器。 |

无论选择哪个值，公网 HTTPS 端点（例如托管的兼容 OpenAI API）均可正常工作。若模型运行在另一台机器上，请使用[经过身份验证的远程连接](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)。隧道负责提供连通性，并且需要单独的访问控制。无论 `ALLOW_PRIVATE_NETWORK` 如何设置，生产环境都会拒绝私有端点。

列表匹配要求地址格式与端点注册时完全一致，因此 `localhost:5001` 不会覆盖 `127.0.0.1:5001`；你用到的每一种写法都需要单独列出。列表中的服务器依然对所有成员以及所有路径开放，因此请为服务器自身的管理功能加上密码保护（例如 KoboldCPP 使用 `--adminpassword`）。

Tailscale 地址和 `*.ts.net` 域名均视为私有地址，因此需要设为 `true` 或加入列表；设为 `false` 时，只有 Tailscale Funnel 可以正常使用。

无论你如何选择，成员发送的图片、文件和链接预览都不会访问私有地址。`fetch_url` 工具另有独立设置 `FETCH_URL_ALLOW_PRIVATE_NETWORK`（默认关闭）。

### 完整安装附加项

完整安装会先运行基础安装，然后尝试安装下方的附加项。如果某一项失败，它会打印手动完成的命令或指南并继续执行：

| 附加项 | 用途 |
|---|---|
| `pgvector` | 用于文档与 RAG 记忆的向量检索。 |
| `pg_cron` | 可选的冷却与提醒数据行定时清理。 |
| 分词器资源 | 用于 NovelAI 文本生成与感知模型的词元偏置的本地分词器资源。 |

如需手动安装其中任何一项，请参见
[手动安装附加项](/self-hosting/manual-setup/#optional-extras-the-manual-full-install)。

## 完成安装后

```bash
bun run dev                          # 仅运行 bot
bun run launch --searxng --crawl4ai  # bot 与本地服务器一同运行（参见 bun run launch --help）
```

当 bot 上线后，在 Discord 中运行 `/setup`。它会引导你连接 AI 提供方或自定义端点。

## 更新

使用优先备份的更新指令：`bun run update`

这会运行 `bun run backup`，然后执行 `git pull --rebase --autostash`，最后执行 `bun install --frozen-lockfile`。如果你从 `dist/` 运行，请添加 `--build`；如果是 Compose 部署，请添加 `--docker`。完整说明请参见
[维护与备份](/self-hosting/maintenance/)页面。
