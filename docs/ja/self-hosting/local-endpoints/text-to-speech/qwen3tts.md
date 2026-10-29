---
title: "Qwen3-TTS"
aiGenerated: true
---

[Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) を使用して、音声クローンモードとテキスト指定のVoiceDesignモードの両方で高精度な多言語キャラクター音声を合成します。

Qwen3-TTS 12Hz 1.7Bは、高精度なローカル音声合成を提供します。`servers/tts/qwen3tts/server.py` をデフォルトの自動モードで実行すると、各受信リクエストに基づいてBase音声クローンモデルまたはVoiceDesignモデルが動的に選択されます。

## セットアップ

TomoriBotリポジトリのルート（TomoriBotをクローンしたフォルダー）から以下のコマンドを実行します：

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### LinuxおよびmacOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

デフォルトの自動モードのエンドポイントURLは `http://127.0.0.1:8012` です。別のポートを使用する場合は `QWEN3TTS_PORT` を設定します。自動モードを明示的に指定することもできます：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自動モードは各 `/synthesize` リクエストを検査します。`ref_audio` を持つリクエストはクローンモデルを使用し、`instruct` を持つリクエストはVoiceDesignモデルを使用します。一度にロードされるモデルは1つだけであり、リクエストの種類が変わるとモデルが入れ替えられるため、入れ替え後の最初のリクエストは遅くなる可能性があります。

## TomoriBotへの登録

ほとんどのユーザーは、1つのエンドポイントで音声クローンとVoiceDesignの両方のペルソナをサポートできるように、自動モードサーバーを登録します。

`/providers` を実行し、`+ 新しいカスタムエンドポイントを追加` を選択して、音声用のAPI互換性を使用します：

- API互換性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

接続を保存したら、それを選択し、モデルのドロップダウンを使用して音声モデルを追加します。モデルフォームで「音声ソースモード」と「スクリプトマークアップ形式」が求められるので、自動モードサーバーの場合は「自動」と「プレーン」を選択します。

エンドポイントの登録とモデルのセットアップには `/providers` を使用します。続いて `/config` > モデル > モデルの切り替え を開き、登録したエンドポイントを選択して有効化してください。

## ペルソナ音声のセットアップ

### 音声クローン

参照クリップを模倣するペルソナにこれを使用します：

1. 単一話者でBGMのない、きれいな10〜20秒の音声クリップを準備します。
2. `/config` の モデル > TTSパラメーターと音声 を開き、クリップをアップロードします。
3. `/config` の ペルソナ > 音声 を開き、ペルソナと音声サンプルを選択します。

Qwen3-TTSは、わずか3秒の短い参照クリップをサポートしています。

### VoiceDesign

サンプルの代わりに書かれた音声の説明を使用するペルソナにこれを使用します：

1. `/config` の ペルソナ > 音声 を開き、VoiceDesignを選択します。
2. ペルソナを選択します。
3. 話者の年齢、口調、アクセント、話し方などの自然言語による音声プロンプトを入力します。

## オプション：VoiceDesign専用サーバー

`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` を提供する場合は、同じサーバーをVoiceDesignモードで起動します。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

`TOMORI_TTS_MODE` を設定する代わりに、`--mode voice-design` を渡すこともできます。デフォルトのVoiceDesign専用エンドポイントURLは `http://127.0.0.1:8014` です。

自動モードと同じ方法で登録しますが、エンドポイントURLには `http://127.0.0.1:8014` を使用し、音声モデルの音声ソースモードとして `ボイスデザイン` を選択します。
