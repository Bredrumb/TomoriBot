---
title: "メンテナンスとバックアップ"
sidebar:
  order: 5
---

セルフホストインスタンスの日常的な運用として、メンテナンススクリプト、更新方法、データベースのバックアップと復元方法について説明します。これらはホスト側の操作であり、Discordからではなくシェルから実行します。Discord内でのユーザーごとのエクスポート/インポート/削除フローについては、代わりに[データの取り扱い](/ja/features/knowledge/data-handling/)を参照してください。

新しいバージョンを `git pull` しようとしている場合は、まず[安全な移行](/ja/self-hosting/safe-migration/)をお読みください。起動時の移行ランナーがスキーマに変更を加える*前*にバックアップを取る方法について説明しています。

## メンテナンススクリプト

| コマンド | 説明 |
|---|---|
| `bun run setup` | 基本インストールとオプションモジュール用のセットアップウィザードを開きます。 |
| `bun run update` | 先にバックアップを取ってから、最新のコードをプルして依存関係をインストールします。 |
| `bun run backup` | DBダンプと `.env` を含むバンドルを `backups/` に作成します（すべてのデータが含まれます）。 |
| `bun run restore-backup` | バンドルから `.env` とデータベースを復元します（`--latest` または `--from backups/<dir>`）。 |
| `bun run backup:personas` | すべてのサーバーにまたがるペルソナ（およびサーバーメモリー）のみをエクスポートします。`/persona import` 経由で再インポートします。 |
| `bun run nuke-db` | すべてのテーブルを削除します（その後ボットを起動して再初期化します）。 |
| `bun run purge-commands` | 登録されているすべてのDiscordスラッシュコマンドをクリアします。 |
| `bun run rotate-keys` | 暗号化されているすべてのフィールドを現在のキーバージョンに再暗号化します。 |

`bun run backup` および `bun run update` は、PATHにPostgreSQLクライアントツール（`pg_dump`、`psql`）が必要です。

## 更新

まず稼働中のボットを停止し、その後バックアップ優先のアップデーターを使用します。

```sh
bun run update
```

これにより、`bun run backup` が実行され、続いて `git pull --rebase --autostash`、そして `bun install --frozen-lockfile` が実行されます。バックアップバンドルは `backups/` に書き込まれ、データベースダンプと `.env` の両方が含まれます。更新前のバックアップをスキップするには `--skip-backup` を追加します。手動でのフォールバック手順は以下の通りです。

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

`dist/` から実行していますか？その場合は `bun run update --build` を使用してください。Docker Composeを実行していますか？その場合は `bun run update --docker` を使用してください。

## バックアップと復元

`bun run backup` は、PostgreSQLデータベース全体と `.env` を含むタイムスタンプ付きのバンドルを `backups/`（または `.env` でオーバーライドされている場合は `TOMORI_BACKUP_DIR`）に作成します。最新のバンドルを復元するには以下を実行します。

```sh
bun run restore-backup --latest
```

または、特定のバンドルを復元します。

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` はより絞り込まれたエクスポートであり、すべてのサーバーにまたがるペルソナのプリセットとペルソナごとのサーバーメモリーのみが対象です。これは `/persona import` 経由で手動で再インポートする**必要があり**、`restore-backup` と一緒には**使用できません**（プライマリキーの競合を引き起こすため）。

また、TomoriBotは本番環境以外では**自動スタートアップバックアップ**を取得します。完全な復元には、ターゲットデータベースに `pgvector` 拡張機能が存在している必要があります。両方の詳細については、[安全な移行](/ja/self-hosting/safe-migration/)で説明しています。ツールを直接操作したい場合の、手動での `pg_dump` / `pg_restore` 手順も併せて記載しています。

## Docker Composeのバックアップ

Docker Composeは、アプリコンテナ内での自動スタートアップバックアップをサポートしています。Composeがホストの `backups/` ディレクトリをコンテナにマウントしているため、バンドルはそこに書き込まれます。

手動でのDockerバックアップを行うには、以下を実行します。

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Dockerの復元を行うには、以下を実行します。

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db` などのホスト側のスクリプトは、Docker経由では自動的に実行されません。代わりにComposeデータベースに対してホストスクリプトを実行するには、BunとPostgreSQLクライアントツールがインストールされたホスト上で実行し、以下のように設定します。

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## クリーンインストール

`bun run nuke-db` はすべてのテーブルを削除します。その後ボットを起動すると、スキーマ、シード、および移行が最初から再初期化されます。ロールバック可能なまっさらな状態にしたい場合に、新しい `bun run backup` と組み合わせて使用してください。現在のバックアップなしで実行することは絶対に避けてください。

## 関連項目

- [安全な移行](/ja/self-hosting/safe-migration/)：プル前のバックアップ、および `pgvector` 復元の前提条件
- [データの取り扱い](/ja/features/knowledge/data-handling/)：Discord内でのユーザーごとのエクスポート/インポート/削除
- [セットアップウィザード](/ja/self-hosting/setup-wizard/)：ガイド付きの `bun run setup` インストール
