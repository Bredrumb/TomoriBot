---
title: "CosyVoice 3"
aiGenerated: true
---

Alibabaの [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) を使用して、指示ベースの感情表現により自然な多言語キャラクターの音声を合成します。

CosyVoice 3は、9つの言語と18以上の中国語の方言にわたるゼロショットおよび異言語音声クローンを提供します。TomoriBotは公式ランタイムを `servers/tts/cosyvoice3/` でラップし、標準の `POST /synthesize` 音声インターフェイスを公開します。同梱のインストーラーはデフォルトで量子化されていない公式の `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` モデルを使用し、16 GBのVRAM内で動作します。

CosyVoiceは9つの言語と中国語の方言をサポートしています。日本語の発音が不十分な場合、テキストをカタカナに変換することがアップストリームで推奨されています。

`プレーン` スクリプトマークアップ形式を使用し、`voice_instructions` を通じて発話の方向性を指定します。一致する参照文字起こしを提供するとゼロショットクローンが有効になります。これがない場合、サーバーは異言語クローンを使用します。指示を使用する場合、文字起こしなしで参照音声が使用されます。

## ハードウェア

推奨ハードウェア：

- 16 GB VRAMを搭載したNVIDIA GPU
- Python 3.10
- CUDA 12と互換性のあるNVIDIAドライバー
- `git`
- 音声サンプルの正規化用の `ffmpeg`
- 音声互換性の問題が発生した場合のLinux上の `sox` および `libsox-dev`

0.5Bパラメーターのモデルは、量子化なしで16 GB VRAMに簡単に収まります。チェックポイントのダウンロードには、フローモデル、音声トークナイザー、テキストモデル、強化学習の重みが含まれており、約10 GBのディスク容量とPythonの依存関係が必要です。

CPU推論はアップストリームで技術的にサポートされていますが、Discordの音声対話には遅すぎます。

## インストール

### LinuxおよびWSL2（推奨）

TomoriBotリポジトリのルートから実行します：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

または、設定されたサーバーとTomoriBotを一緒に起動します：

```bash
bun run launch --cosyvoice3
```

インストーラーは固定されたランタイムとモデルのリビジョンをダウンロードし、コミットされていない変更があるチェックアウトの上書きを拒否します。

アップストリームの要件により、CUDA 12.1パッケージを含むPyTorch 2.3.1、Linux上のCUDA 12 ONNX Runtimeパッケージ、およびLinux上のTensorRT 10.13パッケージがインストールされます。GPUでより新しいPyTorchビルドが必要な場合は、セットアップ完了後に仮想環境内に互換性のあるPyTorchビルドをインストールしてください。

### Windows PowerShell

ネイティブWindowsはベストエフォートパスとして提供されます：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WindowsでNVIDIA GPUを使用する場合は、WSL2を強く推奨します。アップストリームの要件ではWindowsにCPU専用のONNX Runtimeがインストールされますが、LinuxとWSL2にはGPUアクセラレーション対応パッケージがインストールされます。

## TomoriBotへの登録

`/providers` を実行し、`+ 新しいカスタムエンドポイントを追加` を選択して、音声エンドポイントを設定します：

- 機能：`音声`
- API互換性：`tts-clone`
- エンドポイントURL：`http://127.0.0.1:8017`
- 音声ソースモード：`音声クローン`
- スクリプトマークアップ形式：`プレーン`
- 指示の対応：`有効`

接続を保存したら、それを選択して音声モデルを追加します。分かりやすいモデルコードは `Fun-CosyVoice3-0.5B-2512` です。

続いて `/config` > モデル > モデルの切り替え を開き、CosyVoice 3音声エンドポイントを有効化します。

## ペルソナ音声の割り当て

ゼロショット音声クローンの場合：

1. 単一話者でバックグラウンドノイズを最小限に抑えた、きれいな3〜30秒の音声クリップを準備します。
2. `/config` の モデル > TTSパラメーターと音声 を開き、サンプルをアップロードします。
3. 利用可能な場合は、一致する文字起こしを入力します。CosyVoice 3はこの文字起こしをゼロショットクローンのプロンプトプレフィックスとしてトークン化します。音声の最初の30秒を説明している必要があります。
4. `/config` の ペルソナ > 音声 を開き、サンプルをペルソナに割り当てます。

ラッパーは参照音声を最初の30秒にトリミングします。異言語クローンでは、生成されたテキストとは異なる言語で話された参照を使用できます。

## `/generate voice-message` でテストする

`/generate voice-message` を使用すると、自動チャットトリガーを待たずに合成をテストできます。ペルソナに割り当てられたサンプルでテストすることも、文字起こし付きの単発クリップをアップロードすることもできます。

感情や発話をガイドするには、モーダルに指示を入力するか、ペルソナプロンプトから `voice_instructions` を提供させます。発話テキストは通常の対話のままにしてください。インラインスタイルタグは合成前に削除されます。

## 環境変数

| 変数 | デフォルト | 目的 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | ローカルチェックポイントディレクトリ |
| `TOMORI_TTS_HOST` | `127.0.0.1` | ラッパーのバインドアドレス。[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を参照してください |
| `COSYVOICE3_PORT` | `8017` | ラッパーのポート |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | CosyVoiceの内部ストリーミングジェネレーターを有効化 |
| `COSYVOICE3_SPEED` | `1.0` | アップストリーム推論に渡されるグローバルな数値速度倍率 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空 | リクエストで指示が提供されない場合に追加されるオプションの指示 |
| `COSYVOICE3_FP16` | `0` | 公式ランタイムにfp16モードの使用を要求 |
| `COSYVOICE3_LOAD_TRT` | `0` | 適切に準備されている場合、アップストリームのTensorRTロードを有効化 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 個別の依存関係がインストールされている場合、アップストリームのvLLMロードを有効化 |

デフォルトでは、TensorRT、vLLM、およびfp16は無効のままです。標準のPyTorchランタイムは、追加のランタイム依存関係なしで16 GB GPU上で快適に動作します。

## モデルのバリエーション

同梱されているRLの重みを試すには、モデルディレクトリをコピーし、コピー内で `llm.rl.pt` を `llm.pt` に名前変更して、`COSYVOICE3_MODEL_DIR` にそれを設定します。オプションのvLLMおよびTensorRTランタイムには個別の依存関係が必要です。

## ライセンス

CosyVoiceのコードベースと `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` の重みは、Apache-2.0ライセンスに基づいて公開されています。

アップストリームのモデルカードには、デモ資料は学術的評価を目的としていることが記載されています。TomoriBotはモデルの重みを配布しません。商業利用する前に、特定のユースケースに応じたアップストリームのライセンスと条件を確認してください。
