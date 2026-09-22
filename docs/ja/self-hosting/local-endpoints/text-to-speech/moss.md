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

事前ダウンロードでは、クローンモデル、VoiceGenerator、および両モデルが使う音声トークナイザーをHugging Faceのキャッシュに保存します。各リポジトリのダウンロード前にキャッシュ先の空き容量を確認し、既にキャッシュ済みのファイルは再利用します。容量不足なら空きを増やすか、事前ダウンロードとサーバー起動の前に同じシェルで`HF_HOME`を空き容量の多いドライブに設定してください。モデルIDを変更した場合は再実行してください。片方だけを試すなら`--mode clone`または`--mode voice-design`を指定できますが、もう片方の初回使用時にはダウンロードが発生する場合があります。

標準URLは`http://127.0.0.1:8018`です。Autoモードでは、HTTPサーバーの起動完了前にキャッシュ済みのクローンモデルを読み込みます。事前ダウンロードしていない場合は、不意にダウンロードを始めず起動に失敗します。代わりにVoiceGeneratorを読み込むには`MOSS_TTS_WARM_MODE=voice-design`、起動時に読み込まない場合は`MOSS_TTS_WARM_MODE=none`を設定します。GPUには一度に一つのモデルだけを保持します。`GET /health`の`warm_mode`、`active_mode`、`model_id`で確認できます。このラッパーはHugging Faceの`trust_remote_code=True`を使うため、信頼できるソースからのみインストールし、更新時には上流の変更を確認してください。

## TomoriBotへの登録

`/providers`で **新しいカスタムエンドポイントを追加** を選び、API互換性を`tts-clone`、エンドポイントURLを`http://127.0.0.1:8018`にします。音声モデルの **音声ソースモード** は`自動`、**スクリプトのマークアップ形式** は`プレーン`を選択します。その後、`/config` > モデル > モデルの切り替えで有効化します。

音声クローンには、`/config` > モデル > TTSパラメーターと音声で参照クリップをアップロードし、ペルソナ > 音声で割り当てます。MOSS-TTSについて上流は推奨する参照長を示しておらず、ランタイムにも長さの上限がないため、クリップの長さは自分で調整する項目です。短くクリーンなクリップのほうが引き続き安全な既定です。音声設計には、代わりにペルソナ > 音声で自然言語の声の説明を保存します。MOSS-TTSは参照音声を使いますが、任意の参照トランスクリプトは使いません。MOSS-VoiceGeneratorが明示的に対応する高品質な言語は英語と中国語で、日本語は含まれません。4Bのクローンモデルは日本語に対応しますが、言語タグを指定すると多言語合成が改善されます。

TomoriBotの現在のクローンアダプターは言語タグを送りません。単一言語の試用では、起動前に`MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（または`English`、`Chinese`など）を設定してください。手動の`/synthesize`リクエストでは`language`を個別に指定できます。多言語を混ぜる場合は未設定にし、日本語の出力品質を評価してください。

サイドカーは自身のプロセス環境変数を読みます。ボットの`.env`に値を追加しても、別途起動したPythonプロセスには自動で渡されません。

十分なメモリがある環境で8Bモデルを試す場合は、事前ダウンロードより前に`MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`を設定します。その他の設定は`.env.optional.example`を参照してください。モデルの切り替えやCPU推論には、ボット側の`TTS_SYNTHESIZE_TIMEOUT_MS`を増やす必要がある場合があります。
