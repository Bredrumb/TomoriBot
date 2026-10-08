---
title: "セットアップ: Crawl4AI"
sidebar:
  order: 4
---

ローカルの [Crawl4AI](https://github.com/unclecode/crawl4ai) サーバーを使用して、JavaScriptを多用したWebページをTomoriBotのクリーンなMarkdownにレンダリングします。

組み込みの`fetch_url`ツールは、デフォルトで軽量の`safe_http`エンジンを使用します。Crawl4AIは、ボットにMarkdownを返す前に、クライアント側スクリプトを実行してページコンテンツを抽出する、オプションのヘッドレスPlaywrightブラウザを追加します。

Crawl4AIは、TomoriBotの保護されたHTTPクライアントの外部のリダイレクトに従うため、プライベートネットワークのフェッチが許可されている場合にのみ許可されます。本番環境 (`RUN_ENV` != `production`) の外では、プライベートネットワークのフェッチが自動的に有効になります。運用環境では、`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`を設定する必要があります。

セットアップパスを選択します。

### オプションA: Docker Compose (TomoriBotがDockerで実行される場合)

リポジトリのDocker ComposeスタックでTomoriBotを実行する場合は、このパスを使用します。まず、`.env`に`CRAWL4AI_BASE_URL=http://crawl4ai:11235/`と`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`を設定します。外部運用ではプライベートネットワークのオプトインは必要ありません。このスタックを`RUN_ENV=production`で実行する場合のみ、`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`を追加してください。

次に、以下から始めます。

```sh
docker compose --profile fetch-crawl4ai up -d
```

これにより、TomoriBotのDockerネットワーク上のCrawl4AIコンテナを使用してComposeスタックが開始されます。

TomoriBotを`bun run dev`とともに直接実行する場合は、代わりに以下のスタンドアロンパスを使用してください。

SearXNGも必要な場合は、プロファイルをチェーンします。

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Crawl4AI APIトークン認証を有効にする場合は、`.env`に`CRAWL4AI_TOKEN`を設定します。Composeはそれを`CRAWL4AI_API_TOKEN`としてコンテナに渡し、TomoriBotはそれをベアラー トークンとして送信します。

---

### オプションB: スタンドアロンDocker (`bun run dev`実行時)

まず、`.env`に`CRAWL4AI_BASE_URL=http://localhost:11235/`と`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`を設定して、ボットがホストが公開するコンテナー ポートに接続するようにします。外部運用ではプライベートネットワークのオプトインは必要ありません。`RUN_ENV=production`で実行する場合のみ、`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`を追加してください。

次に、TomoriBotを`bun run dev`で直接実行する代わりに、`bun run launch --crawl4ai`を使用します。これにより、コンテナーのライフサイクルが自動的に処理され、サーバーが正常になるまで待機してからボットが開始されます。

```sh
bun run launch --crawl4ai
```

SearXNGも必要な場合:

```sh
bun run launch --searxng --crawl4ai
```

コンテナーを自分で管理したい場合は、`CRAWL4AI_BASE_URL=http://localhost:11235/`を`.env`に保持して、次を実行します。

パワーシェル:

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

コンテナを確保したら、`-e CRAWL4AI_API_TOKEN=your_token`を`docker run`に渡し、`.env`に`CRAWL4AI_TOKEN=your_token`を設定します。

次に、コンテナーが正常になったら、`bun run dev`を実行します (`docker ps`は`(healthy)`を示します)。

---

### オプションC: ブラウザレンダリングサーバーなし

`CRAWL4AI_BASE_URL`は未設定のままにしておきます。`fetch_url`ツールは、保護された`safe_http`エンジンを使用します。

---

## スタート順

TomoriBotは、起動後の最初の`fetch_url`呼び出しでサーバーの健全性を調査し、結果を60秒間キャッシュします。最初のプローブが起動されたときにコンテナーの準備ができていない場合、ボットはそのコンテナーを次の1分間使用できないものとして扱います。

スタンドアロンDockerの場合は、TomoriBotを起動する前にCrawl4AIコンテナを起動します。`bun run launch --crawl4ai`がすでにこれを行っています。

### 初回セットアップ

1. コンテナを起動し、`docker ps`に`(healthy)`が表示されるまで待ちます。
   ```powershell
   docker ps
   ```
2. 上記のセットアップパスの値を使用して、`.env`に`CRAWL4AI_BASE_URL`を設定します。
3. TomoriBot (`bun run dev`または`docker compose up`) を開始します。

### 再起動後に戻る

コンテナーが以前の実行で既に存在する場合は、名前の競合を避けるために、`docker run`の代わりに`docker start`を使用します。

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

次に、通常どおりTomoriBotを起動します。`bun run dev`を再起動すると、メモリ内のヘルスキャッシュがリセットされるため、最初にコンテナーの準備ができている限り、正しいエンジンがすぐに選択されます。

---

## クッキーの注入

Crawl4AIはブラウザレベルのCookieの挿入をサポートしているため、ページを取得するときにヘッドレスブラウザがすでにログインしているように見えます。これは、コンテンツを表示するためにセッションが必要なサイト (ペイウォールで保護されたニュース、プライベートフォーラム、ログインゲートされたダッシュボードなど) に役立ちます。

`safe_http`フォールバックはCookieインジェクションをサポートしていません。Cookieは、Crawl4AIがアクティブな場合にのみ適用されます。

:::note[Bot detection limits]
Cookieインジェクションはログインウォールをバイパスしますが、ボットのフィンガープリンティングはバイパスしません。積極的なアンチボット検出を備えたサイト (特にTwitter/X) は、キャンバス/WebGLフィンガープリンティングを介してヘッドレスPlaywrightを検出し、有効なセッションCookieがある場合でも空のページを提供します。Cookieインジェクションは、認証のみをゲートするサイトに適しています。
:::

### Cookieを取得する

1. ブラウザを開いて、対象のサイトにログインします。
2. DevTools (`F12`) > `Application`タブ > `Storage` > `Cookies` > サイトのドメインを選択します。
3. 必要な各Cookieの`Value`をコピーします (通常はセッショントークン。サイトのCookie名を確認してください)。

### Crawl4AI

`.env`の`CRAWL4AI_COOKIES_JSON`をJSON配列として設定します。

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

これを設定すると、`fetch_url`は、`/md`エンドポイントから`browser_config.cookies`を使用する`/crawl`に自動的に切り替わります。`/md`はCookieインジェクションをサポートしていません。

### Cookieオブジェクトのフィールド

| 分野 | 必須 | 説明 |
|---|---|---|
| `name` | はい | クッキー名 |
| `value` | はい | クッキーの値 |
| `domain` | いいえ | ドメインスコープ (例: `.x.com`)。正確さのために推奨されます。|
| `path` | いいえ | パスのスコープ。省略した場合のデフォルトは`/`です。|

:::caution[Protect session tokens]
Cookieの値は機密性が高いため、パスワードと同様に扱ってください。これらにより、アカウントへの完全なセッションアクセスが許可されます。`.env`をバージョン管理にコミットしないでください。
:::

---

## エンジンの順序と環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 設定を解除する | 設定すると、Crawl4AIが有効になります。Docker Composeから`http://crawl4ai:11235/`を使用するか、TomoriBotがマシン上で直接実行されている場合は`http://localhost:11235/`を使用します。|
| `CRAWL4AI_TOKEN` | 設定を解除する | オプションのベアラートークン。有効な場合は、Crawl4AIコンテナ上の`CRAWL4AI_API_TOKEN`と一致する必要があります。|
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | カンマ区切りのエンジンリスト。`safe_http`は常に最終フォールバックとして追加されます。従来の`mcp_fetch`名はエイリアスになります。プライベートネットワークのフェッチが許可されていない場合 (オプトインなしの運用)、Crawl4AIエントリは無視されます。|
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AIおよびその他のURLフェッチエンジンのエンジンごとのリクエストタイムアウト。|
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 継続が必要になる前に1回のフェッチ呼び出しで返される最大文字数。|
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 本番環境のみのオプトイン。運用環境外 (`RUN_ENV` != `production`) では、SSRFガードが自動的に緩和されるため、localhost/private/internalフェッチとCrawl4AIディスパッチはセットアップなしで機能します。`true`は、信頼できる運用環境でプライベートネットワークのフェッチを許可するようにのみ設定します。|
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md`フィルター モード。`fit`は、LLMの使用のためにマークダウンをクリーンに保ちます。`fetch_url(..., raw=true)`はリクエストごとにこれをオーバーライドします。|
