---
title: "安全な移行ガイド"
sidebar:
  order: 6
---

新しいコードを `git pull` してTomoriBotを再起動すると、ボットは起動時に自動的にデータベーススキーマの移行を実行します。これは強力であり、SQLの更新を手動で管理する必要がないことを意味しますが、同時に破壊的な操作がデータに静かに影響を与える可能性があることも意味します。このガイドでは、プルする前に自分自身を保護する方法を説明します。

## なぜこれが重要なのか

TomoriBotの移行ランナー（`src/db/migrationRunner.ts` 内）は、適用されていないすべての移行をバージョンの順に実行します。移行は**前方のみ（forward-only）**であり、何か問題が発生した場合でも、ランナーは自動ロールバックを行いません。ほとんどの移行は安全な拡張（新しいカラム、新しいテーブル）ですが、プロジェクトの[設計ポリシー（OD-R-6）](../../ja/plans/refactor/shared/open-decisions)に基づき、`DROP COLUMN` や `DROP TABLE` などの破壊的な操作が許可されています。バックアップなしで破壊的な移行が実行された場合、データは永久に失われます。疑わしい場合は、まずバックアップを取ってください。

## プル前のチェックリスト

`git pull` を実行する前に、以下の手順に従ってください。

1. **ボットの停止**：アクティブなデータベース接続がバックアップに干渉しないように、TomoriBotプロセスをシャットダウンします。
2. **データベースのバックアップ**：以下のいずれかの方法を使用してください。
3. **現在のコミットの記録**：`git rev-parse HEAD` を実行し、ロールバックが必要になった場合に備えて出力を保存します。
4. **プルと再起動**：バックアップがディスク上に安全に保存されたら、プルと再起動を行っても安全です。

### 前提条件: `pgvector` 拡張機能

フルバックアップはプレーンなSQLの `pg_dump`（`backupData.ts` は `pg_dump --clean --if-exists -f` を実行します）であるため、RAGに使用される `vector` 型の `document_chunks` テーブルが含まれます。**復元する前に、ターゲットのPostgresで `pgvector` 拡張機能が利用可能である必要があります。** そうでないと、ダンプの `CREATE EXTENSION IF NOT EXISTS vector` が実行できず、`document_chunks` テーブルの作成に失敗します。

ホスト上で一度インストールします（Postgresのメジャーバージョンに合わせてください）。例としてPostgres 16の場合は以下のようになります。

```bash
sudo apt-get install -y postgresql-16-pgvector
```

利用可能であることを確認します。

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

これなしで復元した場合：

- プロジェクトの `restore-backup`（および `ON_ERROR_STOP=1` を指定して実行した `psql -f`）は、`extension "vector" is not available` エラーで**早期に中断**し、データは読み込まれません。pgvectorをインストールして再試行してください。
- **エラーを無視する**（`ON_ERROR_STOP=0`）手動の `psql -f` の実行はさらに悪化します。失敗した `COPY public.document_chunks` がpsqlの入力パーサーの同期を乱し、その後の `COPY` データ行をSQLとして誤って解析してしまいます（`syntax error at or near …` の連鎖）。これにより、テーブル全体が静かに削除され（観測例：`documents` と `llms`）、データの一部が失われた不完全な復元データベースが残ってしまいます。失敗が直ちに表面化するように、必ず `ON_ERROR_STOP=1` を指定して復元してください。

### オプションA: プロジェクトのバックアップスクリプトを使用する

TomoriBotには2つのバックアップスクリプトが含まれており、それぞれ対象となるデータが異なります。

- **`bun run backup`**：データベーススキーマ全体とデータダンプ（ペルソナ、メモリー、設定などすべて）
- **`bun run backup:personas`**：ペルソナのプリセットとペルソナごとのサーバーメモリーのみ

安全に移行するには、**フルバックアップ**を使用してください。

```bash
bun run backup
```

これにより、PostgreSQLデータベース全体がプレーンなSQLダンプとして含まれた、タイムスタンプ付きのバンドルが `backups/`（または `.env` でオーバーライドされている場合は `TOMORI_BACKUP_DIR`）に作成されます。後で復元するには、以下を実行します。

```bash
bun run restore-backup --latest
```

または、特定のバンドルから復元します。

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### 自動のローカルスタートアップバックアップ

本番環境以外（`RUN_ENV` が `production` に設定されていない場合）では、TomoriBotはデータベースの初期化が実行される前に、フルデータバックアップがあるかどうかも確認します。以下のいずれかの条件に当てはまる場合、`backupData.ts` と互換性のある自動バンドルを作成します。

- 最新のフルデータバックアップが、異なる `package.json` のボットバージョンによって作成された場合
- 最新のフルデータバックアップが、少なくとも `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` 前のものである場合（デフォルトは `24`）

自動バックアップは `bundle_info.json` で `backupType: "automatic"` とタグ付けされ、名前に `_auto` サフィックスが付きます。手動での `bun run backup` によるバンドルは `manual` とタグ付けされ、最新のバックアップチェックを満たすことはできますが、自動保持の対象には決してカウントされません。スタートアップ時のゲートは、最新の `TOMORI_AUTO_BACKUP_MAX` 個（デフォルトは `5`）の自動バンドルを保持し、それより古い自動バンドルのみを削除します。

