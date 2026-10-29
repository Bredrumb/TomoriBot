---
title: "维护与备份"
sidebar:
  order: 5
aiGenerated: true
---

使用 CLI 维护脚本管理你的自部署 TomoriBot 实例，以更新代码、备份或恢复数据、轮换加密密钥以及检查环境变量。从宿主机终端或 Docker 环境运行这些命令。有关 Discord 内的数据导出与删除，请参见[数据处理](/features/knowledge/data-handling/)。

TomoriBot 会在启动时应用待处理的数据库迁移。部分迁移可能会删除数据且不会自动回滚，因此在更新或切换分支前请务必备份。

## 维护脚本

| 指令 | 说明 |
|---|---|
| `bun run setup` | 打开安装向导，用于基础安装与可选模块。 |
| `bun run update` | 先备份，再拉取最新代码并安装依赖。 |
| `bun run backup` | 在 `backups/` 中创建包含数据库转储与所需加密版本元数据的备份包。密钥单独保留。 |
| `bun run restore-backup` | 使用单独配置的加密密钥恢复数据库（`--latest` 或 `--from backups/<dir>`）。 |
| `bun run backup:personas` | 仅导出所有服务器上的人格（含服务器记忆）；通过 `/persona import` 重新导入。 |
| `bun run nuke-db` | 清除所有数据表（之后启动 bot 会重新初始化）。 |
| `bun run purge-commands` | 清除所有已注册的 Discord 斜杠指令。 |
| `bun run rotate-keys --bot-stopped` | 将所有加密字段重新加密到当前密钥版本。 |
| `bun run env-doctor` | 只读检查配置：列出没有任何代码读取的 `.env` 条目（仅名称，绝不包含值）以及每个变量的使用位置。 |

宿主机上的 `bun run backup` 需要 PATH 中包含 `pg_dump`，宿主机上的 `bun run restore-backup` 需要 PATH 中包含 `psql`。`bun run update` 也需要 `pg_dump` 进行备份。`--docker` 更新路径会在容器内运行备份，因此需要宿主机具备 Bun、Git 和 Docker，但不需要宿主机具备 PostgreSQL 工具。

对于本地头像，请保留 TomoriBot 托管的 Webhook：删除它们会导致 bot 无法编辑较早的 Webhook 消息。

## 数据库备份与恢复密钥
<!-- anchor: database-backups-and-recovery-keys -->

数据库备份包包含私密数据和所需加密版本清单。备份包不包含 `.env` 或媒体文件。请保护好备份包并单独妥善保管每个所需的加密密钥；如果缺少旧密钥，使用它加密的凭据将无法恢复。

要恢复受信任的备份：

1. 停止所有 bot 实例。配置目标数据库、Discord 令牌和原始加密密钥。
2. 安装 `psql` 和所需的数据库扩展，包括 `pgvector`。数据库账户必须有权启用 `pgcrypto`，或者必须由管理员预先启用它。
3. 运行 `bun run restore-backup --latest` 或 `bun run restore-backup --from backups/<bundle-directory>`。检查目标并确认提示。恢复程序会在执行具有破坏性的 SQL 前检查密钥。
4. 在重启前运行 `bun run audit-keys` 和 `bun run rotate-keys --dry-run`。如果凭据需要迁移，请运行 `bun run rotate-keys --bot-stopped` 并再次审计。如果恢复失败，请保持 bot 处于停止状态：先前的 SQL 语句可能已经更改了数据库。

单独备份本地 `data/` 目录，包括头像、语音样本和 `data/custom-expressions/`。将文件恢复到相同路径。对于 GCS 或 S3 表情图片，请备份 `custom-expressions/` 对象并将它们的键恢复到相同的已配置存储桶。外链表情图片取决于其外部主机。

