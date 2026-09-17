---
title: "Fish Audio S2 Pro"
---

Fish Audio S2 Proは、高忠実度の音声クローンと表現力豊かな発話に特化した多言語4BのTTSモデルです。TomoriBotは`servers/tts/fishs2/`にあるローカルラッパーを通じてこれを使用します。

TomoriBotの標準セットアップでは、合成品質を最大化し量子化による非互換を避けるため、公式のBF16重み（`fishaudio/s2-pro`）を使用します。メモリに制約のあるコンシューマーGPUを使うユーザー向けには、環境変数のオーバーライドでオプションのINT8重みのみ量子化版（`Imagilux/fishaudio-s2-pro`）にも対応しています。

Fish S2 Proは`[whisper]`、`[excited]`、`[angry]`のような角括弧表現タグに対応しています。TomoriBotが生成する音声スクリプト内でこれらの制御を保持できるよう、エンドポイントを**ブラケットタグ**マークアップで設定してください。

## ライセンス

Fish Speechのコードおよびs2-Proのモデル重みは、Fish Audio Research Licenseの下で配布されています。研究目的と非商用利用はその条件の下で許可されていますが、商用利用には別途Fish Audioのライセンスが必要です。

TomoriBotはモデルの重みを再配布しません。セルフホストする各ユーザーは、Hugging Faceから直接Fish S2 Proをダウンロードし、Fish Audio Research Licenseを順守する責任を負います。必要なクレジット表記は**Built with Fish Audio**です。

## ハードウェアとオペレーティングシステム

> [!IMPORTANT]
> **Fish SpeechにはLinuxまたはWSL2を使用してください。** Fish AudioはLinuxおよびWSL2を公式にターゲットとしています。Fish S2 Proはデュアル自己回帰（Dual-AR）アーキテクチャ（低速トランスフォーマー36層＋高速コードブックパス10回＝1トークンあたり76層評価）を使用します。Linuxでは、OpenAI Tritonがこの入れ子ループを融合GPUカーネル（`torch.compile(backend="inductor")`）にコンパイルでき、上流のベンチマークによればLinuxサーバーGPUでリアルタイム合成が可能になります。ラッパーは既定でコンパイルを無効にしているため、使用するには`FISH_S2_COMPILE=1`を設定してください。
>
> ネイティブのWindowsではTritonがサポートされていないため、PyTorchは未コンパイルのeagerモードとなり、Windowsの WDDMドライバーを通じて12万回を超える逐次CUDAカーネルディスパッチが発生します。これにより深刻なディスパッチストールが起こり、まったく同じクリップの生成が**約8〜10分**（音声1秒あたり約65秒の計算時間）にまで遅くなります。実用的な推論のためには、**Fish S2 ProをLinuxまたはWSL2内で実行してください**。

推奨ハードウェア:

- **Linux または WSL2（強く推奨）**
- **16 GB〜24 GBのVRAM**を搭載したNVIDIA GPU（BF16はKVキャッシュとオフロードを使えば約16〜18 GBのVRAMに無理なく収まります）
- Python 3.12を推奨
- Fish Speechが必要とする`git`、`ffmpeg`、標準的な音声ライブラリ

## セットアップ

### Linux / WSL2（推奨）

TomoriBotリポジトリのルートから実行します。

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

インストーラーは次の作業を行います。

1. `Imagilux/fish-speech`を`servers/tts/fishs2/fish-speech/`にクローンし、固定されたランタイムコミットをチェックアウトする。
2. 独立した`.venv`を作成する。
3. Fish SpeechとTomoriBotラッパーの依存関係をインストールする。
4. 公式BF16の`fishaudio/s2-pro`チェックポイントを`fish-speech/checkpoints/fish-speech-s2-pro/`にダウンロードする。

