---
title: "VoxCPM2"
aiGenerated: true
---

OpenBMBの [VoxCPM2](https://github.com/OpenBMB/VoxCPM) テキスト読み上げモデルを使用して、30言語にわたる表現力豊かな48 kHz音声を合成します。

VoxCPM2は、音声クローン、文字起こし支援によるUltimate Cloning、および自然言語によるVoice Designをサポートする2Bパラメーターの多言語音声モデルです。TomoriBotは `servers/tts/voxcpm2/` のサーバーを介して公式 `voxcpm` Pythonライブラリに接続し、量子化されていない公式の `openbmb/VoxCPM2` BF16チェックポイントを16 GBのVRAM内で快適に実行します。

## ライセンス

VoxCPM2のコードとモデルの重みはApache-2.0の下で公開されており、ライセンス条件に従う商用利用も含まれます。TomoriBotはこの重みを再配布しません。インストーラーは公式のHugging Faceリポジトリからダウンロードします。

公式のアップストリームリソース：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Hugging Faceのopenbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPMのドキュメント](https://voxcpm.readthedocs.io/)

## 対応言語

VoxCPM2は、言語タグを必要とせずに公式に30言語をサポートしています：

アラビア語、ビルマ語、中国語、デンマーク語、オランダ語、英語、フィンランド語、フランス語、ドイツ語、ギリシャ語、ヘブライ語、ヒンディー語、インドネシア語、イタリア語、日本語、クメール語、韓国語、ラオ語、マレー語、ノルウェー語、ポーランド語、ポルトガル語、ロシア語、スペイン語、スワヒリ語、スウェーデン語、タガログ語、タイ語、トルコ語、ベトナム語。

OpenBMBはいくつかの中国語方言についても文書化しています。TomoriBotは一般的なTTSの規約との互換性のために `language` フィールドを送信することがありますが、VoxCPM2は合成テキストから言語を検出するため、ラッパーは言語タグを強制しません。

## 音声モード

クローンと音声デザインには、`自動` および `プレーン` マークアップを使用します。参照文字起こしを提供するとUltimate Cloningが有効になります。発話指示がある場合はそれが優先され、そのリクエストでは文字起こしが省略されます。

## ハードウェアとランタイム

推奨される出発点：

- Python 3.10〜3.12
- 公式BF16ランタイム向けに8 GB以上のVRAMを搭載したNVIDIA GPU（12〜16 GBあれば余裕を持って動作します）
- GPUアクセラレーション用の最新のNVIDIAドライバーとCUDA対応のPyTorchビルド
- CPUはフォールバックとしてサポートされていますが、大幅に低速です

公式パッケージはCPUとApple MPSのデバイス選択にも対応しています。Windows上のTomoriBotでは、標準のPythonパッケージがネイティブに動作するため、WSLは不要です。Windows PowerShell用インストーラーは、デフォルトでCUDA対応のPyTorchビルド（`cu124`）をインストールします。

CPU専用マシンに明示的にインストールするには、`-Cpu` スイッチを渡します：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

ネイティブWindowsのPyTorchインストールを手動で再インストールしたり、ドライバーとの整合を取り直したりする必要が生じた場合は、サーバーの仮想環境に直接CUDA対応のPyTorchビルドをインストールしてください：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## インストール

サーバーは現在の安定した `voxcpm` 2.0.3パッケージを固定し、`openbmb/VoxCPM2` を通常のHugging Faceキャッシュにダウンロードします。

### LinuxおよびWSL Bash

TomoriBotリポジトリのルートから実行します：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

TomoriBotリポジトリのルートから実行します：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

最初のセットアップでは、数ギガバイトのモデルの重みをダウンロードします。モデルをプリフェッチせずにPython環境をインストールするには、`VOXCPM2_PREFETCH=0` を設定します。公式ライブラリは、最初のサーバー起動時にチェックポイントをダウンロードします。

LinuxおよびWSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

セットアップ後、`bun run launch --voxcpm2` でTomoriBotとともにサーバーを起動します。デフォルトのエンドポイントは `http://127.0.0.1:8016` です。

## TomoriBotへの登録

`/providers` を実行し、`+ 新しいカスタムエンドポイントを追加` を選択して、音声エンドポイントを設定します：

- 機能：`音声`
- API互換性：`tts-clone`
- エンドポイントURL：`http://127.0.0.1:8016`
- 音声ソースモード：`自動`
- スクリプトマークアップ形式：`プレーン`
- 指示の対応：`有効`

接続を保存したら、それを選択し、モデルのドロップダウンを使用して音声モデルを追加します。続いて `/config` > モデル > モデルの切り替え を開き、VoxCPM2音声モデルを選択します。

同一のサーバーが参照音声のクローンとVoice Designの両方をサポートしているため、`自動` を推奨します。2つのモードのために別々のVoxCPM2プロセスを用意する必要はありません。

## ペルソナの音声クローン

既存の話者をクローンするペルソナの場合：

1. 単一話者でBGMがほとんどまたはまったくない、きれいな参照クリップを準備します。アップストリームは5〜30秒を実用的な範囲として扱っています。
2. `/config` の モデル > TTSパラメーターと音声 を開き、クリップをアップロードします。
3. 利用可能な場合は、参照クリップの正確な文字起こしを追加します。VoxCPM2はこれをUltimate Cloningに使用し、参照のリズム、感情、スタイルをより忠実に再現できます。
4. `/config` の ペルソナ > 音声 を開き、ペルソナを選択して、保存されたサンプルを割り当てます。

文字起こしが保存されていない場合でも、VoxCPM2は通常の参照音声クローンを実行します。

## ペルソナのボイスデザイン

サンプルの代わりに書かれた音声の説明から作成するペルソナの場合：

1. `/config` の ペルソナ > 音声 を開き、VoiceDesignを選択します。
2. ペルソナを選択します。
3. `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery` などの自然言語の説明を入力します。

クローン音声の場合、単発の発話指示が参照文字起こしよりも優先されます。

## 環境変数

| 変数 | デフォルト | 目的 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging FaceモデルIDまたはローカルモデルディレクトリ |
| `VOXCPM2_DEVICE` | `auto` | ランタイムデバイス：`auto`、`cuda`、`cuda:N`、`cpu`、または `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 公式ランタイムの最適化/コンパイルパスを有効化 |
| `VOXCPM2_LOAD_DENOISER` | `0` | オプションのアップストリームデノイザーをロード。メモリ節約のためデフォルトは無効 |
| `VOXCPM2_CFG_VALUE` | `2.0` | ガイダンス強度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | フローマッチング推論ステップ数。増やすと速度と引き換えに品質が向上する可能性あり |
| `VOXCPM2_MAX_LEN` | `4096` | 最大生成長 |
| `VOXCPM2_NORMALIZE` | `0` | アップストリームのテキスト正規化を有効化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 異常な生成に対するアップストリームの再試行動作を有効化 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 最大自動再試行回数 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | アップストリームの不良ケース長のしきい値 |
| `VOXCPM2_PREFETCH` | `1` | インストーラー専用：セットアップ中にモデルをダウンロード |
| `VOXCPM2_PORT` | `8016` | VoxCPM2ローカルサーバーのポート |
| `TOMORI_TTS_HOST` | `127.0.0.1` | ローカルサーバーのバインドアドレス。[ネットワークアクセス](/self-hosting/local-endpoints/text-to-speech/#network-access) を参照 |

参照音声はデコード後10 MB以下の空でないWAVコンテナである必要があり、ラッパーは一時ファイルを書き込む前にこれをチェックします。
