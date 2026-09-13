---
title: "MOSS-TTS"
---

`servers/tts/moss/server.py`は、MOSSの音声クローンとテキストによる音声設計を一つのローカルエンドポイントで試すためのラッパーです。Autoモードでは、`ref_audio`を受け取るとクローンモデル、`instruct`を受け取るとMOSS-VoiceGeneratorを使います。メモリには一度に一つのモデルだけを保持します。Discordのボイスチャット向けストリーミングにはまだ対応していません。

標準のクローンモデルは[MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5)（4B）です。16 GB GPUで試す際の出発点として選んでいます。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5)は8Bの代替ですが、BF16では通常16 GBを超えるVRAMが必要です。音声設計には約1.7Bの[MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)を使います。Autoモードはモデルを入れ替えるため、切り替え時に読み込み時間がかかります。

## セットアップ

TomoriBotのリポジトリルートから実行します。Python 3.12とCUDA 12.8のPyTorchに対応するドライバーを使ってください。上流のruntime extraはPyTorchとTorchaudioの2.9.1+cu128を固定するため、専用の仮想環境が必要です。別のCUDA構成やCPU構成は、個別の検証が必要です。

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\server.py
```

### LinuxまたはWSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/server.py
```

標準URLは`http://127.0.0.1:8018`です。最初の合成時にモデルを読み込みます。`GET /health`の`active_mode`と`model_id`で確認できます。初回リクエスト前の`idle`は正常です。このラッパーはHugging Faceの`trust_remote_code=True`を使うため、信頼できるソースからのみインストールし、更新時には上流の変更を確認してください。

## TomoriBotへの登録

`/providers`で **Add New Custom Endpoint** を選び、API Compatibilityを`tts-clone`、endpoint URLを`http://127.0.0.1:8018`にします。Speechモデルの **Voice Source Mode** は`Auto`、**Script Markup** は`Plain`を選択します。その後、`/config` > Models > Switch Modelsで有効化します。

音声クローンには、`/config` > Models > TTS Parameters & Voicesで参照クリップをアップロードし、Persona > Voiceで割り当てます。音声設計には、代わりにPersona > Voiceで自然言語の声の説明を保存します。MOSS-TTSは参照音声を使いますが、任意の参照トランスクリプトは使いません。MOSS-VoiceGeneratorが明示的に対応する高品質な言語は英語と中国語で、日本語は含まれません。4Bのクローンモデルは日本語に対応しますが、言語タグを指定すると多言語合成が改善されます。

TomoriBotの現在のクローンアダプターは言語タグを送りません。単一言語の試用では、起動前に`MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（または`English`、`Chinese`など）を設定してください。手動の`/synthesize`リクエストでは`language`を個別に指定できます。多言語を混ぜる場合は未設定にし、日本語の出力品質を評価してください。

サイドカーは自身のプロセス環境変数を読みます。ボットの`.env`に値を追加しても、別途起動したPythonプロセスには自動で渡されません。

十分なメモリがある環境で8Bモデルを試す場合は`MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`を設定します。その他の設定は`.env.optional.example`を参照してください。初回読み込みやCPU推論には、ボット側の`TTS_SYNTHESIZE_TIMEOUT_MS`を増やす必要がある場合があります。
