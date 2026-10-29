---
title: "セットアップ: ローカルLLM"
aiGenerated: false
sidebar:
  label: "ローカルLLM"
  order: 1
---

TomoriBotは、テキスト生成や埋め込みに任意のOpenAI互換ローカルLLMサーバーを使用できます。

:::note[環境変数は不要です]
ローカルモデルはDiscordのスラッシュコマンドを通じて登録され、データベースに暗号化されて保存されます。これらを設定する `.env` はありません。
[ローカルエンドポイントハブ](/self-hosting/local-endpoints/) を参照してください。
:::

## 1. モデルサーバーを実行する

このガイドでは、最も簡単に始められるOllamaを例としてプロセスを説明しますが、すでにより技術的なユーザーであれば、好きなものを自由に使用できます！

[Ollama](https://ollama.com) をインストールします。以下の例ではGoogleのGemma 4を使用していますが、[Ollamaのライブラリ](https://ollama.com/library) にあるものであれば何でも機能します。

### どのサイズをプルすべきか？
<!-- anchor: which-size-should-i-pull -->

ローカルモデルは、GPUのVRAM（システムRAMとは別の、グラフィックカードに組み込まれたメモリ）で実行されます。経験則として、モデルは少なくともダウンロードサイズ分の空きVRAMと、会話コンテキスト用に約1-2 GBのヘッドルームを必要とします。カードに収まる最大のGemma 4を選択してください：

| あなたのGPU VRAM | 最適なサイズ | ダウンロード（概算） |
|---|---|---|
| 約8 GB | `gemma4:e2b` | 7.2 GB |
| 約12 GB | `gemma4:12b` | 7.6 GB |
| 約16 GB | `gemma4:12b`（完全に収まる）、または `gemma4:26b` | 7.6 / 18 GB |
| 24 GB以上 | `gemma4:26b` または `gemma4:31b` | 18 / 20 GB |

ダウンロードサイズはOllamaのデフォルトの量子化サイズです。正確な数値については [モデルページ](https://ollama.com/library/gemma4) を参照してください。VRAMがどれくらいあるかわからない場合、Windowsでは `タスク マネージャー` > `パフォーマンス` > `GPU` で「専用 GPU メモリ」を確認してください。

選択したサイズをプルし、サーバーを起動します：

```sh
ollama pull gemma4:12b     # swap for the tag that fits your VRAM
ollama serve               # listens on http://127.0.0.1:11434
```

TomoriBotが実行されているマシンから到達可能であることを確認してください：

```sh
curl http://127.0.0.1:11434/v1/models
```

登録するモデル名となるため、インストールされている正確なタグをメモしておきます：

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Discordに登録する

`/providers`（サーバー全体）または `/personal providers`（自分のみ）を実行し、`+ 新しいカスタムエンドポイントを追加` を選んで、以下を入力します：

| フィールド | Ollama用の値 |
|-------|------------------|
| `endpoint_label` | 選択した名前（例：`home-ollama`） |
| API互換性 | `OpenAI-Compatible`（推奨）または `Ollama` |
| `endpoint_url` | OpenAI-Compatibleの場合は `http://127.0.0.1:11434/v1` · Ollamaの場合は `http://127.0.0.1:11434` |
| `auth_token` | *（空白のままにします）* |

:::tip[API互換性に一致するURLを選択する]
`OpenAI-Compatible` と `Ollama` はどちらも `/v1` のないルートを受け入れ、`/v1` ベースに正規化されます。`/chat/completions` は自動的に追加されるため、追加しないでください。`https://openrouter.ai/api/v1` やゲートウェイのプレフィックスなど、すでにパスを含むURLはそのまま保存されます。
:::

接続を保存したら、それを選択し、モデルのドロップダウンから `+ 新しいテキストモデルを追加` を選びます。以下を入力してください：

- **モデル名（正確なAPI ID）：** `gemma4:12b`、`ollama list` で確認した正確なタグ。
- **コンテキストウィンドウ上書き：** オプション、Ollama / KoboldCPPのみ。これ（例：`8192`、`16384`）を設定してOllamaのデフォルトの `num_ctx` を引き上げます。設定しないと、TomoriBotの長いコンテキストが切り捨てられるほど小さくなります。サーバーのデフォルトを使用する場合は空白のままにします。
- **切り替え：** モデルが関数呼び出しをサポートしている場合は `ツール呼び出し` を有効にします。ビジョンモデルの場合のみ `画像入力` を有効にし、モデルがJSONスキーマを適切に処理する場合は `構造化出力` を有効にします。この例のGemma 4はこれらすべてをサポートしているため、すべてにチェックを入れます。

TomoriBotは保存時に接続を検証します。エンドポイントに到達できないと報告された場合、通常の原因は `localhost`/Dockerの不一致、または欠落/余分な `/v1` です（[注意事項と落とし穴](#notes--gotchas) を参照）。

モデルを追加すると、自動的にアクティブな `text` モデルになります。チャットを始めて試してみてください。何らかの理由でアクティブになっていない場合は、`/config` > モデル > モデルの切り替え を実行し、新しく登録したモデルを選択してください。

## 3.（オプション）RAG用のローカル埋め込み

保存したエンドポイントを選択し、モデルのドロップダウンから埋め込みモデルを追加します（例：`ollama pull nomic-embed-text`、モデル名 `nomic-embed-text:latest`）。RAG機能にはPostgresに `pgvector` がインストールされている必要もあります。[手動セットアップ](/self-hosting/manual-setup/) ガイドをここで確認できます。

## 4.（オプション）ComfyUIとGPUを共有する
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

テキストモデルとComfyUIが同じGPUで動作する場合、ComfyUIの画像または動画ジョブの実行中にTomoriBotがテキストモデルをアンロードできます。ジョブ中に届いたテキストの返信は、GPUが再び空くまで待機します。

保存したエンドポイントを開き、`エンドポイントを編集` を押し、`エンドポイントの動作` にある `ComfyUIジョブ中にモデルをアンロード` にチェックを入れます。保存時にTomoriBotがURLにあるサーバーを確認します：

- **Ollama：** インストールした状態でそのまま動作します。ジョブの前にTomoriBotがOllamaにモデルのアンロードを要求し、次のテキストリクエスト時にOllamaが再ロードします。
- **KoboldCpp：** `--admin` と `--admindir` を指定してKoboldCppを起動し、エンドポイントの認証トークンに管理者パスワードを設定します。TomoriBotはKoboldCppの管理リロードAPIを使用してモデルをアンロードし、完了後に再びロードします。

その他のサーバーは保存時に拒否されます。汎用のOpenAI互換サーバーにはモデルをアンロードする共通の方法がないためです。

## その他のサーバー
<!-- anchor: other-servers -->

TomoriBotは任意のOpenAI互換エンドポイントをサポートしていますが、以下のサーバーが推奨されます。これらはすべて同じフローを使用し、URLといくつかの注意事項のみが異なります。

### KoboldCPP

- OpenAI互換を有効にして起動します（組み込み）。デフォルト：`http://127.0.0.1:5001/v1`。
- API互換性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:5001/v1`。
- Ollamaと同様に `コンテキストウィンドウ上書き` を尊重します。
- ComfyUIジョブ中にモデルをアンロードするには、`--admin` と `--admindir` も指定して起動します（[ComfyUIとGPUを共有する](#4-optional-share-one-gpu-with-comfyui) を参照）。
- GGUFモデルを読み込みます。モデル名は、読み込まれたモデルが報告するもの（多くの場合ファイル名の語幹）です。KoboldCPPの `/v1/models` レスポンスを確認してください。

### llama.cpp（`llama-server`）

- [llama.cpp](https://github.com/ggml-org/llama.cpp) をビルドまたはインストールし、同梱されているOpenAI互換サーバーでGGUFを提供します：
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API互換性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8080/v1`。
- 起動時に `-c` でコンテキストウィンドウを設定します。モーダルの `コンテキストウィンドウ上書き` はOllama/KoboldCPP専用であり、ここでは効果がありません。
- モデル名は `/v1/models` が報告するものです。`--alias my-model` でわかりやすい名前を付けてください。
- `--api-key` で起動した場合は、そのキーを `auth_token` に入力します。

### LM Studio

- LM Studioで、`Local Server`（`Developer` タブ）を起動します。デフォルト：`http://127.0.0.1:1234/v1`。
- API互換性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:1234/v1`。
- モデル名は、読み込まれたモデルに対してLM Studioが表示する識別子です。

### vLLM

- OpenAI互換サーバーで提供します：`vllm serve <model>` → `http://127.0.0.1:8000/v1`。
- API互換性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8000/v1`。
- `--api-key` でvLLMを起動した場合は、そのキーを `auth_token` に入力します。
- モデル名は、提供されるモデルのパス/名前です（`/v1/models` と一致します）。

### LiteLLM（複数のバックエンドに対するプロキシ）

- LiteLLMプロキシを実行します。デフォルト：`http://127.0.0.1:4000/v1`。
- API互換性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:4000/v1`。
- モデル名は、LiteLLMの設定で定義したモデルエイリアスです。
- プロキシがマスターキーを要求する場合は、それを `auth_token` に設定します。

### ChatMock（ChatGPTアカウント / Codex CLI）

システムプロンプトの回避策があるため、独自の専用ガイドがあります：
[セットアップ: ChatMock](/self-hosting/local-endpoints/setup-chatmock/)。

## Hugging Faceからのモデルの選択

Ollamaの厳選されたライブラリに加えて、[Hugging Face](https://huggingface.co) は数千のコミュニティモデルをホストしています。KoboldCPP、llama.cpp、LM StudioはすべてGGUFフォーマットを読み込むことができます。これは、ダウンロードしてサーバーに指定する単一ファイルのパッケージです。

1. **GGUFを見つける。** Hugging Faceで目的のモデル名と「GGUF」を検索します。[bartowski](https://huggingface.co/bartowski) のようなコミュニティクオンタイザーは、リリース後すぐに人気モデルのGGUFビルドを公開します。instruct/chatバリアント（`-Instruct` または `-Chat` で終わる名前）を優先してください。ベースモデルでは会話が成り立ちません。
2. **VRAMに収まる量子化を選択する。** リポジトリには同じモデルの多くの量子化レベルが一覧表示されており、ファイルサイズ ≈ 必要なVRAM（プラス、コンテキスト用の約1-2 GB。上記の [サイズ表](#which-size-should-i-pull) のルールと同じ）です。選択した単一の `.gguf` をダウンロードします。
3. **読み込む。** そのファイルでKoboldCPPまたは `llama-server` を起動し（[その他のサーバー](#other-servers) を参照）、通常通りDiscordでエンドポイントを登録します。

:::tip[どの量子化？Q4またはQ5がスイートスポット]
量子化は各重みをより少ないビット数で保存し、わずかな品質コストでモデルを縮小します。`Q4_K_M` や `Q5_K_M` のような名前に含まれるコードは重みあたりのビット数です。**4ビット（Q4）または5ビット（Q5）が通常のスイートスポット** であり、8ビットの約半分のサイズで品質のほとんどを維持します。4ビット未満にすると急速に劣化します。また、固定のVRAM予算では、通常 **Q4のより大きなモデルの方がQ8のより小さなモデルよりも優れています**。
:::

## 注意事項と落とし穴
<!-- anchor: notes--gotchas -->

- **1つのラベルにつき1つのエンドポイント項目：** 1つのサーバーを共有する複数のモデルを登録するには、保存したエンドポイントを選択し、モデルのドロップダウンを再度使用します。まったく異なるサーバーまたはAPIプロトコルには別々のラベルを使用してください。
- **モデル名はAPI識別子です：** サーバーに送信される正確な文字列です。これを間違えることが、「接続できたが応答に失敗する」最も一般的な原因です。
- **TomoriBotをDockerで実行している場合：** コンテナ内の `localhost` はホストではありません。`http://host.docker.internal:<port>`（Windows/macOS）またはホストのLAN IPを使用し、モデルサーバーを `0.0.0.0` にバインドしてください。
- **Composeを使用している場合：** `RUN_ENV=development` 設定により、ローカルHTTPエンドポイントが許可されます。本番環境のランタイムはHTTPSを強制し、呼び出し元が明示的に許可しない限りプライベートネットワークの宛先をブロックします。`FETCH_URL_ALLOW_PRIVATE_NETWORK=true` は本番環境で `fetch_url` に対してプライベートな宛先を許可しますが、プロバイダーエンドポイントのルールは変更しません。クラウドメタデータアドレスはすべてのモードでブロックされたままになります。
