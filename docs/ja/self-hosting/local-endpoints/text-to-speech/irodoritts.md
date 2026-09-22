---
title: "IrodoriTTS"
---

Irodori-TTS v4.1は、日本語向けの音声合成モデルです。1つのチェックポイントでボイスクローニングとキャプションベースのボイスデザインに対応しています。TomoriBotでは`servers/tts/irodoritts/`のローカルFastAPIラッパーを介して実行します。

デフォルトモデルは`Aratako/Irodori-TTS-v4.1-Small`です。`IRODORI_TTS_MODEL_ID`を設定すると、`phasefield-audio/Irodori-TTS-v4.1-Anime`などの互換Hugging Faceチェックポイントも使用できます。

## セットアップ

現在のIrodoriは、依存関係とPyTorchバックエンドの管理に`uv`を使用します。先に`uv`をインストールし、TomoriBotリポジトリのルートからセットアップスクリプトを実行してください。

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

セットアップスクリプトは`servers/tts/irodoritts/.venv`を作成するため、インストール後も`bun run launch --irodoritts`をそのまま使用できます。

利用可能なバックエンド:

- `cu128`：Windows/LinuxのNVIDIA CUDA 12.8
- `cpu`：CPUのみ、またはmacOSのCPU/MPS
- `rocm`：Linux/WSLのAMD ROCm
- `xpu`：Windows/LinuxのIntel XPU

デフォルトのエンドポイントURLは`http://127.0.0.1:8013`です。

## 別のチェックポイントを使用する

デフォルトモデルは`Aratako/Irodori-TTS-v4.1-Small`です。環境変数を設定することで、互換性のあるHugging Faceリポジトリやコミュニティファインチューン（`phasefield-audio/Irodori-TTS-v4.1-Anime`など）、またはローカルのチェックポイントファイルを指定できます。

サイドカー起動時（Pythonによる直接起動、または`bun run launch --irodoritts`）、サーバーはリポジトリ直下の`.env`（または`servers/tts/irodoritts/.env`）を自動的に読み込み、起動時に使用中のモデルIDをログ出力します。

### `.env` を使用する場合（設定を保持）

TomoriBotのルートにある`.env`ファイルに追記します。

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### セッションごとに環境変数を指定する場合

Windows PowerShellの場合:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

Linux Bashの場合:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### ローカルのチェックポイントファイルを使用する場合

チェックポイントファイル（`.pt`または`.safetensors`）をローカルにダウンロードしている場合は、`IRODORI_TTS_CHECKPOINT`にファイルパスを指定します。

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

現在のIrodoriは、チェックポイントとHugging Faceリポジトリ内のトークナイザー資産をまとめて取得します。モデル側が提供している場合は、`IRODORI_TTS_MODEL_ID`でHugging Faceのサブフォルダ版も指定できます。

## TomoriBotへの登録

`/providers`で **新しいカスタムエンドポイントを追加** を選びます。

- API互換性: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

保存したエンドポイントを選択し、モデルドロップダウンから音声モデルを追加します。v4.1では以下の設定を推奨します。

- 音声ソースモード: 自動
- スクリプトマークアップ形式: 絵文字

自動では、同じIrodoriエンドポイントでTomoriBotの両方の音声モードを利用できます。エモーション表現も途切れません。

- ペルソナ > 音声で音声サンプルを割り当てたペルソナは、保存済みの参照音声を使ってボイスクローニングします。
- ペルソナ > 音声でボイスデザインプロンプトを設定したペルソナは、保存済みの自然言語プロンプトをIrodoriのキャプション条件として使用します。

参照音声によるボイスクローニングだけを使いたい場合は、音声ソースモードで従来どおり音声クローンを選択しても構いません。

登録すると、エンドポイントはすぐに有効になります。今後、音声エンドポイントを切り替える場合にのみ`/providers`を使用します。

## ペルソナ音声のセットアップ

### ボイスクローニング

1. 背景音楽のない、1人の話者によるクリアな日本語の音声クリップを準備します。30秒程度で十分です。それより長くしても声質の再現性はほとんど向上せず、アップロード容量と推論時間だけが増えます。
2. `/config`を実行し、モデル > TTSパラメーターと音声でクリップをアップロードします。
3. `/config`を実行し、ペルソナ > 音声でペルソナと音声サンプルを選択します。

Irodori v4.1は旧v2より長い参照条件に対応していますが、単純な長さよりも音声の品質のほうが重要です。

v4.1のランタイムは、参照クリップをチェックポイントのデフォルト値で上限を設けます。v4.1のチェックポイントでは、このデフォルト値が120秒です。それを超える音声は拒否されず、上限まで切り詰められ、`IRODORI_MAX_REF_SECONDS`で上限を変更できます。そのため、TomoriBotのアップロード上限である130秒のクリップもそのまま使用できます。Irodoriはその冒頭120秒を参照条件として使用します。

長ければよいというわけではありません。アップストリームの報告では、クリアな参照音声がおよそ30秒あれば、測定可能な話者類似度の向上の大部分が得られ、同じ話者の短いクリップを複数使うほうが1つの長い録音より優れています。また、クリップを長くすると参照のlatentステップが増え、合成リクエストのたびに時間がかかります。30秒を超える音声は、話者の声質が録音の中で変化する場合に限って使用してください。

