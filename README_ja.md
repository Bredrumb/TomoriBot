



<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="img/tomoricon.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

メモリー、ペルソナ、ツール使用など、スマートなエージェント型AI機能を備えた高度にカスタマイズ可能なDiscord用チャットボット/ワイフボット

<p align="center">

[English](README.md) | 日本語
<br />
      <br />
      <a href="https://github.com/Bredrumb/TomoriBot/releases">最新リリース</a>
      &middot;
      <a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">TomoriBotを招待</a>
      &middot;
      <a href="https://discord.gg/bjCfHm9QsB">Discordサーバー</a>
      &middot;
      <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">バグ報告</a>
      &middot;
      <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">機能リクエスト</a>

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)

  </p>




<!-- PROJECT LOGO -->
![TomoriBot Banner](img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]


</div>


<!-- ABOUT THE PROJECT -->
## プロジェクトについて

TomoriBotは、[SillyTavern](https://github.com/SillyTavern/SillyTavern)とDiscordの廃止されたClydeにインスパイアされた無料のオープンソース趣味プロジェクトです。実用的なAIアシスタントとカスタムAIコンパニオンの両方を、すべて設定可能な設定と動作でDiscordにもたらすために作成されました。

[公開TomoriBotを招待](https://discord.com/oauth2/authorize?client_id=841644102059556915)してDiscordサーバーに追加するか、プライバシーとAPIキーを完全にコントロールしたい場合は[自分でホスト](#セルフホスティング)することができます。TomoriBotは暗号化を使用してデータを安全に保ちますが、セルフホスティングにより、すべてのデータが完全にあなたのデバイス上に保持されます。

どちらの方法でサーバーに追加した後、指示に従って`/config setup`コマンドを実行してください。その後、彼女の名前を呼ぶか@メンションするだけで応答を得ることができます。

## 機能紹介


![Screenshots 1](img/scs/1st.png)

<h3 align="center">エージェント型AIによる会話</h3>
<p align="center">TomoriBotは、Web検索、リマインダー設定、画像分析、YouTube視聴、サーバーの絵文字/スタンプの使用など、単なるチャット以上のことができる多数のツールを持っています</p>

<br />

![Screenshots 2](img/scs/2nd.png)

<h3 align="center">各サーバーのTomoriBotは独自</h3>
<p align="center">50以上のスラッシュコマンドで完全なカスタマイズが可能です。TomoriBotのサーバー内でのパーソナリティ、行動、アバターは簡単に変更でき、ペルソナとして他のユーザーにエクスポートすることもできます（共有可能なAIキャラクターカードのようなもの）。また、メモリーを使用してやり取りを記憶し、あなたとあなたのサーバーのみがアクセスできます（プライバシーのための完全な削除またはブロックオプション付き）</p>

<br />


![Screenshots 3](img/scs/3rd.png)

<h3 align="center">多言語・マルチプロバイダー対応</h3>
<p align="center">異なるAIプロバイダーとモデルが利用可能です（現在Google Gemini、OpenRouter、NovelAI）。実用的なコーディングAIからロールプレイAIまで、TomoriBotの「頭脳」を動かすさまざまなモデルが使えます。TomoriBotは選択したAIプロバイダー/モデルに基づいて多言語対応です</p>

<br />


![Screenshots 4](img/scs/4th.png)

<h3 align="center">...その他多数！</h3>
<p align="center">TomoriBotは現在ベータ版で、新機能のテストが進行中です。近日公開予定</p>


<!-- GETTING STARTED -->
## セルフホスティング

このガイドは、開発または個人使用のためにTomoriBotをローカルでセットアップするのに役立ちます。

### 前提条件

TomoriBotを実行する前に、以下がインストールされていることを確認してください：

* **Bun** - JavaScriptランタイムおよびパッケージマネージャー
  ```sh
  # Windows (PowerShell)
  powershell -c "irm bun.sh/install.ps1 | iex"

  # macOS/Linux
  curl -fsSL https://bun.sh/install | bash
  ```
* **PostgreSQL** - データベースサーバー
  ```sh
  # Windows (Chocolateyを使用)
  choco install postgresql

  # macOS (Homebrewを使用)
  brew install postgresql

  # Linux (Ubuntu/Debian)
  sudo apt-get install postgresql postgresql-contrib
  ```
  - PostgreSQLインストール後、ログイン：
  ```sh
  # Linux
   sudo -u postgres psql

   # macOS (Homebrew)
   psql postgres

   # Windows
   # スタートメニューから「SQL Shell (psql)」を使用、または：
   psql -U postgres
  ```
  - TomoriBotに必要なデータベースとユーザーを作成します。`your_`変数を自分のものに置き換えてメモしておいてください：
  ```sql
  CREATE USER your_username WITH PASSWORD 'your_password' SUPERUSER;
  CREATE DATABASE your_dbname OWNER your_username;
  \q
  ```

  **注意：** データベーススキーマ（`pgcrypto`などの必要な拡張機能を含む）は、TomoriBotを初めて実行すると自動的に初期化されます。

### インストール

1. **リポジトリをクローン**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **依存関係をインストール**
   ```sh
   bun install
   ```

### 設定

**環境ファイル** `.env`を作成し、必要な変数を入力します：
   ```
    # Discord Bot Configuration (必須)
    DISCORD_TOKEN=your_discord_bot_token_here

    # Security (必須)
    CRYPTO_SECRET=your_32_character_crypto_secret_here

    # Database Configuration (必須)
    POSTGRES_HOST=localhost
    POSTGRES_PORT=5432
    POSTGRES_USER=your_username
    POSTGRES_PASSWORD=your_password
    POSTGRES_DB=your_dbname

    # Bot Configuration (オプション)
    DEFAULT_BOTNAME=Tomori
    DEFAULT_BOTNAME_JP=ともり
    BASE_TRIGGER_WORDS=tomori,tomo,トモリ,ともり

   ```

**必須変数：**
- **DISCORD_TOKEN**: [Discord Developer Portal](https://discord.com/developers/applications)からのDiscordボット認証トークン
- **CRYPTO_SECRET**: データベースに保存されるAPIキーを暗号化するための32文字の秘密鍵
- **POSTGRES_HOST**: PostgreSQLサーバーのホスト名（デフォルト：`localhost`）
- **POSTGRES_PORT**: PostgreSQLサーバーのポート（デフォルト：`5432`）
- **POSTGRES_USER**: PostgreSQLデータベースのユーザー名
- **POSTGRES_PASSWORD**: PostgreSQLデータベースのパスワード
- **POSTGRES_DB**: PostgreSQLデータベース名

調整可能な追加のオプション変数については、リポジトリの`.env.example`ファイルを確認してください。

### TomoriBotの起動

設定が完了したら、ボットを起動します：

```sh
# ホットリロード付き開発モード
bun run dev
```

ボットは自動的に以下を実行します：
- データベーススキーマと必要な拡張機能の初期化
- ローカライゼーションファイルの読み込み
- Discordへの接続
- スラッシュコマンドの登録

ログにエラーがなく`TomoriBot up and running!`と表示されたら、ボットはオンラインで使用可能です。

#### 基本コマンド

- `/config setup` - サーバーの初期ボットセットアップ
- `/config` - TomoriBotを調整するための複数の方法
- `/teach` - TomoriBotにメモリーを追加
- `/forget` - TomoriBotからメモリーを削除
- `/server` - TomoriBotの権限を追加/削除

#### チャットインタラクション

サーバーでボットをメンションするか、設定されたトリガーワードを使用して会話を開始します：
```
@TomoriBot よー何してるー
```

または、TomoriBotのDMに入って挨拶してください！

### 代替方法：Docker Compose

コンテナ化されたデプロイを希望する場合、手動セットアップの代わりにDocker Composeを使用できます：

**Docker Composeに必要な.env変数：**
- `DISCORD_TOKEN` - Discordボットトークン
- `CRYPTO_SECRET` - 32文字の暗号化キー
- `POSTGRES_PASSWORD` - データベースパスワード（他のDB設定は自動設定されます）

```sh
# TomoriBotのコンテナをビルド（初回またはコード変更後）
docker compose build

# TomoriBotとデータベースを起動（docker-compose.yamlを使用）
docker compose up
```

**注意：** Docker Composeはデータベース接続を自動的に設定します。PostgreSQLサービスは開発モード（SSLなし）で実行され、内部Dockerネットワークに接続します。

#### Grafanaでのモニタリング（オプション）

GrafanaダッシュボードでTomoriBotインスタンスをモニタリングするには：

```sh
# TomoriBotとGrafanaを一緒に起動
docker compose -f docker-compose.yaml -f docker-compose.monitor.yaml up
```

これにより以下が実行されます：
- TomoriBotとPostgreSQLを起動（DBはポート15432）
- Grafanaをポート3000で起動し、PostgreSQLデータソースを自動設定
- 両方のサービスを同じDockerネットワークで接続

`http://localhost:3000`でGrafanaにアクセス：
- **ユーザー名**: `admin`
- **パスワード**: `.env`の`GRAFANA_PASSWORD`で設定（デフォルトは`admin`）

PostgreSQLデータソースは自動的に設定され、ボットのメトリクス、データベースクエリ、パフォーマンスをモニタリングするためのダッシュボード作成の準備が整います。

<!-- ROADMAP -->
## ロードマップ

- [x] コアAIチャット機能
- [x] メモリーシステムの実装
- [x] スラッシュコマンド構造
- [x] 多言語サポート（ロケールシステム）
- [x] 複数プロバイダーサポート
- [ ] TomoriBot Wiki（ローカルセットアップとロケール貢献用）
- [ ] AI生成プレースホルダーアセットの置き換え
- [ ] 画像/動画生成機能
- [ ] KoboldCPP統合（ローカルのみ）
- [ ] ボイスチャンネル統合
- [ ] 設定用Webダッシュボード
- [ ] 技術的でないユーザーが独自のTomoriBotをホストできる「簡単インストール」ファイルの作成

提案された機能と既知の問題の完全なリストについては、[open issues](https://github.com/Bredrumb/TomoriBot/issues)を参照してください。

<!-- CONTRIBUTING -->
## コントリビュート

TomoriBotはまだベータ版のため、どんなコントリビュートでも**大歓迎**です。特に多言語対応のためのローカライゼーションは非常に助かります。

新しい言語翻訳を追加するには：

1. **ロケールファイルを作成** `src/locales/`に[Discordロケールコード](https://discord.com/developers/docs/reference#locales)に従ってファイルを作成（例：`es-ES.ts`はスペイン語、`fr.ts`はフランス語、`ko.ts`は韓国語）

2. **構造をミラーリング** 基準ファイル[`src/locales/en-US.ts`](src/locales/en-US.ts)の構造に従う：
   - すべてのキーとネストされたオブジェクトをコピー
   - `{variable}`のようなプレースホルダーを保持したまま、ユーザー向けテキストをすべて翻訳

3. **プリセット翻訳を追加**（オプションですが推奨） `src/db/seed.sql`に：
   - 各プリセットの`tomori_preset_desc`フィールドを翻訳
   - `preset_attribute_list`、`preset_sample_dialogues_in`、`preset_sample_dialogues_out`配列を翻訳
   - `llm_description`フィールドを翻訳してLLM説明を追加（`ja_description`の既存パターンに従う）
   - `preset_language`をあなたのロケールコードに設定

4. **翻訳をテスト**：
   ```sh
   # すべてのロケールキーがファイル間で一致することを確認
   bun run check-locales
   ```

5. **プルリクエストを送信** 新しいロケールファイルとseed.sqlへの追加内容を含めて


<!-- LEGAL -->
## 法的事項とライセンス

公式ホスティング版TomoriBotインスタンスのユーザー向け：
- **[利用規約](legal/en-US/terms-of-service.md)** - ボット使用のルールとガイドライン
- **[プライバシーポリシー](legal/en-US/privacy-policy.md)** - データの取り扱いについて

これらのドキュメントは、Discord内で`/legal terms`および`/legal privacy`コマンドを使用してもアクセスできます。TomoriBotをセルフホスティングしている場合、これらのドキュメントは参考テンプレートとして機能します。あなた自身のデータパイプラインを管理し、GNU Affero General Public License v3.0の下でのデプロイのコンプライアンスに責任を負います。

<!-- CONTACT -->
## 連絡先

**プロジェクトリンク**: [https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)

**Email**: bredrumb@gmail.com

**Discord**: [公式サポートサーバー](https://discord.gg/bjCfHm9QsB)


<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/
