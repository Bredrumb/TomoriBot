---
title: "Chatterbox TTS"
aiGenerated: true
---

ローカルの [Chatterbox](https://github.com/resemble-ai/chatterbox) テキスト読み上げサーバーを使用して、感情タグを含む英語音声のクローンを作成します。

Chatterboxは `servers/tts/chatterbox/server.py` を介してローカルで実行されます。デフォルトでは、`[laugh]` や `[sigh]` などのインライン感情イベントタグを備えた高速なChatterbox-Turboモデル（3億5000万パラメーター）になります。CPU環境向けの軽量なChatterbox-Nanoモデル（1億1000万パラメーター）や、Classifier-Free Guidance（`cfg_weight`）および感情的な `exaggeration` チューニング用の標準0.5Bモデルを設定することもできます。このラッパーはChatterbox Multilingual V3をロードしません。

## セットアップ

TomoriBotリポジトリのルート（TomoriBotをクローンしたフォルダー）から以下のコマンドを実行します：

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

TomoriBotがChatterboxを使用している間は、そのターミナルを開いたままにしてください。デフォルトのエンドポイントURLは `http://127.0.0.1:8011` です。別のポートを使用する場合は `CHATTERBOX_PORT` を設定します。

### オプション：Chatterbox-Nanoを使う

Nanoには、`nano=True` ローダーオプションを備えたChatterboxビルドが必要です。上記の通常のセットアップの後、同じ仮想環境に固定されたアップストリームリビジョンをインストールします。コミットハッシュは互換性のあるソースバージョンを固定するものであり、セキュリティを保証するものではありません。このコマンドには `git` が必要で、すでにインストールされているランタイム依存関係が保持されます：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

次に、ラッパーを起動する前に `CHATTERBOX_FAST_MODEL=nano` を設定します。Turboの場合は変数を未設定のままにします。Windows PowerShellでは `$env:CHATTERBOX_FAST_MODEL = "nano"` で設定し、LinuxまたはmacOSでは `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py` を使用します。`/health` レスポンスが `fast_model` を報告するため、ロードされた選択肢を確認できます。NanoとTurboは同じクローンリクエストとサポートされているイベントタグを使用します。どちらも英語のみです。

NanoまたはTurboを使用するには、`/config` の高速モデルトグルを有効にしておく必要があります。これを無効にすると、CFGウェイトと誇張チューニング用の標準Chatterbox 0.5Bモデルが選択されます。

### 標準Chatterbox

標準モデルを使用するには、`/config` > モデル > TTSパラメーターと音声 で `高速モデル (Turbo)` を無効にします。標準モデルは `cfg_weight` と `exaggeration` のチューニングをサポートしますが、ブラケットイベントタグはサポートしません。

## TomoriBotへの登録

エンドポイントのラベルまたはモデル名に `Chatterbox` を含めてください。TomoriBotはその名前（またはそれを含むエンドポイントURL）でのみChatterboxエンドポイントを認識するため、Turboのタグ許可リスト、標準モデルでのタグ除去、`/generate voice-message` のChatterboxオプションは、その名前が含まれている場合にのみ適用されます。

`/providers` を実行し、`+ 新しいカスタムエンドポイントを追加` を選んで、音声用のAPI互換性を使用します：

- API互換性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

接続を保存したら、それを選択し、モデルのドロップダウンから `+ 新しい音声モデルを追加` を選びます。発話タグが送信時に失われないように、`音声ソースモード` に `音声クローン` を、`スクリプトマークアップ形式` に `ブラケットタグ` を選択します。

エンドポイントの登録とモデルのセットアップには `/providers` を使用します。続いて `/config` > モデル > モデルの切り替え を開き、登録したエンドポイントを選択して有効化してください。

## ペルソナボイスを設定する

1. 単一話者でBGMのない、きれいな10秒の音声クリップを準備します。
2. `/config` の モデル > TTSパラメーターと音声 を開き、クリップをアップロードします。
3. `/config` の ペルソナ > 音声 を開き、ペルソナと音声サンプルを選択します。

Chatterboxには5秒以上の音声が必要です。10秒を目指してください。モデルはコンディショニングのために、より長いクリップの限られた部分のみを使用します。

## オプションのチューニング

`/config` > モデル > TTSパラメーターと音声 で、標準モデルの `cfg_weight` と `exaggeration` を調整します。どちらもデフォルトは `0.5` です。値を高くすると、それぞれ参照により忠実になり、表現力が増します。

サポートされているTurbo/Nanoイベントタグは、`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`、および `[laugh]` です。`[excited]`、`[whisper]`、`[smiles]` などのサポートされていない記述子は、TTSに送信されずに削除されます。
