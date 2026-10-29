---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

[Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech) を使用して、きめ細やかな感情タグを備えた表現力豊かな多言語キャラクター音声を合成します。

Fish Audio S2 Proは、高忠実度の音声クローン作成用に構築された多言語4Bパラメーターのテキスト読み上げモデルです。TomoriBotは、`servers/tts/fishs2/` のローカルラッパーを介してモデルに接続します。デフォルトは公式のBF16の重み（`fishaudio/s2-pro`）で、8〜12 GBのVRAMを備えたGPU向けにオプションのINT8量子化チェックポイント（`Imagilux/fishaudio-s2-pro`）も用意されています。

Fish S2 Proは、`[whisper]`、`[excited]`、`[angry]` などのブラケット表現タグをサポートします。TomoriBotが生成された音声スクリプト内でこれらの制御を保持できるように、エンドポイントを `ブラケットタグ` マークアップ形式で設定してください。

## ライセンス

Fish SpeechのコードおよびS2 Proのモデルの重みは、Fish Audio Research Licenseの下で配布されています。研究目的および非商用利用はその条件の下で許可されていますが、商用利用には別途Fish Audioのライセンスが必要です。

TomoriBotはモデルの重みを再配布しません。セルフホストする各ユーザーはHugging Faceから直接Fish S2 Proをダウンロードし、Fish Audio Research Licenseを遵守する責任を負います。必要なクレジット表記は Built with Fish Audio です。

## ハードウェアとオペレーティングシステム

> [!IMPORTANT]
> 実用的な推論速度を得るには、LinuxまたはWSL2を使用してください。ラッパーはデフォルトでコンパイルを無効にしています。Tritonコンパイルを有効にするには `FISH_S2_COMPILE=1` を設定してください。ネイティブWindowsではクリップごとに8〜10分かかることがあります。

推奨ハードウェア：

- **LinuxまたはWSL2（強く推奨）**
- 16 GB〜24 GB VRAMを備えたNVIDIA GPU（BF16は、KVキャッシュとオフロードを備えた約16〜18 GB VRAMに快適に収まります）
- Python 3.12推奨
- `git`、`ffmpeg`、およびFish Speechに必要な標準音声ライブラリ

## セットアップ

### LinuxおよびWSL2（推奨）

TomoriBotリポジトリのルートから実行します：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

インストーラーは固定されたFish Speechランタイムと公式のBF16チェックポイントをダウンロードします。再現可能なモデルダウンロードを行うには、`FISH_S2_MODEL_REVISION` を不変のリビジョンに設定してください。

Hugging Faceモデルはゲートされています。まずHugging Faceでそのライセンスに同意してください。ダウンロード時に認証が求められた場合は、次を実行します：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

その後、インストーラーを再実行してください。

### Windows PowerShell（ベストエフォートのみ）

ネイティブWindowsは評価専用として提供されています。未コンパイルのeagerモードでのドライバーディスパッチの遅延により、生成は非常に遅くなります（クリップごとに約8〜10分）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