### VoiceDesign

1. `/config`を実行し、ペルソナ > 音声を開きます。
2. ペルソナを選択します。
3. 希望する声質や話し方を自然言語で記述します。

TomoriBotはこのプロンプトを`instruct`として送信し、Irodoriラッパーがv4.1の`caption`条件に変換します。ボイスデザインでは参照音声は不要です。

TomoriBotはTTSへ送信する前にDiscordのカスタム絵文字構文を削除します。`script_markup: emoji`では、Unicode絵文字をIrodoriのテキスト条件用に保持します。

## 長い音声メッセージ

Irodori v4.1は固定長のクリップを生成するのではなく、duration predictorで出力長を予測するため、サイドカー側で1回の発話あたりの長さ上限を設けていません。それでもTomoriBotは長いテキストを合成前に分割し、生成した音声を1つのWAVレスポンスへ連結するため、Discord側には1つの音声メッセージとして届きます。分割によって各推論が短く保たれ、レイテンシが抑えられます。

実装は[公式Irodori OpenAI互換サーバー](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py)のチャンク処理を基準にしています。公式サーバーでは80文字の非空白文字を基準にチャンク処理がデフォルトで有効です。TomoriBotではさらに、閉じ引用符や閉じ括弧を直前の句読点と同じチャンクに残し、`！？`や`...`のような連続した終端記号をまとめ、数字に隣接する小数点では分割せず、短すぎる最後のチャンクを直前へ結合します。

設定した最小文字数に達すると、`。`、`！`、`？`、`.`、`!`、`?`、省略記号、改行などの強い文末を優先して分割します。カンマはチャンクがしきい値のおよそ1.5倍まで長くなった場合にだけフォールバック境界として使います。デフォルトの`IRODORI_CHUNK_MIN_CHARS=80`では、強い文末は非空白文字80文字から、カンマはおよそ120文字から分割候補になります。十分に長い文章でも分割候補の記号がなければ、1回の合成リクエストのままになる場合があります。

参照音声を使わないVoiceDesignでは、最初のチャンクで実際に使用されたIrodoriのseedを後続チャンクでも再利用し、チャンク間のランダムな変動を抑えます。同じseedを使っても、個別に合成されたチャンク間で声質が完全に一致する保証はありません。参照音声モードでは、同じ参照クリップを各チャンクへ適用します。

長文では複数回の推論を順番に実行するため、低速な環境では処理時間が大きく伸びる場合があります。TomoriBotのTTSクライアントのデフォルトタイムアウトは240秒です。`IRODORI_CHUNKING_ENABLED=false`でチャンク処理を無効化でき、`IRODORI_CHUNK_MIN_CHARS`でおおよその分割しきい値を調整できます。

## Sway Samplingで高速化

デフォルトは高品質寄りの40ステップlinear samplingです。レイテンシを下げたい場合は、ステップ数を減らしたSway Samplingを試せます。

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

品質と速度のトレードオフがあるため、常用する前に使用するチェックポイントと音声で確認してください。

## インストールスクリプトが簡単になった理由

以前のTomoriBotインストーラーはIrodoriの`pyproject.toml`にパッチを当て、`dacvae`を手動インストールし、古いv2時代のIrodoriコミットを固定していました。当時のパッケージ構成では必要な回避策でしたが、現在のIrodoriでは適切ではありません。

現在はサイドカー専用の`pyproject.toml`を用意し、アップストリームと同じ`uv`ベースのバックエンド構成を使います。再現可能なインストールのためIrodoriと`dacvae`の既知コミットは固定しますが、インストール時にアップストリームのソースコードを書き換えることはありません。

## 環境変数

| 変数 | デフォルト値 | 目的 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Faceモデル、または対応するrepo/subfolder指定 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 任意のローカル`.pt` / `.safetensors`チェックポイント。設定時はHugging Faceモデルより優先 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | サーバーのバインドアドレス |
| `TOMORI_TTS_PORT` | `8013` | サーバーポート |
| `IRODORI_MODEL_DEVICE` | `auto` | モデルデバイス（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | コーデックデバイス |
| `IRODORI_MODEL_PRECISION` | CUDAでは`bf16`、それ以外は`fp32` | モデル精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | コーデック精度 |
| `IRODORI_COMPILE_MODEL` | `false` | Irodoriモデルで`torch.compile`を有効化 |
| `IRODORI_COMPILE_DYNAMIC` | `false` | コンパイル時にdynamic shapesを有効化 |
| `IRODORI_NUM_STEPS` | `40` | Euler samplingのステップ数 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | サンプリングスケジュール（`linear` / `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | `sway`使用時の係数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | テキスト条件のguidance scale |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Caption / ボイスデザイン条件のguidance scale |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参照話者条件のguidance scale |
| `IRODORI_MAX_REF_SECONDS` | チェックポイント側のデフォルト | 参照音声長の任意上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 長文を分割して生成音声を1つに連結 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 強い文末で分割可能になる非空白文字数。カンマはこの値のおよそ1.5倍でフォールバック境界になる |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `1000` | 1リクエストあたりのテキスト長上限 |
