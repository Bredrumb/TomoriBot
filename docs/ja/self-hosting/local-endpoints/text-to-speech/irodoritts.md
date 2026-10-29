---
title: "IrodoriTTS"
aiGenerated: true
---

[Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS) を使用して、音声クローン、キャプションベースのVoiceDesign、および表現力豊かな絵文字マークアップにより、自然な日本語音声を生成します。

Irodori-TTS v4.1は、単一チェックポイント内で音声クローンとテキスト指定のVoiceDesignの両方をサポートする、日本語に特化したテキスト読み上げモデルです。TomoriBotは `servers/tts/irodoritts/` のローカルFastAPIラッパーを介してIrodoriに接続し、デフォルトでは `Aratako/Irodori-TTS-v4.1-Small` を使用します。

`phasefield-audio/Irodori-TTS-v4.1-Anime` などのコミュニティによるファインチューンを含む、互換性のあるHugging Faceチェックポイントを `IRODORI_TTS_MODEL_ID` で選択できます。

## セットアップ

Irodoriは依存関係とPyTorchバックエンドの管理に `uv` を使用します。サーバーは再現可能なインストールのために、固定されたIrodoriおよび `dacvae` の依存関係を含む独自の `pyproject.toml` を保持しています。まず `uv` をインストールし、TomoriBotリポジトリのルートからセットアップスクリプトを実行します：

### Windows PowerShell（NVIDIA）

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash（NVIDIA）

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

セットアップスクリプトは `servers/tts/irodoritts/.venv` を作成するため、インストール後も `bun run launch --irodoritts` が引き続き動作します。

利用可能なバックエンド：

- `cu128`：WindowsおよびLinux上のNVIDIA CUDA 12.8
- `cpu`：CPU専用、またはPyPI経由のmacOS CPU/MPS
- `rocm`：Linux/WSL上のAMD ROCm
- `xpu`：WindowsおよびLinux上のIntel XPU

デフォルトのエンドポイントURLは `http://127.0.0.1:8013` です。

## 別のチェックポイントを使用する

デフォルトのモデルは `Aratako/Irodori-TTS-v4.1-Small` です。環境変数を介して、他の公式チェックポイント（3.29BパラメーターのLargeモデルやその量子化バリアントを含む）、コミュニティのファインチューン、またはローカルのチェックポイントファイルを選択できます。

### チェックポイントとバリアント

| モデル / `IRODORI_TTS_MODEL_ID` | パラメーター数 | チェックポイントサイズ | 推奨VRAM | 備考 |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | デフォルトモデル：高速な推論と低メモリ消費。 |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | T5Gemma 2テキストバックボーンを備えた完全な非量子化Largeモデル。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | BF16アクティベーションを備えたFP8ウェイト：NVIDIA Ada（RTX 40シリーズ）以降に推奨。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | NVIDIA CUDA上のBF16計算を備えた汎用INT8ウェイト。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | 最小のLargeバリアント：NVIDIA Ampere（RTX 30シリーズ）以降が必要。 |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | アニメ風の発話表現に向けたコミュニティファインチューン。 |

音声クローンの場合、Smallは高速な推論で同等の品質を提供します。Largeはより強力なテキストエンコーダーを備えており、VoiceDesignの説明により忠実に従います。

サーバーはリポジトリルートの `.env` またはローカルの `servers/tts/irodoritts/.env` を読み取ります。

### `.env` 経由（永続的）

TomoriBotルートの `.env` に追加します：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### セッションごとの環境変数経由

Windows PowerShellの場合：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

Linux Bashの場合：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### ローカルチェックポイントファイルの使用

チェックポイントファイル（`.pt` または `.safetensors`）をローカルにダウンロードした場合は、そのパスを `IRODORI_TTS_CHECKPOINT` に設定します：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

現在のIrodoriは、Hugging Faceリポジトリにバンドルされているトークナイザーアセットとともにチェックポイントをダウンロードします。モデルリポジトリが提供している場合、Hugging Faceのサブフォルダーバリアントも `IRODORI_TTS_MODEL_ID` でサポートされます。

## TomoriBotへの登録

`/providers` を実行し、`+ 新しいカスタムエンドポイントを追加` を選んで、音声用のAPI互換性を使用します：