`pg_dump` のないマシンなどで、この安全ゲートなしでローカル/開発用ボットを起動する必要がある場合は、`.env` で `TOMORI_AUTO_BACKUP_ENABLED=false` を設定してください。

### オプションB: 直接 `pg_dump` を実行する

手動での制御を好む場合は、PostgreSQLに組み込まれている `pg_dump` ユーティリティと、TomoriBot自身の環境変数を使用します。

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

これにより、カスタム形式のバイナリダンプ（SQLテキストよりもコンパクト）が保存されます。環境変数は `.env` と一致します。

- `POSTGRES_HOST`：デフォルトは `localhost`
- `POSTGRES_PORT`：デフォルトは `5432`
- `POSTGRES_USER`：DBのユーザー
- `POSTGRES_DB`：デフォルトは `tomodb`

復元するには、以下を実行します。

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

**注意:** `.pgpass` ファイル（PostgreSQLに組み込まれている認証情報ファイル）でパスワードを設定していない限り、`pg_restore` はパスワードの入力を求めてきます。

## CI経由でデプロイする貢献者向け: `(Checkpoint)` 規則

AWSまたはGCPに `.github/workflows/deploy-tomoribot-{aws,gcp}.yml` のワークフロー経由でデプロイするフォークを保守している場合、これらのパイプラインは**オプトインのデプロイ前スナップショット**をサポートしています。コミットメッセージに `(Checkpoint)` という文字通りのトークンが含まれている場合、コードがデプロイされる**前**、かつ移行ランナーが起動時にデータベースに触れる**前**に、ワークフローは `aws rds create-db-snapshot`（またはGCP Cloud SQLの同等のコマンド）を実行します。

次の場合に使用します。

- カラムの削除、テーブルの削除、カラムの型変更など、データが失われる移行（OD-R-6の破壊的移行ポリシー）を行う場合。
- 複数の移行を組み合わせたリリースバンドルコミットを出荷し、単一のロールバックポイントを用意したい場合。
- キューに入れられた移行が安全かどうか不明な場合：疑わしい場合はチェックポイントを作成してください。

日常的な破壊的でないデプロイ（新しいカラム、新しいインデックス、シードデータの追加）についてはスキップしてください。スナップショットには実際のコストがかかり、日常的なパスには必要ありません。

コミットメッセージの例：

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

`(Checkpoint)` トークンは、件名または本文の任意の場所に記載できます。これはヘッドコミットのメッセージに対して大文字と小文字を区別して照合されます。アドホックなケースでは、ワークフローのバックアップ入力を有効にした手動ディスパッチも同じ働きをします。

## 移行が途中で失敗した場合の対処法

移行中にボットがクラッシュまたはハングアップした場合：

1. **すぐにボットを停止する**：ブラインド状態で移行を再試行させないでください。

2. **ログを確認する**：TomoriBotはデフォルトでstdout/stderrにログを出力します（プロセスマネージャーまたはDockerログによってキャプチャされます）。失敗した移行を示すエラーメッセージを探してください。出力例：

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **復元するかどうかを決定する**：エラーが回復不可能な場合（例: 存在しないカラムを削除しようとした場合など）は、バックアップから復元します。

   ```bash
   # オプションAの復元
   bun run restore-backup --latest

   # またはオプションBの復元
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **コードをロールバックする**：最後に動作していたコミットに戻します。

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   プル前のチェックリストのステップ3で保存したハッシュを使用するか、以下を使用して見つけます。

   ```bash
   git log --oneline | head -20
   ```

5. **バグを報告する**：[github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) で問題を報告してください。以下を含めてください。
   - 失敗した移行のファイル名（ログから）
   - 完全なエラーメッセージ
   - 最後に成功したコミットのハッシュ
   - お使いのOS、Bunのバージョン（`bun --version`）、およびPostgreSQLのバージョン

## 自動的に回復不可能なもの

プロジェクトの設計（OD-R-6）に基づき、**破壊的な移行は移行ランナーによってロールバックすることはできません**。例：

- `DROP COLUMN name_here`：削除された行は永遠に失われます。SQLスクリプトでそれらを回復することはできません。
- `DROP TABLE old_table`：テーブル全体が消去されます。
- 型の縮小（例: `VARCHAR(255) → VARCHAR(100)`）：100文字を超える値は切り捨てられます。

これらの操作については、**唯一の回復方法はバックアップです**。古いバージョンを使用しており、新しいリファクタリングが出荷された場合は、プルする前に必ずバックアップを取ってください。

移行ランナーが前方のみ（forward-only）の設計になっているのは意図的なものです。テスト時の開発者の安全のためにロールバックファイル（`.down.sql`）は存在しますが、本番環境での回復は取り返しのつかない操作の再実行ではなく、バックアップに依存します。

## 関連項目

- [データベーススキーマのドキュメント](../systems/database-schema)：現在のスキーマ構造について学ぶ
- [設計決定 OD-R-6（ダウン移行の形状）](../../ja/plans/refactor/shared/open-decisions.md#od-r-6-down-migration-shape)：移行の安全性ポリシーの技術的根拠
- [Bunドキュメント](https://bun.sh)：Bunランタイムの基本を学ぶ
