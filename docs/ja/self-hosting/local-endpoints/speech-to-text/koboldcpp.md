---
title: "KoboldCPPの文字起こし"
sidebar:
  order: 3
---

KoboldCPPにはWhisperベースのSTTサポートがありますが、エンドポイントの形式はビルドによって異なる場合があります。TomoriBotのPhase 4アダプターは、OpenAI互換の`POST /v1/audio/transcriptions`を想定しています。

## セットアップ

Whisper/STTを有効にしてKoboldCPPを起動し、ビルドが以下を公開していることを確認します。

- `POST /v1/audio/transcriptions`
- `GET /v1/models` または `GET /models`

TomoriBotが使用している間は、KoboldCPPを実行したままにしてください。ビルドが`/api/extra/transcribe`または別のカスタム形式のみを公開している場合は、TomoriBotに専用のアダプターが搭載されるまでラッパーを使用してください。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：使用しているKoboldCPPサーバーのルートURL

接続を保存したら、それを選択し、モデルのドロップダウンからサーバーが文字起こしモデルとして報告するモデル名を追加します。

エンドポイントの登録とモデルのセットアップには`/providers`を使用してください。その後、`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化します。

## 文字起こしの使用

登録後、TomoriBotは音声添付ファイルをバックグラウンドで文字起こしし、チャットコンテキストにテキストを追加します。文字起こしをチャットに表示して投稿したい場合にのみ、`/config` > 動作 > 一般的な動作の`通知`を使用してください。
