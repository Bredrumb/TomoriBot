---
title: "SillyTavernサポート"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "TomoriBotを使用して、SillyTavernのキャラクターカードとプロンプトプリセットをDiscordにインポートします。既存のキャラクターをサーバーに持ち込みましょう。"
sidebar:
  order: 2
---

TomoriBotは、[SillyTavern](https://github.com/SillyTavern/SillyTavern)からお持ちかもしれない2つのものをインポートできます。**プロンプトマネージャーのプリセット**（プロンプトのレイアウト方法）と、**キャラクターカード**（キャラクター自体）です。これはSTユーザー向けのニッチな機能です。SillyTavernを使用したことがない場合は、このページをスキップして構いません。

## キャラクターカードのインポート

既存のSillyTavernキャラクターを `/persona import` でDiscordに直接持ち込むことができます。以下を受け付けます：

- `chara` / `char` メタデータが埋め込まれた **PNGカード**
- **v2スタイルのJSON** カード（ルートレベルに `name`、`description`、`first_mes` など）
- **v3 JSON** カード（ネストされた `data` オブジェクトを持つ `spec: "chara_card_v3"`）
- **`.charx` アーカイブ**（キャラクターカード V3、カードサイトがデフォルトで配布する形式）

`.charx` ファイルは、`card.json` にキャラクター情報を保持するzipファイルです。TomoriBotはそのカードを読み取り、アーカイブ内の他のすべて（同梱されているアイコン、感情スプライト、音声、動画など）を無視します（インポートの返信でもその旨が通知されます）。`/server avatar` でアバターを設定し、`/config` > ペルソナ > スプライト でスプライトを追加してください。

ファイルにTomoriBotのメタデータがないものの、有効なST v2/v3カードである場合、インポートは自動的にSillyTavernの変換フローを通じて処理されます。また、カードを `/persona generate` に渡して、新しいペルソナに変換することもできます。

インポートされたデータは、保存される前に検証スキーマを通過します（デフォルトの上限：文字列あたり5,000文字、属性200個、会話サンプル各100個、トリガーワード100個（セルフホストの場合は `PRESET_MAX_*` 環境変数で調整できます））。アーカイブの読み込みは `MAX_CHARX_*` 環境変数によって個別に制限されます。これは、アーカイブの圧縮サイズからは展開後のサイズが分からないためです。正確な変換とフィールドのマッピングについては、[カードサポートのアーキテクチャ](/en/architecture/integrations/sillytavern/card-support/)を参照してください。

## プロンプトプリセット {#prompt-presets}

SillyTavernのプロンプトマネージャーのプリセットは、プロンプトの**レイアウト**を制御します。プリセットをインポートしたり、有効なノードを調べたり、プリセットを切り替えたり、通常のレイアウトに戻したりするには、`/config` > プラグイン > SillyTavernプリセット を使用します。

### プリセットが制御するもの

- プロンプトの順序とマーカーの配置
- カスタムプロンプトノード
- 履歴後（Post-history） / 深度挿入（depth-injection）ノード
- インポートされたノードの有効/無効の初期状態

### 置き換え*ない*もの

プリセットは*レイアウト*を管理するものであり、すべてのテキストソースを置き換えるわけではありません。以下は引き続きプリセットと並存します：

- システム/ペルソナブロック：`/config` > 動作 > 一般的な動作、`/config` > ペルソナ > 高度な設定、`/config` > ペルソナ > アイデンティティと性格 の属性および会話サンプルのアクション。
- 実際のチャット履歴と取得されたドキュメントのコンテキスト。
- TomoriBotの自動コンテキスト：サーバーの記憶、絵文字/スタンプのコンテキスト、会話中のユーザー、短期記憶、条件付け（conditioning）、および類似のブロック。

### ネイティブブロックのマッピング

- `main` → 現在のシステムプロンプト（`/config` > 動作 > 一般的な動作、それ以外は組み込みのフォールバック）
- `charDescription` → `/config` > ペルソナ > 高度な設定
- `charPersonality` → `/config` > ペルソナ > アイデンティティと性格
- `dialogueExamples` → `/config` > ペルソナ > アイデンティティと性格
- `chatHistory` → 実際のチャンネル履歴
- `worldInfoBefore` / `worldInfoAfter` → 取得されたドキュメントのコンテキスト（STのロアブックではありません）

### システムプロンプトルール

プリセットがアクティブな間、組み込みのフォールバックシステムプロンプトは削除されます。ただし、`/config` > 動作 > 一般的な動作 で*あなた*が独自のものを設定している場合は、引き続き送信されます。

### 互換性に関する注意事項

プリセットが無視されているように見える場合のよくある原因：

- インポート済み ≠ 送信済み：`prompt_order` で無効になっているノードは、`/config` > プラグイン > SillyTavernプリセット で有効にするまでオフのままです。コメントのみのノードや空のノードは送信されず、不明なマーカーはスキップされます。
- 順序は文字通りです。`chatHistory` を `dialogueExamples` の前に配置すると、実際のチャットが先に送信されます。
- 履歴後（Post-history）/ 深度挿入（depth-injection）は、独立したメッセージになるのではなく、既存のチャット履歴エントリにマージされます。同じ深度の複数のノードはバッチ処理されます。
- 正規表現による後処理、プリセット側のtemperature/top-p/モデルの上書き、および階層化されたプリセットはサポートされていません。従来のテキスト補完プリセットは、ST専用ブロック（シナリオ、アンカー、ストップ文字列など）を破棄するベストエフォートなパスを通じてインポートされます。

`/help` の **連携** から **SillyTavernプリセット** を選択すると、Discord内のリファレンスを確認できます。インポートエンジンの内部については、[プリセットシステムのアーキテクチャ](/en/architecture/integrations/sillytavern/preset-system/)を参照してください。
