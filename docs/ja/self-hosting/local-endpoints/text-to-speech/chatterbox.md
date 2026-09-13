---
title: "Chatterbox TTS"
---

`servers/tts/chatterbox/server.py`は、英語の音声クローンと対応済みイベントタグを提供します。高速モデルの標準はChatterbox-Turbo（350M）で、より小さいChatterbox-Nano（110M）も選べます。このラッパーはMultilingual V3を読み込みません。

## セットアップ

TomoriBotのリポジトリのルート（TomoriBotをクローンしたフォルダー）から以下のコマンドを実行します。

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

TomoriBotがChatterboxを使用している間は、そのターミナルを開いたままにしてください。デフォルトのエンドポイントURLは`http://127.0.0.1:8011`です。

### オプション：Chatterbox-Nanoを使う

Nanoには`nano=True`に対応したChatterboxが必要です。通常のセットアップ後、同じ仮想環境で固定した上流リビジョンをインストールします。コミットハッシュは対応するソースの版を固定するもので、セキュリティを保証するものではありません。`git`が必要で、既にインストールされた実行環境の依存パッケージは維持されます。

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

ラッパーを起動する前に`CHATTERBOX_FAST_MODEL=nano`を設定します。未設定ならTurboを使います。Windows PowerShellでは`$env:CHATTERBOX_FAST_MODEL = "nano"`、Linux/macOSでは`CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`を使います。`/health`の`fast_model`で実際の選択を確認できます。NanoとTurboは同じクローン形式と対応済みイベントタグを使い、どちらも英語専用です。

NanoまたはTurboを使うには、`/config`の高速モデル設定を有効にしてください。無効にすると、CFG weightとExaggerationを調整できる従来の標準モデルが選ばれます。Nanoにはこれらの設定は適用されません。

## TomoriBotへの登録

`/providers`で **Add New Custom Endpoint** を選びます。

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

保存したエンドポイントを選択し、**Add or Edit a Model** で新しい音声モデルに以下を設定します。

- `Voice Source Mode`: `Clone`
- `Script Markup Style`: `Bracket Tags`

登録すると、エンドポイントはすぐに有効になります。今後、speechエンドポイントを切り替える場合にのみ`/providers`を使用します。

## ペルソナ音声のセットアップ

1. 背景音楽のない、1人の話者による10〜20秒のクリアな音声クリップを準備します。
2. `/config`を実行してクリップをアップロードします。
3. `/config`を実行し、ペルソナと音声サンプルを選択します。

高速モデル設定が有効な場合、TurboとNanoは`[laugh]`や`[sigh]`などのイベントタグを使用できます。

## オプションのチューニング

Chatterboxのリクエストペイロードを調整するには、`/config`を使用します。

- 高速モデル設定は標準で有効です。TomoriBotは対応済みのTurbo/Nanoイベントタグを保持し、ラッパーが`ChatterboxTurboTTS.generate(...)`を呼び出す前に未対応の角括弧記述を削除します。
- `cfg_weight`のデフォルトは`0.5`です。最小値は`0`で、TomoriBotはハード的な最大値を設定していません。これは`turbo`が`false`の場合にのみ適用され、値を低くすると速い参照音声を遅くするのに役立ち、値を高くすると参照音声に強く従うようになります。
- `exaggeration`のデフォルトは`0.5`です。最小値は`0`で、TomoriBotはハード的な最大値を設定していません。これは`turbo`が`false`の場合にのみ適用され、値を高くすると配信がより表現豊かまたはドラマチックになり、話すスピードが速くなる場合があります。

対応済みのTurbo/Nanoイベントタグは`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`、`[laugh]`です。未対応の`[excited]`、`[whisper]`、`[smiles]`などは送信前に削除されます。

`turbo`が無効な場合、TomoriBotはテキストをTTSに送信する前にすべてのブラケット記述子を削除し、ラッパーが標準の`ChatterboxTTS`モデルを遅延読み込みして、`model.generate(..., cfg_weight, exaggeration)`を呼び出します。
