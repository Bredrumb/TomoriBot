---
title: "メンテナンスとバックアップ"
sidebar:
  order: 5
aiGenerated: true
---

CLIメンテナンススクリプトを使用してセルフホストのTomoriBotインスタンスを管理し、コードの更新、データのバックアップまたは復元、暗号化キーのローテーション、環境変数の検査を行います。ホストのターミナルまたはDocker環境からこれらのコマンドを実行します。Discord内でのデータのエクスポートと削除については、[データ処理](/features/knowledge/data-handling/) を参照してください。

TomoriBotは起動時に保留中のデータベース移行を適用します。データが削除される可能性があり、自動的にはロールバックされない移行もあるため、更新やブランチの切り替えを行う前にバックアップを取ってください。

## メンテナンススクリプト

| コマンド | 説明 |
|---|---|
| `bun run setup` | 基本インストールとオプションモジュール用のセットアップウィザードを開きます。 |
| `bun run update` | 先にバックアップを取ってから、最新コードをプルして依存関係をインストールします。 |
| `bun run backup` | データベースダンプと必要な暗号化バージョンメタデータを含むバンドルを`backups/`に作成します。シークレットは個別に保持されます。 |
| `bun run restore-backup` | 個別にプロビジョニングされた暗号化キーを使用してデータベースを復元します（`--latest`または`--from backups/<dir>`）。 |
| `bun run backup:personas` | すべてのサーバーにまたがるペルソナ（およびサーバーの記憶）のみをエクスポートします。`/persona import`経由で再インポートします。 |
| `bun run nuke-db` | すべてのテーブルを削除します（その後ボットを起動して再初期化します）。 |
| `bun run purge-commands` | 登録されているすべてのDiscordスラッシュコマンドをクリアします。 |
| `bun run rotate-keys --bot-stopped` | 暗号化されているすべてのフィールドを現在のキーバージョンに再暗号化します。 |
| `bun run env-doctor` | 設定の読み取り専用チェック：どこからも読み取られない`.env`項目（値ではなく名前のみ）と、各変数が使用されている場所を一覧表示します。 |

ホストの`bun run backup`には`pg_dump`、ホストの`bun run restore-backup`には`psql`がPATHに必要です。`bun run update`もバックアップに`pg_dump`を必要とします。`--docker`更新パスはコンテナ内でバックアップを実行するため、ホストにBun、Git、Dockerが必要ですが、ホストのPostgreSQLツールは不要です。

ローカルアバターについては、TomoriBotの管理対象Webhookを保持してください。これらを削除すると、ボットが古いWebhookメッセージを編集できなくなります。

## データベースのバックアップとリカバリキー
<!-- anchor: database-backups-and-recovery-keys -->

データベースバンドルにはプライベートデータと必要な暗号化バージョンのインベントリが含まれています。`.env`やメディアは含まれません。バンドルを保護し、必要なすべての暗号化キーを個別に保管してください。古いキーがないと、そのキーで暗号化された認証情報は復元できません。

信頼できるバックアップを復元するには：

1. すべてのボットインスタンスを停止します。対象データベース、Discordトークン、および元の暗号化キーを設定します。
2. `psql`と、`pgvector`を含む必要なデータベース拡張機能をインストールします。データベースアカウントが`pgcrypto`を有効化できるか、管理者が事前に有効化しておく必要があります。
3. `bun run restore-backup --latest`または`bun run restore-backup --from backups/<bundle-directory>`を実行します。対象を確認し、プロンプトに同意します。復元処理は破壊的なSQLの前にキーをチェックします。
4. 再起動する前に`bun run audit-keys`と`bun run rotate-keys --dry-run`を実行します。認証情報の移行が必要な場合は、`bun run rotate-keys --bot-stopped`を実行してから再度監査します。復元に失敗した場合はボットを停止したままにしてください。それ以前のSQL文によってすでにデータベースが変更されている可能性があります。

ローカルの`data/`ディレクトリ（アバター、音声サンプル、`data/custom-expressions/`を含む）は別途バックアップしてください。ファイルは同じパスに復元します。GCSまたはS3の表情については、`custom-expressions/`オブジェクトをバックアップし、設定されている同じバケットにそれらのキーを復元します。リンクされた表情は外部ホストに依存します。

