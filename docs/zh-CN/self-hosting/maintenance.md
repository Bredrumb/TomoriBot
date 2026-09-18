---
title: "维护与备份"
sidebar:
  order: 5
---

> **关于这份翻译：** 本页是英文版[维护与备份](https://docs.tomoribot.app/en/self-hosting/maintenance/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

自部署实例的日常运营：维护脚本、如何更新，以及如何备份和还原你的数据库。这些都是主机端操作：你在命令行里运行它们，而不是在 Discord 里。Discord 内按用户进行的导出、导入与删除流程，见
[数据处理](/zh-CN/features/knowledge/data-handling/)。

如果你正准备 `git pull` 拉取新版本，请先读[安全迁移](/zh-CN/self-hosting/safe-migration/)：
它讲的是在启动时的迁移执行器碰到你的数据库结构之前先备份。

## 维护脚本

| 指令 | 说明 |
|---|---|
| `bun run setup` | 打开安装向导，可做基础安装与可选模块。 |
| `bun run update` | 先备份，再拉取最新代码并安装依赖。 |
| `bun run backup` | 在 `backups/` 里生成一个包含数据库转储和 `.env` 的包：里面有你的全部数据。 |
| `bun run restore-backup` | 从某个包还原 `.env` 和数据库（`--latest` 或 `--from backups/<dir>`）。 |
| `bun run backup:personas` | 只导出所有服务器上的人格（含服务器记忆）；用 `/persona import` 重新导入。 |
| `bun run nuke-db` | 删除所有表（之后启动 bot 会重新初始化）。 |
| `bun run purge-commands` | 清除所有已注册的 Discord 斜杠指令。 |
| `bun run rotate-keys` | 把所有加密字段重新加密到当前密钥版本。 |

`bun run backup` 和 `bun run update` 需要 PATH 里有 PostgreSQL 客户端工具（`pg_dump`、`psql`）。

## 更新

先停掉正在运行的 bot，然后用先备份再更新的指令：

```sh
bun run update
```

它会依次运行 `bun run backup`、`git pull --rebase --autostash`、`bun install --frozen-lockfile`。备份包会写到 `backups/`，里面同时包含数据库转储和 `.env`。加上
`--skip-backup` 可以跳过更新前的备份。手动兜底做法：

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

从 `dist/` 运行？用 `bun run update --build`。用 Docker Compose？用
`bun run update --docker`。

## 备份与还原

`bun run backup` 会在 `backups/`（若在 `.env` 里改过，则是你的 `TOMORI_BACKUP_DIR`）里生成一个带时间戳的包，包含你整个 PostgreSQL 数据库加上 `.env`。用下面的指令还原最新的包：

```sh
bun run restore-backup --latest
```

或者还原指定的包：

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` 是范围更窄的导出：只包含人格预设集和按人格区分的服务器记忆，覆盖所有服务器。它**必须**通过 `/persona import` 手动重新导入，并且**不能**与 `restore-backup` 一起使用（那会导致主键冲突）。

TomoriBot 还会在非生产环境里做**启动时自动备份**，而完整还原要求目标数据库上已装好 `pgvector` 扩展。这两点都在[安全迁移](/zh-CN/self-hosting/safe-migration/)里有详细说明，那里也给出了手动 `pg_dump` 与 `pg_restore` 的流程，供你想直接操作工具时参考。

## Docker Compose 的备份

Docker Compose 支持在应用容器内做启动时自动备份。备份包会写到主机的 `backups/` 目录，因为 Compose 把它挂载进了容器。

手动做 Docker 备份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker 还原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db` 这类主机端脚本不会自动经由 Docker 运行。要让主机端脚本改而作用于 Compose 的数据库，请在装好 Bun 和 PostgreSQL 客户端工具的主机上运行它们，并设置：

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## 干净重装

`bun run nuke-db` 会删除所有表；之后启动 bot 会从零重新初始化数据库结构、种子数据和迁移。当你想要一块仍然能回滚的干净底板时，把它和一次全新的 `bun run backup` 配合使用：没有当前备份就绝不要运行它。

## 另见

- [安全迁移](/zh-CN/self-hosting/safe-migration/)：拉取之前先备份，以及 `pgvector` 这个还原前提
- [数据处理](/zh-CN/features/knowledge/data-handling/)：按用户、在 Discord 内进行的导出、导入与删除
- [安装向导](/zh-CN/self-hosting/setup-wizard/)：引导式的 `bun run setup` 安装
