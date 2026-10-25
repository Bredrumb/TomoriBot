---
title: "安装向导"
sidebar:
  label: "安装向导"
  order: 1
aiGenerated: false
---

:::note
想用 Docker Compose 的人请跳过这个向导，容器化安装路径见
[Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

`bun run setup` 是本地 Bun 自部署的推荐路径。它会创建你的 `.env`、生成一个 `CRYPTO_SECRET`、询问你的 Discord bot 令牌、配置 PostgreSQL，并按 `bun.lock` 交互式安装完全一致的依赖，所以你只要跟着提示走就行。重复运行也是安全的；既有的 `.env` 值会保留，除非你选择重新配置它们。

## 获取代码

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 选择一条路径

运行命令之后，你会从两条路径中选一条：

```bash
bun run setup
```


| 路径 | 什么情况下选 | 它会做什么 |
|---|---|---|
| 完整安装（Full Install） | 你想要推荐的安装方式，外加几个轻量附加项。 | 先跑基础安装，然后尝试安装下面四个附加项。 |
| 基础安装（Base Install） | 你只要一个能跑起来的最小 bot。 | 创建并配置 `.env`、Discord 令牌、PostgreSQL 和依赖。 |



## 需要提前准备什么

- [Bun](https://bun.sh/)，用来运行 bot 和向导本身。
- 一个 Discord bot 令牌，并已开启 `GuildMembers`、`MessageContent`、`GuildPresences`
  这三项特权 intent。
- 一个数据库。 TomoriBot 把所有数据都存进 PostgreSQL。你不用手动配置，向导会替你做：
  如果你已经装好 PostgreSQL，它就用现成的；如果没装，它会用 [Docker](https://www.docker.com/)
  帮你跑一个。只要确保开始之前这两者里有一个装好了就行。

:::caution
- 向导附带的 Docker PostgreSQL 只在 Docker 里跑数据库。 bot 本身、启动备份、
  `bun run backup` 和 `restore-backup` 仍然走主机端的 Bun 和主机的 PostgreSQL 客户端工具。
  如果你更想全部跑在 Docker 里，请改用 [Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

如果缺少 `psql` 或者自动配置失败，向导会打印出让你手动执行的 SQL。不管哪种情况，TomoriBot 都会在首次启动时自动初始化它的数据库结构、种子数据、迁移、`pgcrypto` 和 RAG 结构。

## 完整安装的附加项

完整安装会先跑基础安装，然后尝试安装下面的附加项。任何一项失败，它都会打印出需要手动完成的命令或指南，然后继续往下走：

| 附加项 | 用途 |
|---|---|
| `pgvector` | 文档与 RAG 记忆的向量检索。 |
| `pg_cron` | 可选的冷却与提醒行定时清理。 |
| 分词器资源 | 用于按模型处理词元偏置的本地分词器资源。 |

想手动安装其中任何一项，见
[手动安装的附加项](/zh-CN/self-hosting/manual-setup/#可选附加项手动版的完整安装)。

## 安装之后

```bash
bun run dev                          # 只启动 bot
bun run launch --searxng --crawl4ai  # bot 加本地服务器（见 bun run launch --help）
```

bot 上线后，在 Discord 里运行 `/setup`。它会引导你连接 AI 提供方；各步骤要求详见[快速上手](/introduction/quickstart/)。

## 更新

使用先备份再更新的指令：`bun run update`

它会依次运行 `bun run backup`、`git pull --rebase --autostash`、`bun install --frozen-lockfile`。如果你从 `dist/` 运行，加上 `--build`；如果是 Compose 部署，加上 `--docker`。完整细节见
[维护与备份](/zh-CN/self-hosting/maintenance/)页面。
