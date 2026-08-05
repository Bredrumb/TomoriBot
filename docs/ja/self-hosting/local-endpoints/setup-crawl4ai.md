---
title: "セットアップ: Crawl4AI (サイドカー)"
sidebar:
  order: 4
---
# セットアップ: Crawl4AIサイドカー

`fetch_url`ツールは、デフォルトでプロセス内の`safe_http`エンジンを使用します。JSを多用するページでレンダリングされたコンテンツが必要な場合、信頼された開発環境でのみブラウザレンダリングサイドカーをオプションで使用できます。

デフォルトのエンジンの順序は`safe_http`です。Crawl4AIはTomoriBotの保護されたHTTPクライアント外でリダイレクトを追跡するため、プライベートネットワーク取得が許可されている場合にのみ使用されます。本番環境以外では自動的に許可され、設定は不要です。本番環境では明示的な`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`のオプトインが必要ですが、推奨しません。

Crawl4AIは、ブラウザでレンダリングされたマークダウンサイドカーです。Playwrightベースのヘッドレスブラウザを実行し、独自のコンテンツフィルターを使用してLLMフレンドリーなマークダウンをサーバー側で抽出します。TomoriBot側での後処理は必要ありません。

Crawl4AIのセットアップパスを1つ選択してください。

### A. Docker Compose (TomoriBotをDockerで実行する場合)

リポジトリのDocker ComposeスタックでTomoriBotを実行している場合は、このパスを使用します。まず、`.env`に`CRAWL4AI_BASE_URL=http://crawl4ai:11235/`と`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`を設定します。本番環境以外ではプライベートネットワークのオプトインは不要です。このスタックを`RUN_ENV=production`で実行する場合のみ`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`を追加してください。

次に、以下で起動します。

```sh
docker compose --profile fetch-crawl4ai up -d
```

これにより、TomoriBotのDockerネットワーク上でCrawl4AIサイドカーを含むComposeスタックが開始されます。

TomoriBotを`bun run dev`で直接実行している場合は、代わりに以下のスタンドアロンパスを使用してください。

SearXNGサイドカーも必要な場合は、プロファイルをチェーンします。

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Crawl4AIのAPIトークン認証を有効にする場合は、`.env`に`CRAWL4AI_TOKEN`を設定します。Composeはそれを`CRAWL4AI_API_TOKEN`としてコンテナに渡し、TomoriBotはそれをベアラートークンとして送信します。

---

### B. スタンドアロンDocker (`bun run dev`を実行する場合)

まず、ボットがホストの公開されたコンテナポートに接続するように、`.env`に`CRAWL4AI_BASE_URL=http://localhost:11235/`と`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`を設定します。本番環境以外ではプライベートネットワークのオプトインは不要です。`RUN_ENV=production`で実行する場合のみ`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`を追加してください。

次に、TomoriBotを`bun run dev`で直接実行する代わりに、`bun run launch --crawl4ai`を使用します。これにより、コンテナのライフサイクルが自動的に処理され、サイドカーが正常になるのを待ってからボットが起動します。

```sh
bun run launch --crawl4ai
```

SearXNGサイドカーも必要な場合:

```sh
bun run launch --searxng --crawl4ai
```

コンテナを自分で管理したい場合は、`.env`の`CRAWL4AI_BASE_URL=http://localhost:11235/`を維持したまま、以下を実行します。

**PowerShell:**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash (Linux/macOS):**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

サイドカーを保護する場合は、`docker run`に`-e CRAWL4AI_API_TOKEN=your_token`を渡し、`.env`に`CRAWL4AI_TOKEN=your_token`を設定します。

その後、コンテナが正常に動作したら（`docker ps`で`(healthy)`と表示されたら）、`bun run dev`を実行します。

---

### C. ブラウザサイドカーなし

`CRAWL4AI_BASE_URL`は設定しないでください。`fetch_url`ツールは保護された`safe_http`エンジンを使用します。

---

## 起動順序 (重要)

TomoriBotは、**起動後の最初の`fetch_url`呼び出し**でサイドカーのヘルスをプローブし、その結果を60秒間キャッシュします。その最初のプローブが実行されたときにコンテナの準備ができていない場合、ボットは次の1分間、コンテナが利用できないものとして扱います。

スタンドアロンDockerの場合、TomoriBotを起動する前にサイドカーコンテナを起動してください。`bun run launch --crawl4ai`はすでにこれを自動で行います。

### 初回セットアップ

