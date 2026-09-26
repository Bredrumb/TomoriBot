---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Composeは、TomoriBot**と**PostgreSQLをコンテナとしてビルドおよび実行します。
これは[セットアップウィザード](/ja/self-hosting/setup-wizard/)および[手動セットアップ](/ja/self-hosting/manual-setup/)と並ぶ3つ目のインストール方法です。
ホストにBunやPostgreSQLをインストールするよりも、すべてをDockerで実行したい場合に選択してください。
セットアップウィザードは使用し**ません**。データベース接続は自動的に設定されます。

:::caution[更新に必要なホストのツール]
`bun run update --docker`は、コードを更新するためにホストのBunとGitが必要です。
データベースのバックアップはアプリのイメージ内で実行します。手動バックアップと復元も
Composeから実行できます。[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)を参照してください。
:::

## 1. コードを取得する

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必要な `.env` の値

サンプルファイルから開始します。

```sh
cp .env.example .env
```

次に、最低限以下の値を設定します。

| 変数 | 値 |
|---|---|
| `DISCORD_TOKEN` | Discordボットのトークン（`GuildMembers`、`MessageContent`、および `GuildPresences` の特権インテントを有効にしてください）。 |
| `CRYPTO_SECRET` | 保存されたAPIキーを暗号化するために使用される32文字の暗号化キー。 |
| `POSTGRES_PASSWORD` | データベースのパスワード。他のすべての `POSTGRES_*` の値は自動設定されます。 |

Dockerで`CRYPTO_SECRET`用のランダムな32文字の値を生成し、`.env`にコピーします。

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

`POSTGRES_PASSWORD`には別の値を生成します。オプションの設定は`.env.optional.example`からコピーできます。

:::note[データベース接続は自動的に行われます]
ComposeのPostgreSQLサービスは、内部のDockerネットワーク上で開発モード（SSLなし）で実行され、
バンドルされているイメージには既に `pgvector` と `pg_cron` が設定されています。
そのため、ドキュメント/RAGメモリーとスケジュールされたクリーンアップはすぐに機能します。
Compose用に `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、または `POSTGRES_DB` を設定しないでください。
これらは自動的に管理されます。
:::

Linuxでは、最初の起動前にホストのディレクトリを作成し、コンテナのユーザー（UID 1001）に所有権を付与します。Dockerが作成したディレクトリはroot所有となり、ボットがバックアップ、ログ、アップロードデータを書き込めません。

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. ビルドと実行

```sh
docker compose build   # 初回、またはコード/依存関係の変更後
docker compose up      # ボットとデータベース
```

以降の起動では、コードや依存関係を変更していない限り、`docker compose up` だけで十分です。
ボットがオンラインになったら、Discordで `/setup` を実行してAIプロバイダーのキーを追加します。
Discord側の操作については[クイックスタート](/ja/introduction/quickstart/)を参照してください。

Composeは`RUN_ENV=development`を使用するため、`.env`の秘密情報とローカルHTTPエンドポイントを利用できます。アプリのヘルスチェックはプロセスの稼働を確認し、Discordとの接続は確認しません。`RUN_ENV=production`では秘密情報をマネージャーまたはマウントしたJSONファイルから読み込み、HTTPSを必須にしてプライベートネットワークのURLを制限します。コマンド登録も変わり、HTTPヘルスサーバーとメトリクス収集が有効になります。Composeは開発モードに固定されています。

## 4. オプションのローカルサーバー（Composeプロファイル）

ローカルサーバーはComposeプロファイルを介してオプトインされるため、必要なものだけを実行できます。

```sh
# SearXNG（プライベートWeb検索）+ Crawl4AI（ブラウザレンダリングによるフェッチ）
docker compose --profile searxng --profile fetch-crawl4ai up
```

SearXNGプロファイルを有効にする場合は、`.env`に`SEARXNG_BASE_URL=http://searxng:8080/`を設定します。無効の場合は設定しません。署名キー用の別のランダムな値を`SEARXNG_SECRET`に設定します。

各サーバーの詳細については、[SearXNG](/ja/self-hosting/local-endpoints/setup-searxng/)、
[Crawl4AI](/ja/self-hosting/local-endpoints/setup-crawl4ai/)、
および[ローカルモニタリング](/ja/self-hosting/local-monitoring/)を参照してください。

## メンテナンス、更新とバックアップ

Composeデプロイメントでのバックアップ優先の更新手順には `bun run update --docker` を使用します。
Composeデータベースのバックアップと復元（ホストスクリプトの実行を含む）については、
[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)ページで説明されています。
新しいバージョンをプルする前に、まずは[安全な移行](/ja/self-hosting/safe-migration/)から始めてください。
