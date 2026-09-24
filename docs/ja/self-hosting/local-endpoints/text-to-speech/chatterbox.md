---
title: "Chatterbox TTS"
---

`servers/tts/chatterbox/server.py`を使うと、対応済みイベントタグ付きの英語音声クローンが行えます。高速モデルの経路は既定でChatterbox-Turbo（350Mパラメーター）を使用します。より小型でCPU向けのデプロイにはChatterbox-Nano（110Mパラメーター）を選べます。このラッパーはChatterbox Multilingual V3を読み込みません。

## セットアップ

以下のコマンドは、TomoriBotをクローンしたフォルダーであるTomoriBotリポジトリのルートから実行します。

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

TomoriBotがChatterboxを使用している間は、そのターミナルを開いたままにしてください。既定のエンドポイントURLは`http://127.0.0.1:8011`です。別のポートを使う場合は`CHATTERBOX_PORT`を設定します。

### オプション: Chatterbox-Nanoを使う

Nanoには、`nano=True`のローダーオプションに対応したChatterboxのビルドが必要です。上記の通常のセットアップの後、同じ仮想環境に固定された上流リビジョンをインストールします。このコミットハッシュは互換性のあるソースの版を固定するものであり、セキュリティを保証するものではありません。このコマンドには`git`が必要で、既にインストール済みのランタイム依存関係はそのまま維持されます。

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

続いて、ラッパーを起動する前に`CHATTERBOX_FAST_MODEL=nano`を設定します。Turboを使う場合はこの変数を未設定のままにします。Windows PowerShellでは`$env:CHATTERBOX_FAST_MODEL = "nano"`、Linuxまたは macOSでは`CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`を使用してください。`/health`のレスポンスは`fast_model`を報告するため、読み込まれた選択を確認できます。NanoとTurboは同じクローンリクエストと対応済みイベントタグを使用し、どちらも英語専用です。

NanoまたはTurboを使うには、`/config`の高速モデル切り替えを有効のままにしておく必要があります。これを無効にすると、CFG weightとexaggerationの調整用に標準のChatterbox 0.5Bモデルが選ばれます。

### 標準Chatterbox（CFGとExaggerationを備えた0.5B）

元となる0.5BのベースChatterboxモデル（`ChatterboxTTS`）は、サーバーラッパーに直接組み込まれています。Turboのインライン角括弧イベントタグの代わりに、**Classifier-Free Guidance（`cfg_weight`）**と感情の**`exaggeration`**による細かな声の制御を行います。

標準モデルを使用するには次の手順を実行します。
1. いつも通りサーバーラッパーを起動します。
2. Discordで`/config` > **モデル** > **TTSパラメーターと音声**を実行します。
3. **Chatterbox高速モデル**オプションを**無効**に切り替えます。
4. 次の生成時に、ラッパーが標準の0.5Bモデルを遅延ダウンロードしてメモリに読み込みます。

どちらの値も**Chatterboxパラメーターの編集**モーダル内のテキストフィールドです。常に編集可能で、高速モデルが有効な間は無視される旨がページに注記されています。
- **`cfg_weight`**（既定`0.5`）: 合成された音声が参照のテンポと声のスタイルにどれだけ忠実に従うかを調整します。
- **`exaggeration`**（既定`0.5`）: 発話の感情の強さと大げさな抑揚を制御します。

> [!NOTE]
> 標準Chatterboxは、`[laughs]`や`[sigh]`のようなインラインの角括弧イベントタグに対応していません。Chatterbox高速モデルの切り替えが無効のとき、TomoriBotはプロンプトテキストから角括弧タグを自動的に取り除きます。

## TomoriBotへの登録

エンドポイントのラベルまたはモデル名に`Chatterbox`を含めてください。TomoriBotはその名前（またはそれを含むエンドポイントURL）でのみChatterboxエンドポイントを認識するため、Turboのタグ許可リスト、標準モデルでのタグ除去、`/generate voice-message`のChatterbox専用オプションは、その名前が含まれている場合にのみ適用されます。

`/providers`を実行し、**新しいカスタムエンドポイントを追加**を選んで、音声用のAPI互換性を使用します。

- API互換性: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

接続を保存したら、それを選択し、モデルのドロップダウンから音声モデルを追加します。音声ソースモードには音声クローンを、スクリプトマークアップ形式にはブラケットタグを選び、発話タグが送信の過程で失われないようにします。

エンドポイントの登録とモデルのセットアップには`/providers`を使用します。続いて`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化してください。

## ペルソナ音声のセットアップ

1. 背景音楽のない、1人の話者による10秒のクリアな音声クリップを準備します。
2. `/config`でモデル > TTSパラメーターと音声を開き、そのクリップをアップロードします。
3. `/config`でペルソナ > 音声を開き、ペルソナと音声サンプルを選択します。

Chatterboxでは、クリップを長くしても意味はありませんが、拒否されることもありません。そのランタイムは条件付けの前に参照を切り詰めるため、ウィンドウを超えた音声はアップロードされ、保存された後に無視されます（[`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py)、[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)）：

- 音響プロンプトは、すべてのバリアントで最初の10秒です。
- 音声トークンの文脈は、TurboとNanoでは最初の15秒、Standardでは6秒です。

これらのウィンドウは公開された指針ではなく、上流のランタイムにおける定数です：リポジトリのREADMEには参照クリップの長さが示されておらず、例として示しているファイル名も`your_10s_ref_clip.wav`だけです。ランタイムが実際に強制する長さは最小値だけで、プロンプトが5秒より長いことを要求します。

したがって、10秒が実用的な目標です。これは音響プロンプトを完全に満たし、音色と話し方が決まる部分です。10秒から15秒の間のクリップは、TurboとNanoに限り音声トークンの文脈を追加します。話者埋め込みは依然としてクリップ全体から計算されるため、長くしても話者の同一性は変わらず、未読のまま破棄されるプロンプトの量が変わるだけです。

高速モデルの切り替えが有効な場合、TurboとNanoは`[laugh]`や`[sigh]`のような角括弧イベントタグを使用できます。

## オプションのチューニング

`/config`のモデル > TTSパラメーターと音声を使って、Chatterboxのリクエストペイロードを調整します。

- 高速モデルの切り替えは既定で有効です。TomoriBotは対応済みのTurbo/Nanoイベントタグを保持し、ラッパーが`ChatterboxTurboTTS.generate(...)`を呼び出す前に、未対応の角括弧記述子を取り除きます。
- `cfg_weight`は既定`0.5`です。最小値は`0`で、TomoriBotはハードな最大値を設定していません。これは`turbo`が`false`のときにのみ適用され、値を下げると速すぎる参照音声を落ち着かせるのに役立ち、値を上げるとより強く参照に従います。
- `exaggeration`は既定`0.5`です。最小値は`0`で、TomoriBotはハードな最大値を設定していません。これは`turbo`が`false`のときにのみ適用され、値を上げると発話がより表現豊かまたは大げさになり、話す速度が速くなることがあります。

対応済みのTurbo/Nanoイベントタグは`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`、`[laugh]`です。`[excited]`、`[whisper]`、`[smiles]`のような未対応の記述子は、TTSへ送られる代わりに取り除かれます。

`turbo`が無効な場合、TomoriBotはテキストをTTSへ送る前にすべての角括弧記述子を取り除き、その後ラッパーが標準の`ChatterboxTTS`モデルを遅延読み込みして`model.generate(..., cfg_weight, exaggeration)`を呼び出します。
