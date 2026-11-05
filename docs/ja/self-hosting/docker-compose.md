---
title: "Docker Compose"
sidebar:
  order: 3
aiGenerated: true
---

Docker Composeは、TomoriBotとPostgreSQLをコンテナー内で一緒に実行します。これは、[セットアップウィザード](/ja/self-hosting/setup-wizard/) および [手動セットアップ](/ja/self-hosting/manual-setup/) と並ぶ3番目のインストールオプションです。ホストシステムにBunまたはPostgreSQLをインストールせずに、Dockerですべてを実行したい場合に選択します。対話型セットアップウィザードをバイパスし、データベース接続を自動的に構成します。

:::caution[Host tools for updates]
`bun run update --docker`がコード変更をプルするには、ホストBunおよびGitが必要です。データベースのバックアップはアプリケーションコンテナ内で実行されます。Composeを通じて手動バックアップと復元を実行することもできます。[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)を参照してください。
:::

## 1. コードを取得する

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必要な`.env`の値

サンプルファイルから始めます。

```sh
cp .env.example .env
```

これらの必須変数を`.env`に設定します。

| 変数 | 価値 |
|---|---|
| `DISCORD_TOKEN` | Discordボットトークン (`GuildMembers`、`MessageContent`、および`GuildPresences`特権インテントを有効にします)。|
| `CRYPTO_SECRET` | 保存されたAPIキーの暗号化に使用される32文字の暗号化キー。|
| `POSTGRES_PASSWORD` | データベースのパスワード。他のすべての`POSTGRES_*`値は自動構成されます。|

Dockerを使用して`CRYPTO_SECRET`のランダムな32文字の値を生成し、それを`.env`にコピーします。

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

`POSTGRES_PASSWORD`用に別のパスワードを生成します。`.env.optional.example`からオプションのチューニング設定をコピーできます。

:::note[Database connection is automatic]
`.env`には`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、または`POSTGRES_DB`を設定しないでください。Composeはそれらを自動的に構成します。
:::

Linuxでは、コンテナーを起動する前に、ホスト上にバインドマウントディレクトリを作成し、所有権をUID 1001に割り当てます。Dockerは、不足しているマウントポイントをrootとして作成します。これにより、ボットコンテナーはバックアップ、ログ、またはアップロードを保存できなくなります。

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. ビルドと実行

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

後で開始する場合は、コードや依存関係を変更しない限り、`docker compose up`だけで十分です。ボットがDiscordに接続したら、任意のサーバー チャネルで`/setup`を実行してAIプロバイダー キーを追加します。Discordのセットアップオプションについては、[クイックスタート](/ja/introduction/quickstart/) を参照してください。

`.env`シークレットとローカルHTTPエンドポイントが機能するように、サービス定義で`RUN_ENV=development`ピンを構成します。コンテナーのヘルスチェックは、ボットプロセスが実行されているかどうかを報告します。Discordゲートウェイ接続はテストされません。運用モード (`RUN_ENV=production`) の違い (シークレットマネージャー、ネットワーク制限、メトリック) については、[セキュリティアーキテクチャ](/en/architecture/subsystems/security/) を参照してください。

## 単一ホストでのオプションのシャード設定

デフォルトの動作では、`SHARD_COUNT` と `SHARD_IDS` を未設定のままにします。起動時にDiscordから推奨されたすべてのシャードを1つのプロセスが担当します。小規模な環境では通常1つのシャードが割り当てられます。このモードではシャードリースやキャッシュ無効化リスナーは使用されません。複数のシャードが同じプロセスを共有できます。

既存のサービスで4つのシャードを実行するには、`.env` に `SHARD_COUNT=4` を追加し、`SHARD_IDS` は未設定のままにします。また、正常なシャットダウン処理が完了できるように、`compose.override.yaml` に以下のサービスオーバーライドを追加します：

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

`docker compose up -d --build tomoribot` でサービスを再作成します。スクリプトから `docker stop` を呼び出す場合や独自のCompose停止タイムアウトを指定する場合は、そちらでも40秒以上の猶予を設定してください。実行中にシャード数が自動的に変更されることはありません。総数を変更するにはプロセス全体の再起動が必要です。

オプションの静的サブセットを使用する場合は、同じ明示的な `SHARD_COUNT` と互いに重複しない `SHARD_IDS`（例：合計 `4` に対して `0,1` と `2,3`）を持つサービスをグループごとに個別に用意します。各サービスには固有の名前、コンテナー名、および公開ヘルスポートを設定してください。アプリケーションは各グループから安定したメトリックラベルを導出します。データベースは1つに保ち、ゲートウェイ起動前に既存のワンショットコマンド `bun run src/db/initializeCli.ts` をスキーマ管理権限で実行した上で、すべてのゲートウェイプロセスで `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false` を設定します。元の全シャード担当サービスをこれらのグループと同時に起動してはいけません。総数や分割構成を変更する前に、以前のプロセスを停止してください。

サブセットモードでは、完全設定されたMatrixブリッジは拒否されます。ユーザーごとのターン制限やアップロード制限はプロセスごとに適用されるため、2つ目のプロセスを有効にする前に、制限枠が倍増することが許容されるか検討してください。releaseブランチ専用のサポーター課金を利用している環境では、複数プロセスからリクエストを処理する前に、共有の支出受付および照合の調整も必要です。安全性とヘルスの制限については、[シャーディングとプロセス所有権](/architecture/subsystems/sharding/) を参照してください。

## 4. オプションのローカルサーバー（Composeプロファイル）

Composeプロファイルを使用してオプションのローカルヘルパー サーバーを実行して、必要なものだけを開始できるようにします。

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

SearXNGを有効にする場合は、`.env`に`SEARXNG_BASE_URL=http://searxng:8080/`を設定してください。それ以外の場合は未設定のままにしてください。`SEARXNG_SECRET`をSearXNGリクエスト署名用の別のランダム値に設定します。

サーバー固有の設定については、[SearXNG](/ja/self-hosting/local-endpoints/setup-searxng/)、[Crawl4AI](/ja/self-hosting/local-endpoints/setup-crawl4ai/)、および [ローカルモニタリング](/ja/self-hosting/local-monitoring/) を参照してください。

## メンテナンス、アップデート、バックアップ

Composeデプロイメントでのバックアップ優先更新には、`bun run update --docker`を使用します。Composeデータベースをバックアップまたは復元するには、[メンテナンスとバックアップ](/ja/self-hosting/maintenance/) を参照してください。