在非生产环境中，当 bot 版本发生变更或最新备份距今已达到 `TOMORI_AUTO_BACKUP_INTERVAL_HOURS`（默认为 24 小时）时，启动过程会创建数据库备份。系统会保留 `TOMORI_AUTO_BACKUP_MAX` 个备份（默认为 5 个）；设置 `TOMORI_AUTO_BACKUP_ENABLED=false` 可禁用此功能。这些备份不包含媒体文件或加密密钥。

较旧的备份包可能在 `config.env` 中包含密钥。恢复程序不会加载该文件；请在私密环境下检查它，并通过正常的密钥源提供所需的密钥。

## 轮换加密密钥
<!-- anchor: rotating-encryption-keys -->

1. 备份数据库并将所有现有密钥存放在受保护的存储中。在停用任何密钥前，先在一次性数据库上测试恢复。
2. 使用 `openssl rand -base64 32` 生成新密钥。将其作为 `CRYPTO_SECRET_V<version>` 添加到 bot 的密钥源中，并使用 `CRYPTO_SECRET_CURRENT` 选中它。保留较旧的版本；`CRYPTO_SECRET` 为 V1。
3. 停止所有 bot 实例和凭据写入进程。使用与 bot 相同的密钥源和数据库设置；生产脚本还需要 `RUN_ENV=production`。
4. 运行 `bun run audit-keys` 和 `bun run rotate-keys --dry-run`。两者都必须成功才能继续。
5. 运行 `bun run rotate-keys --bot-stopped`，然后运行 `bun run audit-keys`。如果其中任何一个失败，请保持 bot 处于停止状态并保留所有密钥版本，同时排查修复失败原因。
6. 在配置了保留的当前密钥的一次性数据库上测试恢复。在从活动密钥源中移除旧版本前，先使用归档密钥测试较早的备份。只要备份存在，就请一直保留归档密钥，然后重启 bot。

`--bot-stopped` 用于记录你的确认；它无法检测另一个正在运行的实例，也无法清除其凭据缓存。

## 更新

首先停止正在运行的 bot，然后使用优先备份的更新程序：

```sh
bun run update
```

更新程序会先备份数据库，然后拉取代码并安装依赖。如果你从 `dist/` 运行，请使用 `--build`。对于 Compose，请参见 [Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups)。媒体文件和加密密钥请单独备份。

使用单独的数据库测试分支：切回分支不会撤销数据库迁移。如果迁移失败，请保持 bot 处于停止状态，检查日志，并按照上述恢复步骤操作，然后再返回之前的版本。更新前请使用 `git rev-parse HEAD` 记录当前提交哈希，以便于恢复。

### 环境配置变更

运行 `bun run env-doctor` 查找 `.env` 中未使用的设置。指令冷却时间使用 `COMMAND_COOLDOWN_SCALE`（默认值为 `1`；`0` 表示禁用冷却）。

本地 TTS 服务器不再使用先前的 Bearer 令牌设置对请求进行身份验证。在将它们向本机以外的网络公开前，请查看[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access)。每个引擎使用其专用的端口设置。

## 备份与恢复

```sh
bun run backup
bun run restore-backup --latest
# 或选择具体的备份包：
bun run restore-backup --from backups/<bundle-directory>
```

备份包保存在 `backups/` 或 `TOMORI_BACKUP_DIR` 中。在恢复前请遵循[恢复步骤](#database-backups-and-recovery-keys)。`bun run backup:personas` 仅导出人格和服务器记忆以供 `/persona import` 使用；它不能用于恢复数据库。

## Docker Compose 备份

Docker Compose 支持在应用容器内进行启动时自动备份。备份包会写入宿主机的 `backups/` 目录，因为 Compose 将该目录挂载到了容器中。

进行手动 Docker 备份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

进行 Docker 恢复：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

## 全新重装

`bun run nuke-db` 会清除所有数据表；之后启动 bot 会从头重新初始化数据库结构、种子数据和迁移。当你需要一个全新状态但仍希望可以回滚时，请将其与最新创建的 `bun run backup` 配合使用：切勿在没有最新备份的情况下运行它。
