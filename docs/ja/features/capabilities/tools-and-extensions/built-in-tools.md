---
title: "組み込みツール"
sidebar:
  order: 0
---

ツールは、ツール呼び出しをサポートするアクティブなプロバイダーとモデルに依存します。多くは、機能フラグ (`/config` > 権限)、Discord権限、モデル機能、またはオプションのAPIキーの背後でゲートされています。

:::tip
機能が利用できないと思われる場合は、彼女に理由を尋ねてください。サーバーの機能フラグと、アクティブなモデルがツール呼び出しをサポートしているかどうかを報告でき、通常は修正すべき設定の名前がわかります。
:::

| ツール | プロンプトマクロ | 必要条件 | 動作 |
|---|---|---|---|
| 機能を確認 | `{capabilities_tool}` | - | 応答する前に、現在のチャット機能、コマンド、または設定を確認します。 |
| 長期記憶の作成/更新 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 安定したサーバー情報やユーザー設定を保存または置き換えます。 |
| 短期記憶を更新 | `{short_term_memory_tool}` | - | 現在のチャンネルまたはストーリーの一時的な作業記憶を保存します。 |
| タスクの作成/更新 | `{task_tool}` / `{task_update_tool}` | - | リマインダーやセルフタスクをスケジュールまたは編集します（[スケジュールされたタスク](/features/capabilities/scheduled-tasks/) を参照）。 |
| クロスチャンネルメッセージ | `{cross_channel_tool}` | - | 必要に応じて報告を行いつつ、別のチャンネルやスレッドで活動します。 |
| スレッドを作成 | `{create_thread_tool}` | `thread_creation_enabled` + スレッド権限 | 公開スレッドを開き、その開始メッセージを投稿します。 |
| ダイスを振る | - | `dice_rolling_enabled` | 公開でダイスを振り、返された結果をロールプレイで使用します。 |
| スタンプを選択 | `{sticker_tool}` | `sticker_usage_enabled` | 一致するサーバースタンプやカスタム表現を返信に追加します。 |
| メッセージの管理 | `{manage_message_tool}` | `manage_message_enabled` | 最近のメッセージをピン留め、編集、または削除します（ピン留めには「メッセージの管理」が必要です）。 |
| ユーザーをブロック/ブロック解除 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | ペルソナ単位でユーザーをミュート/ブロックします（記憶には影響しません）。 |
| 最近のメッセージに反応 | `{message_interaction_tool}` | - | 最近のメッセージにリアクションするか、短い返信を送信します。 |
| プロフィール画像を見る | `{profile_picture_tool}` | ビジョンモデルまたは `vision_llm` | ユーザーまたはペルソナのアバターを確認します。 |
| ドキュメントを読む | `{document_tool}` | - | PDFまたは任意のUTF-8テキストファイルからテキストを抽出します：ソースコード（`.py`/`.ts`/`.rs`/…）、`.json`、`.yaml`、`.md`、`.txt`、およびバイナリ以外の添付ファイル。 |
| メッセージメタデータを表示 | `{message_metadata_tool}` | - | 正確なターゲット設定のために、直近のターンにハンドルとタイムスタンプを付与します。 |
| YouTube動画を処理 | `{youtube_tool}` | 動画対応モデル | 特定のYouTubeリンクをオンデマンドで分析します。 |
| 画像を分析 | `{image_analysis_tool}` | 設定された `vision_llm` | 画像の認識を別のビジョンモデルに委任します。 |
| 画像・アニメ画像の生成 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 対応プロバイダー | 画像を生成または編集します（[メディア生成](/features/capabilities/media-generation/image-generation/) を参照）。 |
| Danbooruタグ検索 | `{tag_search_tool}` | `danbooru_enabled` | キャラクター名、ニックネーム、タグの推測を正確なDanbooruタグに変換します（[Danbooruタグ検索](/features/capabilities/tools-and-extensions/danbooru/) を参照）。 |
| Danbooruイラスト検索 | `{booru_post_search_tool}` | `danbooru_enabled` | 1つまたは2つのタグで既存のDanbooru画像を最大4枚投稿します（[イラスト検索と投稿の読み込み](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading) を参照）。 |
| Danbooru投稿の読み込み | - | `danbooru_enabled` | IDまたはリンクから1つのDanbooru投稿のグループ化されたタグを読み込みます。 |
| 音声メッセージを生成 | `{voice_message_tool}` | ElevenLabsキー + ペルソナボイス + `voice_message_enabled` | Discordで音声返信を送信します。 |

:::note[プロンプト作成者向け]
システムプロンプトやペルソナの指示をカスタマイズする際は、ツール名を直接記述するのではなく、上の表の**プロンプトマクロ**で参照してください。マクロはコンテキスト組み立て時に正しい名前に展開され、ツールが利用できない場合にも適切に縮退動作します。
`{pin_tool}` と `{timestamp_refresh_tool}` は、`{manage_message_tool}` と `{message_metadata_tool}` の互換エイリアスとして引き続き機能します。Web検索とURLツールにもマクロがあります：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}`、`{url_metadata_tool}`。これらは、サーバーMCPによる代替品を含め、利用可能な最適なエンジンへ動的に解決されます。
:::

### 条件付きプロンプトブロック

上記のツールマクロをサポートするプロンプトテキストは、スコープ付き条件文もサポートします：

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

有効なTomoriBot設定には `capability:<name>` を使用し、アクティブなプロバイダーとモデルで正確なツールが利用可能な場合にのみテキストを表示する場合は `tool:<function_name>` を使用します。バンドルされたURLリーダーまたはサーバーMCPの代替品が利用可能な場合は、`tool_family:url_fetch` を使用します。条件を反転するには、条件の前に `!` を付けます。ブロックはネストでき、1つの `{{else}}` を含めることができます。一般的な `and`/`or` 式はサポートされていません。

サポートされている機能名は、`tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory`、`time_awareness` です。

ツールの条件には、プロバイダー/モデルのサポート、サーバー設定、構成されたバックエンド、MCPによる代替、および現在の明示的ツールモードの許可リストが反映されます。これらは、ツールの実行時に行われるDiscord権限チェックを回避したり予測したりするものではありません。不明な機能名はfalseとして評価され、ログに記録されます。不正な形式のブロックは省略されます。生のチャットメッセージ、モデル出力、ツールの結果が条件付きテンプレートとして扱われることはありません。
