---
title: "MOSS-TTS"
aiGenerated: true
---

[MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) を使用して、統合された音声エンドポイントを通じてローカルで音声クローンと自然言語による音声デザインを評価します。

デフォルトの4Bクローンモデルと1.7BのVoiceGeneratorは、音声モードが変更されたときにGPUメモリ内で入れ替えられるため、切り替え後の最初のリクエストには時間がかかります。8Bクローンモデルには、より多くのVRAMが必要です。

## セットアップ

Python 3.12とCUDA 12.8互換のドライバーを使用して、TomoriBotリポジトリのルートからコマンドを実行します：

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### LinuxまたはWSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

プリフェッチコマンドは、サーバーを起動する前にクローンモデル、VoiceGenerator、および音声トークナイザーをHugging Faceキャッシュにダウンロードします。ディスク容量が限られている場合は、`HF_HOME` をより大きなパーティションに設定してください。1つのモデルのみをダウンロードするには、`--mode clone` または `--mode voice-design` を渡します。

デフォルトのエンドポイントは `http://127.0.0.1:8018` です。`bun run launch --moss` を実行して、TomoriBotと一緒にサーバーを起動します。自動モードでは、ローカルキャッシュからクローンモデルをプリウォームします。代わりに `MOSS_TTS_WARM_MODE=voice-design` を設定してVoiceGeneratorをプリウォームするか、`MOSS_TTS_WARM_MODE=none` で遅延初期化を行います。アクティブな `warm_mode`、`active_mode`、および `model_id` については `GET /health` を確認してください。ラッパーはHugging Faceの `trust_remote_code=True` を使用するため、更新前にアップストリームのコードを確認してください。

## TomoriBotへの登録

`/providers` で `+ 新しいカスタムエンドポイントを追加` を選択し、API互換性を `tts-clone` に設定し、エンドポイントURL `http://127.0.0.1:8018` を使用します。`音声ソースモード` を `自動` に、`スクリプトマークアップ形式` を `プレーン` に設定して音声モデルを追加します。`/config` > モデル > モデルの切り替え でアクティブ化します。

音声クローンの場合、`/config` > モデル > TTSパラメーターと音声 でクリーンな参照クリップをアップロードし、ペルソナ > 音声 で割り当てます。短くクリーンな音声クリップが最も一貫した結果をもたらします。音声デザインの場合は、ペルソナ > 音声 に自然言語の説明を保存します。MOSS-VoiceGeneratorは英語と中国語向けに設計されていることに注意してください。4Bクローンモデルは日本語をサポートしていますが、明示的な言語タグにより合成の明瞭度が向上します。

TomoriBotのクローンアダプターは言語タグを自動的には送信しません。単一言語で使用する場合は、サーバーを起動する前に `MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（または `English`、`Chinese` など）を設定してください。手動の `/synthesize` 呼び出しでは `language` を直接渡すことができます。

サーバーは独自のシェル環境を読み取ります。ボットの `.env` の設定は、個別に起動されたPythonターミナルには適用されません。

高メモリハードウェアで8Bモデルを実行するには、プリフェッチ前に `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` を設定します。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE`、および `MOSS_TTS_MAX_NEW_TOKENS` は `.env.optional.example` で設定可能です。モデルの入れ替えやCPU実行によってタイムアウトが発生する場合は、TomoriBotの `TTS_SYNTHESIZE_TIMEOUT_MS` を増やしてください。