PowerShellインストーラーはデフォルトでCUDA GPUアクセラレーション（`cu124`）を対象としています。NVIDIA GPUのないCPU専用マシンにインストールするには、`-Cpu` を渡します：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Windows上のPyTorchを手動でインストールするか、CUDAサポート付きで更新する必要がある場合は、次を実行します：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBotは `TTS_SYNTHESIZE_TIMEOUT_MS`（デフォルト240000ミリ秒）が経過すると音声メッセージの待機を停止します。これはネイティブWindowsでのクリップ生成にかかる時間よりも短いです。Windowsでの評価中は、TomoriBotの `.env` でこの値を引き上げてください（例：`TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 必須の参照文字起こし

> [!WARNING]
> Fish S2 Proには参照クリップの正確な文字起こしが必要です。`/config` > モデル > TTSパラメーターと音声 の `参照テキスト` に入力してください。ラッパーはこれがないリクエストを拒否します。

## TomoriBotへの登録

`/providers` で `+ 新しいカスタムエンドポイントを追加` を選択し、次のように設定します：

- 機能：`音声`
- API互換性：`tts-clone`
- エンドポイントURL：`http://127.0.0.1:8015`
- 音声ソースモード：`音声クローン`
- スクリプトマークアップ形式：`ブラケットタグ`
- APIキー：空のままにします。ラッパーには認証がありません。[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を参照してください。

続いてエンドポイントのモデルエントリを追加し、`/config` の モデル > モデルの切り替え から有効化します。

## ペルソナ音声の追加

1. 背景ノイズがほとんどまたはまったくない、単一話者による10〜20秒のきれいな参照クリップを準備します。
2. `/config` で モデル > TTSパラメーターと音声 を開き、音声サンプルをアップロードします。
3. 参照クリップで実際に話されている**正確な文字起こし**を参照テキスト欄に入力します。
4. `/config` で ペルソナ > 音声 を開き、そのサンプルをペルソナに割り当てます。
5. `/generate voice-message` で音声メッセージを生成するか、TomoriBotの音声メッセージツールに生成させます。

アップストリームでは10〜30秒の参照サンプルを推奨しています。

## 表現制御

Fish S2 Proは、ブラケットタグを使用して1つの発話内でも表現の調子を変えることができます。例：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

エンドポイントが `ブラケットタグ` マークアップを使用するため、TomoriBotは合成前にこれらのタグを削除せず保持します。

## 設定

| 変数 | デフォルト | 目的 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Proチェックポイントディレクトリ |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 設定されたチェックポイントのモデルリポジトリおよびヘルス用メタデータラベル |
| `TOMORI_TTS_HOST` | `127.0.0.1` | ラッパーのバインドアドレス。[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を参照してください |
| `FISH_S2_PORT` | `8015` | Fishラッパーのポート |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部Fish APIのポート |
| `FISH_S2_COMPILE` | `0` | Fish Speechの `torch.compile` を有効化（Linux/WSL2とTritonが必要） |
| `FISH_S2_HALF` | `0` | FP16ランタイムモードを要求 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fishの反復プロンプトのチャンク長 |
| `FISH_S2_TOP_P` | `0.8` | サンプリングのtop-p |
| `FISH_S2_TEMPERATURE` | `0.8` | サンプリング温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 繰り返しペナルティ |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 1リクエストあたりに生成される最大意味トークン数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fishランタイム内でエンコード済み参照音声をキャッシュ |

### インストーラー変数

`install-fishs2.sh` と `install-fishs2.ps1` によって読み込まれます。デプロイを再現できるように、オーバーライドした値は記録しておいてください。

| 変数 | デフォルト | 目的 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | ダウンロードするHugging Faceリポジトリ |
| `FISH_S2_MODEL_REVISION` | `main` | ダウンロードするHugging Faceリビジョン |

参照音声は、デコード後10 MB以下の空でない非圧縮PCM RIFF/WAVEファイルである必要があります。この制限は過大なbase64リクエストが無制限にメモリを消費しないように推論前にチェックされ、TomoriBotが送信する22.05 kHzモノラルWAVで約237秒分を保持できます。

## 低VRAMオプション（INT8量子化）

公式のBF16チェックポイントが収まらない、VRAMが限られたGPU（例：8〜12 GB）を使用しているユーザーは、INT8量子化モデル（`Imagilux/fishaudio-s2-pro`）を選択できます。

INT8チェックポイントをインストールして実行するには：

```bash
# Linux / WSL2の場合：
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# Windows PowerShellの場合：
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

同じシェルから `server.py` を起動するか、起動前に同じ3つの変数を設定して、ラッパーがBF16のデフォルトではなくINT8ディレクトリをロードするようにしてください。

INT8チェックポイントは、音声埋め込みとコーデック層をBF16に維持しながら、トランスフォーマーの重みを約10.3 GBから約5.1 GBに削減し、合計約10 GBのVRAM内に収まります。
