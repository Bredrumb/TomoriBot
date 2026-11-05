---
title: "WhisperXの文字起こし"
sidebar:
  order: 1
aiGenerated: true
---

バンドルされている [WhisperX](https://github.com/m-bain/whisperX) サーバーを使用して、TomoriBotのローカルで正確な音声認識をセットアップします。WhisperXは、単語レベルのアライメントによる高速音声転写を提供します。

## セットアップ

TomoriBotリポジトリルートから次のコマンドを実行します。

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

TomoriBotがWhisperXを使用している間は、そのターミナルを開いたままにしてください。デフォルトのエンドポイントURLは `http://127.0.0.1:8021` です。Windowsでは、`localhost` の代わりに `127.0.0.1` を使用してください。

## モデルの選択

サーバーを起動する前に `WHISPERX_MODEL` を設定します。

| `WHISPERX_MODEL` | サイズ | 用途 |
|---|---|---|
| `large-v3` | 1.55B | 多言語で最高の精度。turboより約0.6 GiB多いVRAMを使用 |
| `large-v3-turbo` | 809M | 多言語対応、より高速なデコーダー。日本語の精度はわずかに低下 |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | 日本語専用。日本語のテスト音声において同じ速度でturboよりも高精度 |

短い音声ではエンコーダーの処理が支配的となるため、3つとも同等の速度で動作します。対象言語とVRAM容量に応じて選択してください。`small` や `base` は日本語の精度が大きく落ちるため推奨しません。なお、極端に短い音声やほぼ無音のクリップでは、Whisperモデルが存在しないテキストを生成することがあります。

## GPU

利用可能な場合、サーバーは自動的にNVIDIA GPUを使用します。`http://127.0.0.1:8021/health` を確認してください。`device` が `cuda` と表示されているはずです。Windowsでは、音声認識を行うために `PATH` 上にCUDA 12のcuBLASおよびcuDNNのDLLが必要です。これらがない場合、サーバーは起動時に `GPU found but unusable` と出力してCPU上で動作します（非常に低速になります）。DLLをインストールしてサーバーを再起動してください。`WHISPERX_DEVICE=cuda` を設定している場合は、代わりに起動時にサーバーが停止します。

## TomoriBotへの登録

`/providers` を実行し、`新しいカスタムエンドポイントを追加` を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

接続を保存したら、それを選択し、モデルのドロップダウンから `WHISPERX_MODEL` の正確な値（デフォルトは `large-v3`、または `kotoba-tech/kotoba-whisper-v2.0-faster` などの完全なリポジトリID）を文字起こしモデルとして追加します。

エンドポイントの登録とモデルのセットアップには `/providers` を使用してください。その後、`/config` > モデル > モデルの切り替え を開き、登録したエンドポイントを選択して有効化します。

## トランスクリプトを使用する

登録後、TomoriBotはバックグラウンドで音声添付ファイルを文字起こしし、テキストをチャットコンテキストに追加します。トランスクリプトをチャットに視覚的にも投稿したい場合にのみ、`/config` > 動作 > 通知動作 を使用します。