1. コンテナを起動し、`docker ps`で`(healthy)`と表示されるまで待ちます。
   ```powershell
   docker ps
   ```
2. 上記のセットアップパスの値を使用して、`.env`に`CRAWL4AI_BASE_URL`を設定します。
3. TomoriBotを起動します（`bun run dev`または`docker compose up`）。

### 再起動後の復帰

以前の実行でコンテナがすでに存在する場合は、名前の競合を避けるために`docker run`の代わりに`docker start`を使用してください。

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

その後、通常通りTomoriBotを起動します。`bun run dev`を再起動すると、メモリ内のヘルスキャッシュがリセットされるため、コンテナの準備が先にできていれば、正しいエンジンがすぐにピックアップされます。

---

## Cookieの注入 (認証済みフェッチ：オプション)

Crawl4AIは、ページをフェッチする際にヘッドレスブラウザがすでにログインしているように見せるために、ブラウザレベルのCookieの注入をサポートしています。これは、コンテンツを表示するためにセッションが必要なサイト（ペイウォールのニュース、プライベートフォーラム、ログインで保護されたダッシュボードなど）に役立ちます。

`safe_http`フォールバックはCookieの注入をサポートして**いません**。CookieはCrawl4AIがアクティブな場合にのみ適用されます。

> **制限事項:** Cookieの注入はログインの壁をバイパスしますが、ボットのフィンガープリントはバイパスしません。積極的なボット検出（特にTwitter/X）を行うサイトは、キャンバス/WebGLのフィンガープリントを通じてヘッドレスPlaywrightを検出し、有効なセッションCookieがあっても空のページを提供します。Cookieの注入は、認証のみで制限をかけているサイトでうまく機能します。

### Cookieの取得

1. ブラウザを開き、ターゲットサイトにログインします。
2. 開発者ツール（`F12`）→ **アプリケーション**タブ → **ストレージ** → **Cookie** → サイトのドメインを選択します。
3. 必要な各Cookieの`Value`（通常はセッショントークン：サイトのCookie名を確認してください）をコピーします。

### Crawl4AI

`.env`で`CRAWL4AI_COOKIES_JSON`をJSON配列として設定します。

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

これが設定されると、`fetch_url`は自動的に`/md`エンドポイントから`browser_config.cookies`を使用した`/crawl`に切り替わります。`/md`はCookieの注入をサポートしていません。

### Cookieオブジェクトのフィールド

| フィールド | 必須 | 説明 |
|---|---|---|
| `name` | はい | Cookie名 |
| `value` | はい | Cookie値 |
| `domain` | いいえ | ドメインのスコープ（例: `.x.com`）。正確性を期すために推奨されます。 |
| `path` | いいえ | パスのスコープ。省略した場合、デフォルトは`/`になります。 |

> **注意:** Cookieの値は機密情報です。パスワードのように扱ってください。これらはあなたのアカウントへの完全なセッションアクセスを許可します。`.env`をバージョン管理にコミットしないでください。

---

## エンジンの順序と環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未設定 | 設定するとCrawl4AIが有効になります。Docker Composeからは`http://crawl4ai:11235/`を使用し、TomoriBotがマシンで直接実行されている場合は`http://localhost:11235/`を使用します。 |
| `CRAWL4AI_TOKEN` | 未設定 | オプションのベアラートークン。有効にする場合は、Crawl4AIコンテナの`CRAWL4AI_API_TOKEN`と一致する必要があります。 |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | コンマ区切りのエンジンリスト。`safe_http`は常に最終フォールバックとして追加され、従来の`mcp_fetch`名はそのエイリアスです。プライベートネットワーク取得が許可されていない場合（オプトインなしの本番環境）、Crawl4AIは無視されます。 |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AIおよびURLフェッチサイドカーのエンジンごとのリクエストタイムアウト。 |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 続きを取得する必要が生じる前に、1回のフェッチで返す最大文字数。 |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | Crawl4AIのヘルスプローブ結果が再チェックされる前にキャッシュされる時間。 |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 本番環境専用のオプトイン。本番環境以外（`RUN_ENV` != `production`）ではSSRFガードが自動的に緩和されるため、localhost/プライベート/内部URLの取得とCrawl4AIディスパッチは設定なしで機能します。信頼された本番環境でプライベートネットワーク取得を許可する場合のみ`true`に設定してください。 |
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AIの`/md`フィルターモード。`fit`はLLMで使用するためにマークダウンをクリーンに保ちます。`fetch_url(..., raw=true)`はリクエストごとにこれをオーバーライドします。 |
