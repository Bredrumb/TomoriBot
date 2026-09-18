---
title: "手动安装"
sidebar:
  order: 2
---

> **关于这份翻译：** 本页是英文版[手动安装](https://docs.tomoribot.app/en/self-hosting/manual-setup/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

:::note
想用 Docker Compose 的人请跳过这个向导，容器化安装路径见
[Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

这是给不想用引导式向导的技术用户准备的手动安装流程。如果你想要一步一步带做的那种，请改用[安装向导](/zh-CN/self-hosting/setup-wizard/)，它会替你创建 `.env`、生成安全的 `CRYPTO_SECRET`、配置 PostgreSQL，并运行安装。

## 环境要求

- [Bun](https://bun.sh/)
- Node.js v20+（MCP 工具链需要）
- PostgreSQL，可以原生安装，也可以跑在 Docker 容器里（见第 2 步）

PostgreSQL 的数据库结构、`pgcrypto`、种子数据和迁移都会在 bot 启动时自动初始化。

## 1. 安装

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. 配置

从示例文件创建你的环境文件，并填入必须的值：

```sh
cp .env.example .env
```

必填项：

- `DISCORD_TOKEN`：你的 Discord bot 令牌（请开启 `GuildMembers`、`MessageContent`、
  `GuildPresences` 这三项特权 intent）。
- `CRYPTO_SECRET`：一个 32 字符的加密密钥（用于加密存储的 API 密钥）。
- PostgreSQL 连接信息：`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、
  `POSTGRES_PASSWORD`、`POSTGRES_DB`。

:::note[没有原生 PostgreSQL？]
只把数据库跑在容器里，然后让 `POSTGRES_*` 指向它：

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

然后设置 `POSTGRES_HOST=localhost`、`POSTGRES_PORT=5432`，以及上面的用户、密码和数据库名。
`pgvector/pgvector` 镜像已经预装 RAG 扩展；如果你不需要文档与 RAG 记忆，可以换成
`postgres:16`。这种跑法只在 Docker 里运行数据库，bot 仍然跑在主机端的 Bun 上。想要 bot
和数据库全部容器化，请改用
[Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

可选的调优项都在 `.env.optional.example` 里。想改哪些值（各类上限、超时、功能开关、边车服务 URL 等），就复制哪些过来。

## 3. 运行

```sh
bun run dev
```

当你看到 `TomoriBot up and running!` 时，去 Discord 在你的服务器里运行 `/setup`，接入 AI 提供方并初始化 bot。该指令会打开一个引导式清单面板，在你按下 **完成设置** 之前不会写入任何内容；步骤说明见
[`/setup` 指令](/zh-CN/self-hosting/setup-wizard/#setup-指令)，Discord 里那一侧的操作见
[快速上手](/zh-CN/introduction/quickstart/)。

如果你想让可选边车服务（SearXNG、Crawl4AI、本地 TTS/STT）与 bot 一起启动，请用 `bun run launch` 代替 `bun run dev`：

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # 查看所有参数
```

## 可选附加项（手动版的「完整安装」）

[安装向导](/zh-CN/self-hosting/setup-wizard/)的 **完整安装** 路径会在基础安装之上叠加四个轻量附加项。它们都不是运行 bot 的必需项，但每一项都会解锁一个功能。如果你是手动安装，想加哪个就加哪个：

### `pgvector`：文档与 RAG 记忆

RAG（文档上传与跨频道回忆）会把嵌入向量存进 `vector` 列，这需要
[pgvector](https://github.com/pgvector/pgvector) 扩展。请按你的 PostgreSQL 主版本安装：

```sh
# Debian/Ubuntu，例如 PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

然后在你的数据库上启用它一次。用 `.env` 里的 `POSTGRES_*` 值通过 `psql` 连接：它会提示你输入 `POSTGRES_PASSWORD`：

:::note[Windows]
原生的 Windows PostgreSQL 没有预编译的 pgvector 包。要装它就得用 Visual Studio C++ 和 `nmake`
针对你的确切 PostgreSQL 版本从源码编译（见 pgvector 的
[Windows 说明](https://github.com/pgvector/pgvector#windows)）。Windows 上更简单的路子是把数据库跑在
上面[配置](#2-配置)一节里给出的 `pgvector/pgvector` 容器里，该镜像已经预装了这个扩展。
:::

```sh
# 原生或主机端 psql（请替换成你自己的 POSTGRES_USER 和 POSTGRES_DB）：
psql -h localhost -p 5432 -U tomori -d tomodb

# 或者，如果数据库跑在第 2 步的 Docker 容器里：
docker exec -it tomori-db psql -U tomori -d tomori
```

连接之后运行：

```sql
CREATE EXTENSION vector;
```

没有 pgvector，bot 照样能跑，但 RAG 功能会完全不可用。还原备份之前，目标数据库上也必须装好这个扩展；细节见
[安全迁移](/zh-CN/self-hosting/safe-migration/)。

### `pg_cron`：定时清理任务

`pg_cron` 支撑可选的周期性数据库维护（冷却行与提醒行的清理）。本仓库的 Docker Compose 已经替你配置好了。

:::caution[提醒和触发并不需要它]
`pg_cron` **纯粹是打扫卫生**，它只清理过期数据行。提醒的发送与随机触发都在应用内部运行，所以有没有 `pg_cron` 这些功能都照常工作。
:::

对于自己管理的 PostgreSQL，先找到生效中的配置文件：

```sql
SHOW config_file;
```

在 `postgresql.conf` 里启用该扩展：如果 `shared_preload_libraries` 已经列了其他库，就追加：

```ini
shared_preload_libraries = 'pg_cron'   # 例如 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

重启 PostgreSQL，然后：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### 分词器资源：按模型处理的词元偏置

词元偏置（表情与词语重复惩罚）需要本地的分词器资源：

```sh
bun run setup:tokenizers
```

有些模型家族（例如 Gemma）是受限的，需要你先接受它们的许可，再用一个
[HuggingFace 令牌](https://huggingface.co/settings/tokens)：

```sh
# Windows（PowerShell）
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

不做这一步，词元偏置会被静默禁用，其他一切照常工作。

安全的 `fetch_url` 兜底在进程内运行，不需要任何 Python 包。DuckDuckGo 与 IAsk 的
`web_search` 随 `bun install --frozen-lockfile` 一起装好，也不需要额外安装。

## 维护、更新与备份

装好之后，主机端脚本（`bun run update`、`bun run backup`、`bun run restore-backup`、`bun run nuke-db`、`bun run rotate-keys` 等）以及更新和备份流程，都写在
[维护与备份](/zh-CN/self-hosting/maintenance/)页面。如果你准备拉取新版本，请先看[安全迁移](/zh-CN/self-hosting/safe-migration/)。
