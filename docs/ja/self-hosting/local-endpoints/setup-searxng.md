---
title: "セットアップ: SearXNG"
sidebar:
  order: 3
---

`web_search`ツールは、**Brave → SearXNG → DuckDuckGo → IAsk**のエンジンチェーンを通じてルーティングします。独自のSearXNGインスタンスを実行することで、単一エンジンのレート制限やスクレイピングの破損を回避し、`science`、`it`、`files`、`music`といったSearXNG専用のカテゴリーを利用できるようになります。

SearXNGのセットアップパスを1つ選択してください。

### A. Docker Compose (TomoriBotをDockerで実行する場合)

リポジトリのDocker ComposeスタックでTomoriBotを実行している場合は、このパスを使用します。その後、`searxng`プロファイルで実行します。

```sh
docker compose --profile searxng up -d
```
開始前に`.env`に`SEARXNG_BASE_URL=http://searxng:8080/`を設定します。プロファイルが無効な場合は設定しません。

TomoriBotを`bun run dev`で直接実行している場合は、代わりに以下のスタンドアロンパスを使用してください。

署名キー用の別のランダムな値を`.env`の`SEARXNG_SECRET`に設定します。

---

### B. スタンドアロンDocker (`bun run dev`を実行する場合)
まず、ボットが接続先を認識できるように、`.env`に`SEARXNG_BASE_URL=http://localhost:8080/`を設定します。

次に、TomoriBotを`bun run dev`で直接実行する代わりに、`bun run launch --searxng`を使用します。これにより、コンテナのライフサイクルが自動的に処理され、コンテナが正常になるのを待ってからボットが起動します。

```sh
bun run launch --searxng
```

コンテナを自分で管理したい場合は、`.env`の`SEARXNG_BASE_URL=http://localhost:8080/`を維持したまま、以下を実行します。

先にリポジトリのイメージをビルドします。このイメージがJSON検索の設定を読み込み、署名キーを設定します。

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

その後、コンテナが正常に動作したら（`docker ps`で`(healthy)`と表示されたら）、`bun run dev`を実行します。
コンテナ環境に`SEARXNG_SECRET`がない場合、イメージは一時的な署名キーを生成します。

---

### C. SearXNGなし
`SEARXNG_BASE_URL`を設定しない場合、チェーンは`Brave → DuckDuckGo → IAsk`にフォールバックします。

SearXNGサーバーが設定されていない場合、組み立てられた`web_search`スキーマはSearXNG専用カテゴリーをアドバタイズしなくなります。Braveが設定されている場合は一般的なカテゴリー（`text`、`image`、`video`、`news`）が引き続き表示され、DuckDuckGo/IAskのMCPフォールバックのみが利用可能な場合はテキストのみの検索が表示されます。

---

## 画像検索結果の調整

SearXNGの画像結果はHEAD検証され、オプションで圧縮され、Discordの添付ファイルとして投稿されます：これはBrave画像と同一のUXです。すべての候補URLが検証に失敗した場合、SearXNGはハードエラーの代わりに画像リンクのテキストリストを返します。

| 変数 | デフォルト | 説明 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3`（最大10） | Discordに送信される有効な画像の数。LLMの`count`引数によってオーバーライドされます。 |
| `SEARXNG_IMAGE_POOL` | `10` | LLMが`count`を指定しない場合の候補URLプール。`count`が指定された場合、プールは`count × 3`（最大30に制限）になり、直リンク保護による失敗を吸収します。 |
| `WEB_SEARCH_TIMEOUT_MS` | なし | エンジンごとのリクエストタイムアウト。 |

*（すべての調整可能な項目については`.env.optional.example`を参照してください。）*
