---
title: "セットアップウィザード"
aiGenerated: false
sidebar:
  label: "セットアップウィザード"
  order: 1
---

:::note
Docker Composeを使用したいユーザーはこのウィザードをスキップし、コンテナ化されたインストールパスについては
[Docker Compose](/self-hosting/docker-compose/) を参照してください。
:::

`bun run setup` は、ローカルでのBunベースのインストールに推奨されるセルフホストパスです。このコマンドは、新規クローン時も含め、ウィザードを読み込む前に `bun.lock` から依存関係をインストールします。ウィザードは `.env` を作成し、`CRYPTO_SECRET` を生成し、Discordボットのトークンを尋ね、PostgreSQLを設定します。再実行しても安全です。既存の `.env` の値は、再設定を選択しない限り保持されます。

## 用意しておくもの

- **[Bun](https://bun.sh/)**（ボットおよびウィザード自体の実行に必要です）。
- **Discordボットのトークン**（`GuildMembers`、`MessageContent`、および `GuildPresences` の特権インテントが有効になっているもの）。
- **インストール済みのPostgreSQL。** TomoriBotはすべてをPostgreSQLに保存します。ウィザードが自動で行うため、手動で設定する必要はありません。PostgreSQLがすでにインストールされている場合はそれを使用し、インストールされていない場合は [Docker](https://www.docker.com/) 上で実行します。始める前に、どちらか一方がインストールされていることだけを確認してください。TomoriBotは初回起動時にスキーマ、シード、移行、`pgcrypto`、およびRAGスキーマを自動的に初期化します。

## コードを取得する

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## ウィザードの実行

以下のコマンドでセットアップウィザードを実行します：

```bash
bun run setup
```

コマンドを実行すると、2つのパスのいずれかを選択することになります：

| パス | 使用する場合 | 実行内容 |
|---|---|---|
| フルインストール | 軽量な追加機能を含む推奨のセットアップを行いたい場合。 | 基本インストールを実行後、以下の追加機能を試行します。 |
| 基本インストール | 最低限動作するボットのみが必要な場合。 | `.env`、Discordトークン、PostgreSQL、および依存関係を作成・設定します。 |

### フルインストールの追加機能

フルインストールでは、まず基本インストールが実行され、その後以下の追加機能のインストールが試行されます。いずれかが失敗した場合、ウィザードは手動で完了させるためのコマンドやガイドを出力し、そのまま処理を続行します：

| 追加機能 | 目的 |
|---|---|
| `pgvector` | ドキュメント/RAGの記憶用のベクトル検索。 |
| `pg_cron` | オプションのスケジュールされたクールダウン/リマインダー行のクリーンアップ。 |
| トークナイザーアセット | モデルに応じたロジットバイアス用のローカルのトークナイザーアセット。 |

これらを手動でインストールする場合は、
[マニュアルセットアップの追加機能](/self-hosting/manual-setup/#optional-extras-the-manual-full-install) を参照してください。

## セットアップ後

```bash
bun run dev                          # ボットのみ
bun run launch --searxng --crawl4ai  # ボットとローカルサーバー（bun run launch --help を参照）
```

ボットがオンラインになったら、Discordで `/setup` を実行します。AIプロバイダーまたはカスタムエンドポイントへの接続手順が案内されます。

## 更新

バックアップ優先のアップデーターコマンドである `bun run update` を使用してください。

これにより、`bun run backup` が実行され、続いて `git pull --rebase --autostash`、そして `bun install --frozen-lockfile` が実行されます。`dist/` から実行する場合は `--build` を、Composeデプロイメントの場合は `--docker` を追加してください。詳細については [メンテナンスとバックアップ](/self-hosting/maintenance/) ページを参照してください。
