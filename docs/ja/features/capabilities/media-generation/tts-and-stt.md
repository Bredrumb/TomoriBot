---
title: "音声: TTS & STT"
sidebar:
  order: 3
---

TomoriBotは、**話す**（テキスト読み上げ、TTS）ことと、**聞く**（音声認識、STT）ことができます：

- **TTS**を使用すると、ネイティブのDiscord音声メッセージで返信できます。
- **STT**を使用すると、ユーザーからの音声の添付ファイルを、会話のコンテキストとして使用できるテキストに変換できます。

どちらも同じエンドポイントシステムを通じて機能します。最も簡単な方法は**ElevenLabs**（クラウド版、詳細は下記）を使用することです。自身のハードウェアで音声を処理したい場合は、ローカルエンジンを使用し、セルフホストのガイドに従ってください。

## テキスト読み上げ（TTS）
<!-- anchor: text-to-speech -->

### ElevenLabs（クラウド、最も簡単）

1. [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)からAPIキーを取得します。
2. `/providers` を実行し、`新しいプロバイダーを追加`（新しいプロバイダーを追加）を選び、**ElevenLabs** を選択してキーを貼り付けます。このフローで以下のことが行われます：
   - ElevenLabsの **speech** エンドポイント（および **transcription** エンドポイントも）を登録します。
   - それらをアクティブとして選択します。
   - その場で1つのペルソナに音声を割り当てることができます。
3. `/config` の ペルソナ > 音声 で、追加のペルソナに音声を割り当てます。音声の閲覧は [ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library) で行えます。ここから自身の音声をクローンすることもできます。

キーを更新する必要がある場合は、いつでも `/providers` で ElevenLabs を選択し、`エンドポイントを編集`（エンドポイントを編集）を選んでください。

注意事項：

- **無料プランでは、用意された音声（premade voices）のみ機能します**。[用意された音声のリスト](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)を参照してください。
- 彼女が音声メッセージを生成して読み上げる際に文字数がカウントされます。無料プランには月ごとの制限がありますので、ElevenLabsのダッシュボードを確認してください。
- 音声での返信は `voice_message_enabled` によって制限されており、アクティブなペルソナに音声が割り当てられている必要があります。
- `/config` の ペルソナ > 音声 は、ギルド（サーバー）ではサーバー管理（Manage Server）権限を必要とし、DMバックアップのワークスペースではオーナーが引き続き利用できます。

Discord上で同じ手順を確認するには、`/help` の `機能`（機能）から `音声`（音声生成）を開いてください。

### ローカルの音声クローンエンジン（セルフホスト）

セルフホストのインスタンスでは、代わりにローカルの音声クローンサーバーを実行できます。一般的なフローは以下の通りです：
ラッパーサーバーを起動し、`/providers` でその接続とモデルを登録し、`/providers` でそれを選択し、`/config` の モデル > TTSパラメーターと音声 でサンプルをアップロードし、最後に `/config` の ペルソナ > 音声 でそれを割り当てます。どのような音声形式でも受け入れられます（モノラルのWAVに自動変換されます）。BGMのない10〜20秒のクリップが最適です。

各エンジンにはそれぞれセットアップガイドがあります：

- [Chatterbox-Turbo/Nano](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/)：高速な英語専用の音声クローンです。`[laugh]`などの対応済みイベントタグを使えます。
- [Qwen3-TTS](/ja/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多言語対応（10言語）。自然言語によるボイスデザインモードを備えています。
- [MOSS-TTS](/ja/self-hosting/local-endpoints/text-to-speech/moss/)：多言語のクローンと英語/中国語の音声設計を切り替える試用向けの自動エンドポイントです。
- [IrodoriTTS](/ja/self-hosting/local-endpoints/text-to-speech/irodoritts/)：日本語特化。絵文字を感情の合図として読み取ります。

全エンジンとハードウェアのガイダンスについては、[テキスト読み上げ（TTS）の比較表](/ja/self-hosting/local-endpoints/text-to-speech/)をご覧ください。

## 音声認識（STT）
<!-- anchor: speech-to-text -->

文字起こしのエンドポイントは、ユーザーの音声添付ファイルをテキストに変換し、バックグラウンドでの会話のコンテキストとして機能させます。文字起こしがチャットに**表示して投稿される**かどうかは、`/config` > 動作 > 一般的な動作 で個別に制御されます。

### ElevenLabs（クラウド）

上記ですでに説明した通り、`/providers` から ElevenLabs を追加すると、音声とともに文字起こしのエンドポイントも登録されます。文字起こしのエンドポイントを切り替えるには、`/providers` を使用します。

### ローカルエンジン（セルフホスト）

- [WhisperX](/ja/self-hosting/local-endpoints/speech-to-text/whisperx/)：ローカルでの推奨パスです。約100言語対応、GPUアクセラレーション、複数のモデルサイズ。
- [KoboldCPP](/ja/self-hosting/local-endpoints/speech-to-text/koboldcpp/)：ご使用のビルドが OpenAI 互換の文字起こしエンドポイントを公開している場合に機能します。
- [whisper.cpp](/ja/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

完全なリストについては、[音声認識（STT）](/ja/self-hosting/local-endpoints/speech-to-text/)ハブをご覧ください。Discordでの概要を確認するには、`/help` で `機能`（機能）を選び、次に `文字起こし`（文字起こし）を開いてください。
