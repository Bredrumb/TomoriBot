---
title: "TTSエンジンの比較"
aiGenerated: false
sidebar:
  order: 1
---

以下の同一テスト環境での合成時間と音声サンプルを比較してください。

## 多言語・英語の音声クローン

### ベンチマークプロンプト

- **標準プロンプト**（Chatterbox Standard/Turbo/Nano、MOSS-TTS、CosyVoice 3、VoxCPM2、Qwen3-TTSで使用）：
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Fish Audio S2 Proプロンプト**（ブラケット表現タグ付きでテスト）：
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### パフォーマンスと音声の比較

計測結果は、全体の生成時間（リクエストから音声完了までの総実時間、秒）と、生成時間を音声の長さで割ったリアルタイムファクター（RTF）の両方を報告します：

- **RTF < 1.0（太字）：** エンジンがリアルタイムよりも速く音声を生成します（例えば、`0.50× RTF` は10秒のクリップを5秒でレンダリングします）。ライブ音声通話に追従できるのはこれらのエンジンのみですが、TomoriBotは現在これを実装していません。
- **RTF > 1.0：** 生成に発話音声そのものよりも長い時間がかかります。TomoriBotは各音声メッセージを完全なファイルとして送信するため、RTFが高いことは単に待ち時間が長くなることを意味します。

| エンジン | Windowsネイティブ<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音声サンプル |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 約8〜10分<sup>(2)</sup><br/>*(~65× RTF)* | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox（Turbo、デフォルト）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約5.0秒 *(8.7秒のクリップ)*<br/>0.57× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox（Nano）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約3.0秒 *(8.0秒のクリップ)*<br/>0.38× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox（Standard）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約6.0秒 *(7.8秒のクリップ)*<br/>0.77× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 約12.0秒 *(8.8秒のクリップ)*<br/>1.36× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 約6.0秒 *(13.9秒のクリップ)*<br/>0.43× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 約8.0秒 *(7.4秒のクリップ)*<br/>1.09× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 約10.0秒 *(9.2秒のクリップ)*<br/>1.09× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **テスト環境**：NVIDIA GeForce RTX 4070 Ti SUPER（16 GB GDDR6X、Ada Lovelace）を搭載したWindows 11（ネイティブ実行）で、26.6秒・24 kHzモノラルの参照音声サンプルと、それに対応する逐語的な文字起こしを使用。
- <sup>(2)</sup> **Fish Audio S2 Pro**：Windowsでの実行は、トークンごとに76層の評価にわたるCUDAカーネル起動の遅延により、未コンパイルのeagerモードで実行されます（~65× RTF）。このディスパッチストールを回避するため、OpenAI Tritonコンパイラ融合（`torch.compile`）を備えたLinuxまたはWSL2での実行を推奨します。

---

## 日本語の音声クローン

### 日本語ベンチマークプロンプト

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### 日本語のパフォーマンスと音声の比較

| エンジン | Windowsネイティブ<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音声サンプル |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 約4.0秒 *(8.5秒のクリップ)*<br/>0.47× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> 同じRTX 4070 Ti SUPER搭載Windows 11のテスト環境で計測。

---

## エンジンの比較

TomoriBotは完全なWAVファイルを返します。モデルサイズはパラメーター数を示し、GPUメモリの数値はセットアップの目安です。上記の計測時間は1台のWindowsマシンによるものです。

参照の長さには、アップストリームの推奨事項とランタイム制限が含まれます。詳細については各エンジンのガイドを確認してください。

| エンジン | モデルサイズ；16 GB GPU | 言語 | 参照クリップ | 音声ソースと制御 | 速度 / ストリーミング経路 | 選ぶ理由 |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo（デフォルト）、110M Nano、または500M Standard。対応、NanoはCPUを使用可能 | 英語 | 10秒。10秒のプロンプトウィンドウを超えた分は自動的に無視されます | 参照クローン、サポートされているイベントタグ。標準モデルはCFG/誇張を提供 | 高速/小型重視。ラッパーは完全なWAVを返却 | 小規模な英語クローンのセットアップまたはCPUでの実験 |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 各モード1.7B。対応、モデルを入れ替え | 英語/日本語を含む10言語 | 3秒から。文書化された上限なし | クローンまたはテキストで指定されたVoiceDesign | 品質重視。アップストリームはストリーミング、ラッパーはバッファリング | 汎用の多言語クローンおよび日本語のVoiceDesign |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | クローン4B + 設計約1.7B（入れ替え）。16 GBは未検証の試用目標、8Bのフラッグシップはおそらく不可 | クローン：日本語を含む31言語、設計：英語/中国語 | アップストリームに記載なし。実行時の上限なし | クローンまたはテキストで指定されたVoiceGenerator。クローン言語タグ | 実験的。ローカルクローンにはアップストリームのストリーミングバックエンドがあるが、ラッパーはバッファリング | MOSSのクローン品質または英語/中国語の音声デザインの比較 |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 現行のv4.1 Smallで約0.8B。ローカル実行1件で約3〜4 GBのVRAMを観測 | 日本語のみ | 約30秒。チェックポイントの120秒の上限で切り詰められます | クローンまたはVoiceDesign。絵文字によるスタイルのヒント | サンプリングステップ数で品質と速度をトレードオフ。ラッパーはバッファリング | 省フットプリントな日本語音声と絵文字主導の配信 |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B。公式のBF16がデフォルト（約16〜18 GB）、16 GB向けのオプションのINT8あり | アップストリーム公称83言語 | 10〜30秒。実行時の上限なし | 参照クローン（参照文字起こしが必要）、自由形式のブラケット表現タグ | 重いDual-ARモデル。高速な合成にはTritonを使用するLinux/WSL2が必要（Windowsのeagerモードでは約65× RTF） | きめ細やかな表現力豊かなクローン。研究ライセンスの条件を確認してください |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B。アップストリームで約8 GBのBF16と報告 | 30言語 | 5〜30秒。文書化された範囲、実行時の上限なし | クローン、Voice Design、文字起こし支援のUltimate Cloning、配信指示 | アップストリームのRTX 4090で約0.30 RTF。アップストリームはストリーミング、ラッパーはバッファリング | 最も広範な音声ソース制御を備えた1つの多言語モデル |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | コアは0.5B。16 GBで快適、ダウンロード/ランタイムはより大 | 日本語を含む9言語、および中国語の方言 | 3〜30秒。それより長い場合は最初の30秒に切り詰められます | クローン、異言語クローン、自然言語での配信 | 低遅延重視。アップストリームでネイティブなテキスト/音声ストリーミング、ラッパーはバッファリング | 異言語クローンを備えた将来のストリーミング候補 |

モデルサイズと対応言語数は、[Chatterbox](https://github.com/resemble-ai/chatterbox)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS)、[Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro)、[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)、[CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) の各アップストリームページに準拠しています。OS、ドライバー、ライセンス、モデルリビジョン、メモリの詳細については各ガイドを確認してください。16 GBのGPUがTTSモデルと大規模なローカルLLMを同時にホストできるとは限りません。

最初のQwen3-TTS自動リクエストにはモデルのロードが含まれます。MOSSはセットアップ中に両方のモデルを事前ダウンロードし、デフォルトでは起動時にクローンモデルをウォームアップしますが、どちらの自動サーバーもモード切り替え後にもう一方のモデルをロードする必要があります。TomoriBotは各完全なレスポンスを `TTS_SYNTHESIZE_TIMEOUT_MS`（デフォルト240000ミリ秒）まで待機します。
