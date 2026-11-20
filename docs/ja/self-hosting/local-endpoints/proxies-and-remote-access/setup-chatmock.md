---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
---

[ChatMock](https://github.com/RayBytes/ChatMock)を使用して、TomoriBotをローカルのChat Completionsブリッジに接続します。

:::danger[CLIアカウントプロキシの使用は自己責任で行ってください]
CLIアカウントを介したサードパーティのアクセスは、プロバイダーの利用規約に違反し、アカウントの停止につながる恐れがあります。サブスクリプションの契約は、ボットやAPIとしての利用許可を意味しません。サインインする前に、[アカウントのリスクに関するガイダンス](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk)を確認してください。TomoriBotはアカウントの安全性について一切保証しません。
:::

## 1. ChatMockを起動する

1. [ChatMockリポジトリ](https://github.com/RayBytes/ChatMock)の手順に従ってChatMockをインストールします。
2. お使いのアカウントとアクセス方法でこの利用が許可されている場合は、認証してサーバーを起動します：

```sh
chatmock login
chatmock serve
```

3. ローカルAPIに `http://127.0.0.1:8000/v1` で到達できることを確認します。

## 2. TomoriBotを設定する

1. `/providers` または `/personal providers` を実行し、`OpenAI互換` のカスタムエンドポイントを追加します。
2. 接続設定を入力します：

| フィールド | 値 |
|---|---|
| エンドポイントURL | ボットが本番環境外でこのマシン上で動作する場合は `http://127.0.0.1:8000/v1` |
| 認証トークン | 認証が有効な場合はブリッジのクライアントキー |

3. 保存したエンドポイントを選択し、ChatMockが公開する正確なAPI IDを指定して `テキストモデル` を追加します。モデルを切り替えるには、同じ接続配下にさらにIDを登録してください。

- `http://127.0.0.1:8000` のみを入力した場合でも `/v1` に正規化されます。`/chat/completions` は追加しないでください。
- TomoriBotの開発用 `ALLOW_PRIVATE_NETWORK` 設定で `127.0.0.1:8000` を許可してください。Dockerのループバックはコンテナー自身を指します。
- ツール、画像、または構造化出力は、ブリッジと選択したモデルをテストした後にのみ有効にしてください。動画はオフのままにしてください。
- 別ホストで稼働する本番ボットの場合は、[Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)に従ってください。本番環境では公開HTTPSが必要です。ループバックおよびポートに基づく直接的なChatMockプロンプト検出はトンネルの公開ホスト名には適用されないため、システム指示の動作は別途検証してください。アカウントログインはChatMockのアップストリームリクエストを認可するものであり、公開エンドポイントのクライアントを認証するものではありません。共有する前にトンネルガイドの[既知のリスク](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks)を確認してください。

:::note[システムプロンプトの扱いとポート設定]
TomoriBotは `CHATMOCK_PORT`（デフォルト `8000`）上のループバックエンドポイントを検出し、ChatMockとの互換性のためにシステム指示を最初のuserターンに変換します。別のローカルChatMockポートを使用する場合は、そのポートに合わせて `CHATMOCK_PORT` を設定してください。
:::
