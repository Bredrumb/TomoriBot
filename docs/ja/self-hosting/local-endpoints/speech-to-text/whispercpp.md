---
title: "whisper.cppの文字起こし"
sidebar:
  order: 2
---

HTTPサーバーがOpenAI互換の`POST /v1/audio/transcriptions`エンドポイントを公開している場合、whisper.cppを使用できます。

## セットアップ

whisper.cppのHTTPサーバーを起動し、OpenAI互換の文字起こしエンドポイントを公開していることを確認します。

- `POST /v1/audio/transcriptions`
- `GET /v1/models` または `GET /models`

TomoriBotが使用している間は、サーバーを実行したままにしてください。エンドポイントURLはサーバーのルート（例: `http://127.0.0.1:8022`）です。

whisper.cppのビルドが異なるエンドポイント形式を公開している場合は、リクエストをTomoriBotが想定するOpenAI互換の形式にマッピングする薄いラッパーをその前に配置してください。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：使用しているwhisper.cppサーバーのルートURL

接続を保存したら、それを選択し、モデルのドロップダウンからサーバーが文字起こしモデルとして報告するモデル名を追加します。

エンドポイントの登録とモデルのセットアップには`/providers`を使用してください。その後、`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化します。

## 文字起こしの使用

登録後、TomoriBotは音声添付ファイルをバックグラウンドで文字起こしし、チャットコンテキストにテキストを追加します。文字起こしをチャットに表示して投稿したい場合にのみ、`/config` > 動作 > 一般的な動作の`通知`を使用してください。