通常の再インストールでは、移動し続けるブランチではなく、固定されたランタイムコミット
`2225e924e7d35cc0a1d24dbc67cd1819e6cf429f`にとどまります。モデルのリビジョンは既定で`main`
ですが、デプロイの再現性が必要な場合は`FISH_S2_MODEL_REVISION`を不変のHugging Faceリビジョンに
固定してください。インストーラーの設定項目は[インストーラー変数](#インストーラー変数)にまとめて
あります。

Hugging Faceのこのモデルはゲート付きです。事前にHugging Face上でライセンスに同意してください。ダウンロード時に認証を求められた場合は、次を実行します。

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

その後、インストーラーを再実行してください。

### Windows PowerShell（ベストエフォートのみ）

ネイティブのWindowsは評価目的でのみ提供されています。未コンパイルのeagerモードによるドライバーのディスパッチ遅延のため、生成は非常に遅くなります（1クリップあたり約8〜10分）。

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

このPowerShellインストーラーは、既定でCUDA GPUアクセラレーション（`cu124`）をターゲットにします。NVIDIA GPUを搭載しないCPUのみのマシンにインストールするには、`-Cpu`を渡してください。

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Windows上でPyTorchをCUDA対応で手動インストールまたは更新する必要が生じた場合は、次を実行します。

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBotは`TTS_SYNTHESIZE_TIMEOUT_MS`（既定240000ミリ秒）を過ぎると音声メッセージの待機を打ち切り
ますが、これはネイティブWindowsでのクリップ生成にかかる時間よりも短い値です。Windowsで評価する間は、
TomoriBotの`.env`でこの値を引き上げてください（例: `TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 参照文字起こしは必須です

> [!WARNING]
> **音声クローンには参照テキスト（`ref_text`）が必須です。** Fish S2 Proのクロスアテンション機構は、音素トークンを音響コードと整合させるために参照音声の文字起こしを必要とします。
>
> 対応する参照文字起こしを与えずに音声サンプルをアップロードすると、Fish Speechは**参照音声トークンを黙って破棄**し、無条件のランダムな音声にフォールバックします。TomoriBotのFishラッパーは、参照テキストを欠いた合成リクエストを検証し、意図しない無条件生成を防ぐために`400 Bad Request`で拒否します。

`/config`の**モデル > TTSパラメーターと音声**でペルソナの音声を追加する際は、必ず**参照書き起こし**欄に参照音声クリップで実際に話されている一言一句を入力してください。

## TomoriBotへの登録

`/providers`で**新しいカスタムエンドポイントを追加**を選び、次のように設定します。

- 機能: 音声
- API互換性: `tts-clone`
- エンドポイントURL: `http://127.0.0.1:8015`
- 音声ソースモード: 音声クローン
- スクリプトマークアップ形式: ブラケットタグ
- APIキー: 既定のループバック構成では空欄のままにします。ベアラー認証を有効にしている場合は、`FISH_S2_API_KEY`の値を正確に入力してください。

続いてエンドポイントのモデルエントリを追加し、`/config`のモデル > モデルの切り替えから有効化します。

## ペルソナ音声の追加

1. 背景ノイズがほとんどまたはまったくない、話者1人による10〜20秒のクリアな参照クリップを準備します。
2. `/config`でモデル > TTSパラメーターと音声を開き、音声サンプルをアップロードします。
3. 参照クリップで実際に話されている**文字起こしを正確に**参照テキスト欄へ入力します。
4. `/config`でペルソナ > 音声を開き、そのサンプルをペルソナに割り当てます。
5. `/generate voice-message`で音声メッセージを生成するか、TomoriBotのvoice-messageツールに生成させます。

## 表現制御

Fish S2 Proは、角括弧タグを使って1つの発話の中でも発話の調子を変えられます。例:

```text
[whisper] 声を抑えて。 [excited] え、本当に見つけたの？
```

このエンドポイントは`Bracket Tags`マークアップを使用するため、TomoriBotは合成前にこれらのタグを取り除かず保持します。

## 設定

| 変数 | 既定値 | 用途 |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Fish Speechランタイムのディレクトリ |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Proチェックポイントのディレクトリ |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 設定済みチェックポイントのモデルリポジトリおよびヘルスメタデータのラベル |
| `TOMORI_TTS_HOST` | `127.0.0.1` | TomoriBotラッパーのバインドアドレス |
| `FISH_S2_PORT` | `8015` | Fishラッパーのポート。未設定時は`TOMORI_TTS_PORT`にフォールバック |
| `TOMORI_TTS_PORT` | 未設定 | 後方互換の共有ポートオーバーライド |
| `FISH_S2_API_KEY` | 未設定 | 任意のベアラートークン。認証付きリモートバインドにも必要 |
| `TOMORI_TTS_API_KEY` | 未設定 | `FISH_S2_API_KEY`が未設定の場合の共有ベアラートークンのフォールバック |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | ベアラートークンなしのループバック以外のバインドを明示的に許可 |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | デコード後の参照WAVの最大サイズ |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | 未設定 | 共有のデコード済み参照音声上限のフォールバック |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | 内部Fish APIのバインドアドレス |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部Fish APIのポート |
| `FISH_S2_COMPILE` | `0` | Fish Speechの`torch.compile`を有効化（Linux/WSL2とTritonが必要） |
| `FISH_S2_HALF` | `0` | FP16ランタイムモードを要求 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fishの反復プロンプトのチャンク長 |
| `FISH_S2_TOP_P` | `0.8` | サンプリングのtop-p |
| `FISH_S2_TEMPERATURE` | `0.8` | サンプリング温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 繰り返しペナルティ |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 1リクエストあたりに生成される意味トークンの最大数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fishランタイム内でエンコード済み参照音声をキャッシュ |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | ラッパーが受け付けるスクリプトの最大文字数 |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | 内部のFish APIの起動を待つ最大時間 |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | 1回の上流合成リクエストを待つ最大時間 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | `bun run launch --fishs2`がラッパーのヘルスチェックを待つ時間 |

### インストーラー変数

`install-fishs2.sh`と`install-fishs2.ps1`が読み込みます。デプロイを再現できるよう、オーバーライドした値は記録しておいてください。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Fish Speechランタイムのリポジトリ。例えばレビュー済みのミラーなど |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | インストール時にチェックアウトされるランタイムコミット |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | ダウンロードするHugging Faceのリポジトリ |
| `FISH_S2_MODEL_REVISION` | `main` | ダウンロードするHugging Faceのリビジョン |
| `FISH_S2_UPDATE` | `0` | ランタイムを意図的に更新しモデルを再ダウンロードするには`1`を設定 |
| `FISH_S2_UPDATE_REF` | 未設定 | 更新時のランタイムref。未設定の場合、明示的な`FISH_S2_RUNTIME_REF`があればそれを維持し、なければ更新は`main`を使用 |
| `FISH_S2_UPDATE_MODEL_REVISION` | 未設定 | 更新時のモデルリビジョン。優先順位は`FISH_S2_UPDATE_REF`と同じ |

参照音声は、空でない非圧縮のPCM RIFF/WAVEファイルである必要があります。デコード後のサイズ上限は、
過大なbase64リクエストが無制限にメモリを消費するのを防ぐため、推論前にチェックされます。

## 低VRAM向けオプション（INT8量子化）

VRAMに制約のあるGPU（例えば8〜12 GB）で動かしており、公式BF16チェックポイントが収まらないユーザーは、INT8量子化モデル（`Imagilux/fishaudio-s2-pro`）を選択できます。

INT8チェックポイントをインストールして実行するには:

```bash
# Linux / WSL2の場合:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# Windows PowerShellの場合:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

ラッパーがBF16の既定ディレクトリではなくINT8ディレクトリを読み込むように、同じシェルから`server.py`を起動するか、起動前に同じ3つの変数を設定してください。

INT8チェックポイントは、音声埋め込みとコーデック層をBF16のまま保ちつつ、トランスフォーマー重みを約10.3 GBから約5.1 GBに削減し、合計約10 GBのVRAM内に収まります。