- API互換性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8013`

接続を保存したら、それを選択し、モデルのドロップダウンから音声モデルを追加します。v4.1では以下の設定を推奨します：

- `音声ソースモード`：`自動`
- `スクリプトマークアップ形式`：`絵文字`

`自動` を選択すると、同じIrodoriエンドポイントでTomoriBotの両方の音声モードがサポートされ、感情の合図が送信時に保持されます：

- ペルソナ > 音声 で音声サンプルが割り当てられているペルソナは、音声クローンのために保存された参照クリップを送信します。
- ペルソナ > 音声 でVoiceDesignプロンプトが設定されているペルソナは、保存された自然言語プロンプトをIrodoriのキャプション条件として送信します。

参照音声による音声クローンのみを行いたい場合は、音声ソースモードに `音声クローン` を選択することもできます。

エンドポイントの登録とモデルのセットアップには `/providers` を使用します。続いて `/config` > モデル > モデルの切り替え を開き、登録したエンドポイントを選択して有効化してください。

## ペルソナ音声のセットアップ

### 音声クローン

1. 単一話者でBGMのない、きれいな日本語の音声クリップを準備します。約30秒で十分です。それ以上の長さは、アップロードサイズと推論時間を浪費するだけで、音色の忠実度はほとんど向上しません。
2. `/config` の モデル > TTSパラメーターと音声 を開き、クリップをアップロードします。
3. `/config` の ペルソナ > 音声 を開き、ペルソナと音声サンプルを選択します。

Irodoriはデフォルトで120秒の参照制限を適用し、それより長いクリップをトリミングします。制限を変更するには `IRODORI_MAX_REF_SECONDS` を設定します。

### VoiceDesign

1. `/config` の ペルソナ > 音声 を開きます。
2. ペルソナを選択します。
3. 希望する声や発話についての自然言語の説明を入力します。

TomoriBotはこのプロンプトを `instruct` として送信します。Irodoriラッパーはそれをv4.1の `caption` 条件にマッピングします。VoiceDesignリクエストには保存された参照クリップは不要です。

TomoriBotはテキストをTTSに送信する前にDiscordカスタム絵文字構文を削除します。`スクリプトマークアップ形式` を `絵文字` に設定すると、Irodoriのテキスト条件付けのためにUnicode絵文字が保持されます。

### 絵文字スタイル制御

IrodoriTTSは、効果音、話し方、感情表現に影響を与える入力テキスト内の絵文字注釈をサポートしています。TomoriBotの `スクリプトマークアップ形式` を `絵文字` に設定すると、これらのUnicode絵文字が保持されてIrodoriに送信されます。

サポートされている絵文字とその意味については、[アップストリームの絵文字注釈](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) を参照してください。絵文字はスタイルのヒントであり、結果が異なる場合があります。

## 長い音声メッセージ

長いテキストはチャンクに分割され、1つの音声メッセージとして返されます。長いリクエストはデフォルトの240秒のタイムアウトを超える可能性があるため、必要に応じて `TTS_SYNTHESIZE_TIMEOUT_MS` を調整してください。チャンク分割を無効にするには `IRODORI_CHUNKING_ENABLED=false` を設定し、分割のしきい値を調整するには `IRODORI_CHUNK_MIN_CHARS` を設定します。

## Swayサンプリングによる高速推論

デフォルトはIrodoriの高品質な40ステップの線形サンプリングのままです。レイテンシを低くするには、より少ないステップでのSwayサンプリングを試してください：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

これは推論の品質と速度のトレードオフであるため、恒久的な設定にする前に、選択したチェックポイントと音声でテストしてください。

## 環境変数

| 変数 | デフォルト | 目的 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Faceモデルリポジトリ、またはサポートされているリポジトリ/サブフォルダーの指定 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 任意のローカル `.pt` または `.safetensors` チェックポイント。設定時はHugging Faceモデルより優先 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | サーバーのバインドアドレス。[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を参照 |
| `IRODORI_TTS_PORT` | `8013` | サーバーのポート |
| `IRODORI_MODEL_DEVICE` | `auto` | モデルデバイス（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | コーデックデバイス |
| `IRODORI_MODEL_PRECISION` | CUDAでは `bf16`、それ以外は `fp32` | モデルの精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | コーデックの精度 |
| `IRODORI_COMPILE_MODEL` | `false` | Irodoriモデルで `torch.compile` を有効化 |
| `IRODORI_COMPILE_DYNAMIC` | `false` | コンパイル時に動的形状を有効化 |
| `IRODORI_NUM_STEPS` | `40` | Eulerサンプリングのステップ数 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | サンプリングスケジュール（`linear` または `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | `sway` スケジュール使用時のSway係数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | テキストガイダンススケール |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | キャプション / VoiceDesignガイダンススケール |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参照話者ガイダンススケール |
| `IRODORI_MAX_REF_SECONDS` | チェックポイント側のデフォルト | 参照音声の長さの任意の上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 長いテキストを適切な句読点境界で分割し、生成されたチャンクを連結 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 強い文末境界で分割されるまでの最小非空白文字数。カンマはこの値の約1.5倍でフォールバック境界となる |