非本番環境では、ボットのバージョンが変更されたとき、または最新のバックアップが少なくとも`TOMORI_AUTO_BACKUP_INTERVAL_HOURS`（デフォルトは24時間）経過している場合に、起動時にデータベースのバックアップが作成されます。`TOMORI_AUTO_BACKUP_MAX`個（デフォルトは5個）のバックアップが保持されます。これを無効にするには`TOMORI_AUTO_BACKUP_ENABLED=false`を設定します。これらのバックアップにはメディアや暗号化キーは含まれません。

古いバンドルには`config.env`にシークレットが含まれている場合があります。復元処理はそれを読み込みません。非公開で確認し、通常のシークレットソースを通じて必要なキーを指定してください。

## 暗号化キーのローテーション
<!-- anchor: rotating-encryption-keys -->

1. データベースをバックアップし、既存のすべてのキーを保護されたストレージに保管します。いずれかのキーを廃止する前に、使い捨てのデータベースでリカバリをテストしてください。
2. `openssl rand -base64 32`で新しいキーを生成します。ボットのシークレットソースに`CRYPTO_SECRET_V<version>`として追加し、`CRYPTO_SECRET_CURRENT`で選択します。古いバージョンは保持してください。`CRYPTO_SECRET`はV1です。
3. すべてのボットインスタンスと認証情報の書き込み処理を停止します。ボットと同じシークレットソースおよびデータベース設定を使用してください。本番環境のスクリプトには`RUN_ENV=production`も必要です。
4. `bun run audit-keys`と`bun run rotate-keys --dry-run`を実行します。次に進む前に両方が成功する必要があります。
5. `bun run rotate-keys --bot-stopped`を実行し、次に`bun run audit-keys`を実行します。いずれかが失敗した場合は、ボットを停止したまま、すべてのキーバージョンを利用可能な状態に維持して失敗を修正してください。
6. 保持された現在のキーを使用して、復元された使い捨てデータベースをテストします。本番シークレットソースから古いバージョンを削除する前に、古いバックアップをアーカイブされたキーでテストしてください。バックアップが存在する限りアーカイブされたキーを保管し、その後ボットを再起動します。

`--bot-stopped`は確認を記録するものであり、他に実行中のインスタンスを検出したり、その認証情報キャッシュをクリアしたりすることはできません。

## 更新

まず実行中のボットを停止してから、バックアップ優先のアップデーターを使用します：

```sh
bun run update
```

アップデーターはデータベースをバックアップし、コードをプルして、依存関係をインストールします。`dist/`から実行する場合は`--build`を使用してください。Composeについては、[Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups) を参照してください。メディアと暗号化キーは個別にバックアップしてください。

ブランチのテストには別のデータベースを使用してください。元に戻しても移行は取り消されません。移行に失敗した場合は、ボットを停止したままログを確認し、上記のリカバリ手順に従ってから以前のバージョンに戻してください。リカバリに役立てるため、更新前に`git rev-parse HEAD`で現在のコミットを記録しておきます。

### 環境の変更

`bun run env-doctor`を実行して、`.env`内の未使用の設定を見つけます。コマンドのクールダウンには`COMMAND_COOLDOWN_SCALE`（デフォルトは`1`、`0`でクールダウン無効）を使用します。

ローカルTTSサーバーは、以前のベアラートークン設定によるリクエストの認証を行わなくなりました。マシン外に公開する前に、[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を確認してください。各エンジンは独自のリッスンポート設定を使用します。

## バックアップと復元

```sh
bun run backup
bun run restore-backup --latest
# またはバンドルを選択：
bun run restore-backup --from backups/<bundle-directory>
```

バンドルは`backups/`または`TOMORI_BACKUP_DIR`に保存されます。復元する前に [リカバリ手順](#database-backups-and-recovery-keys) に従ってください。`bun run backup:personas`は`/persona import`用にペルソナとサーバーの記憶をエクスポートします。データベースを復元することはできません。

## Docker Composeのバックアップ

Docker Composeは、アプリコンテナ内での自動起動時バックアップをサポートしています。Composeがホストの`backups/`ディレクトリをコンテナ内にマウントしているため、バンドルはそこに書き込まれます。

手動でのDockerバックアップの場合：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Dockerの復元の場合：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

## クリーン再インストール

`bun run nuke-db`はすべてのテーブルを削除します。その後ボットを起動すると、スキーマ、初期データ、移行が最初から再初期化されます。ロールバックできるまっさらな状態にしたい場合に、最新の`bun run backup`と組み合わせて使用してください。現在のバックアップなしで実行することは絶対に避けてください。
