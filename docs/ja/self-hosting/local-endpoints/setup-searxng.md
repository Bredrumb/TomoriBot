---
title: "セットアップ: SearXNG (サイドカー)"
sidebar:
  order: 3
---

`web_search`ツールは、**Brave → SearXNG → DuckDuckGo → Felo**のエンジンチェーンを通じてルーティングします。独自のSearXNGインスタンスを実行することで、単一エンジンのレート制限やスクレイピングの破損を回避し、`science`、`it`、`files`、`music`といったSearXNG専用のカテゴリーを利用できるようになります。

SearXNGのセットアップパスを1つ選択してください。

### A. Docker Compose (TomoriBotをDockerで実行する場合)

リポジトリのDocker ComposeスタックでTomoriBotを実行している場合は、このパスを使用します。その後、`searxng`プロファイルで実行します。

```sh
docker compose --profile searxng up -d
```
これにより、TomoriBotと一緒に`searxng`サービスが開始されます：ボットは自動的に`http://searxng:8080/`でアクセスします。

TomoriBotを`bun run dev`で直接実行している場合は、代わりに以下のスタンドアロンパスを使用してください。

本番環境を使用している場合は、`.env`の`SEARXNG_SECRET`に任意の32文字以上の文字列を設定します（開発環境では自動的にデフォルト値が設定されます）。

---

### B. スタンドアロンDocker (`bun run dev`を実行する場合)
まず、ボットが接続先を認識できるように、`.env`に`SEARXNG_BASE_URL=http://localhost:8080/`を設定します。

次に、TomoriBotを`bun run dev`で直接実行する代わりに、`bun run launch --searxng`を使用します。これにより、コンテナのライフサイクルが自動的に処理され、コンテナが正常になるのを待ってからボットが起動します。

```sh
bun run launch --searxng
```

コンテナを自分で管理したい場合は、`.env`の`SEARXNG_BASE_URL=http://localhost:8080/`を維持したまま、以下を実行します。

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:rw" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  -v "${PWD}/servers/searxng:/etc/searxng:rw" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng:latest
```

その後、コンテナが正常に動作したら（`docker ps`で`(healthy)`と表示されたら）、`bun run dev`を実行します。

---

### C. SearXNGなし
`SEARXNG_BASE_URL`は設定しないでください：チェーンは以前とまったく同じように`Brave → DDG → Felo`にフォールバックします。何も壊れません。

SearXNGサイドカーが設定されていない場合、組み立てられた`web_search`スキーマはSearXNG専用カテゴリーをアドバタイズしなくなります。Braveが設定されている場合は一般的なカテゴリー（`text`、`image`、`video`、`news`）が引き続き表示され、DDG/FeloのMCPフォールバックのみが利用可能な場合はテキストのみの検索が表示されます。

---

## 画像検索結果の調整

SearXNGの画像結果はHEAD検証され、オプションで圧縮され、Discordの添付ファイルとして投稿されます：これはBrave画像と同一のUXです。すべての候補URLが検証に失敗した場合、SearXNGはハードエラーの代わりに画像リンクのテキストリストを返します。

| 変数 | デフォルト | 説明 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (最大10) | Discordに送信される有効な画像の数。LLMの`count`引数によってオーバーライドされます。 |
| `SEARXNG_IMAGE_POOL` | `10` | LLMが`count`を指定しない場合の候補URLプール。`count`が指定された場合、プールは`count × 3`（最大30に制限）になり、直リンク保護による失敗を吸収します。 |
| `IMAGE_MIN_SIZE_BYTES` | `5120` (5 KB) | このサイズ未満の画像は拒否されます：プレースホルダー/エラー画像をフィルタリングします。Brave画像検索と共有されます。 |
| `WEB_SEARCH_TIMEOUT_MS` | — | エンジンごとのリクエストタイムアウト。 |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | `60` | ヘルスプローブ結果が再チェックされる前にキャッシュされる時間。 |

*(すべての調整可能な項目については `.env.optional.example` を参照してください。)*
