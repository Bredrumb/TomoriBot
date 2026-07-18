---
title: "ツールと拡張"
sidebar:
  order: 1
---

TomoriBotは自律エージェントです。単なるチャットを超えて、**ツール**を呼び出し、ウェブ検索、ドキュメントの読み込み、メディアの生成、リマインダーの設定、他のチャンネルでの行動などを行うことができます。会話の内容に基づいて、いつツールを使用するかはトモリが決定します。このページでは、組み込みのツール、MCPサーバーを使用した拡張方法、および意図的ツールモード（Deliberate Tool Mode）を使用してツールの宣言をコンパクトに保つ方法について説明します。

## 組み込みツール

ツールの使用は、有効なプロバイダーやモデルがツール呼び出しをサポートしているかどうかに依存します。また、多くのツールは機能フラグ（`/capabilities`の切り替え）、Discordの権限、モデルの機能、またはオプションのAPIキーによって制限されています。

| ツール | プロンプトマクロ | 必要なもの | 説明 |
|---|---|---|---|
| Review capabilities | `{capabilities_tool}` | — | 回答する前に、現在のチャットの機能、コマンド、または設定を確認します。 |
| Create / update long-term memory | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | サーバーの永続的な事実やユーザーの好みを保存または上書きします。 |
| Update short-term memory | `{short_term_memory_tool}` | — (NovelAIでは使用不可) | 現在のチャンネルやストーリー展開に関する一時的な作業メモリーを保存します。 |
| Create / update task | `{task_tool}` / `{task_update_tool}` | — | リマインダーやセルフタスクをスケジュールまたは編集します（[スケジュール済みタスク](/ja/features/capabilities/scheduled-tasks/)を参照）。 |
| Cross-channel message | `{cross_channel_tool}` | — (NovelAIでは使用不可) | 別のチャンネルやスレッドで行動し、オプションで報告を返します。 |
| Create thread | `{create_thread_tool}` | `thread_creation_enabled` + スレッド権限 | 公開スレッドを作成し、開始メッセージを投稿します。 |
| Select sticker | `{sticker_tool}` | `sticker_usage_enabled` | 返信に一致するサーバーのスタンプを追加します。 |
| Manage message | `{manage_message_tool}` | `manage_message_enabled` | 最近のメッセージをピン留め、編集、または削除します（ピン留めには「メッセージの管理」権限が必要です）。 |
| Block / unblock user | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | ユーザーのペルソナごとのミュートやブロックを行います（メモリーには影響しません）。 |
| Interact with recent message | `{message_interaction_tool}` | — | 最近のメッセージにリアクションを付けたり、短い返信を送信したりします。 |
| Peek profile picture | `{profile_picture_tool}` | ビジョンモデルまたは`vision_llm` | ユーザーやペルソナのアバターを調べます。 |
| Read document | `{document_tool}` | — | PDFや**任意の**UTF-8テキストファイルからテキストを抽出します。ソースコード（`.py`/`.ts`/`.rs`/…）、`.json`、`.yaml`、`.md`、`.txt`、およびバイナリ以外の添付ファイルに対応しています。 |
| Reveal message metadata | `{message_metadata_tool}` | — | 正確なターゲティングのために、最近の会話にハンドルネームとタイムスタンプの注釈を付けます。 |
| Increase media context | `{media_context_tool}` | ビジョンモデル | コンテキストから外れた古い画像や動画をコンテキスト内に引き戻します。 |
| Process YouTube video | `{youtube_tool}` | 動画対応モデル | 要求に応じて、特定のYouTubeリンクを分析します。 |
| Analyze image | `{image_analysis_tool}` | 設定済みの`vision_llm` | 画像の理解を専用のビジョンモデルに委任します。 |
| Generate image / anime image | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 対応プロバイダー | 画像を生成または編集します（[メディア生成](/ja/features/capabilities/media-generation/)を参照）。 |
| Generate voice message | `{voice_message_tool}` | ElevenLabsキー + ペルソナの音声 + `voice_message_enabled` | 音声によるDiscordボイスメッセージの返信を送信します。 |

:::note[プロンプト作成者向け]
システムプロンプトやペルソナの指示をカスタマイズする際は、ツールの名前をハードコーディングするのではなく、上記の表にある**プロンプトマクロ**で参照してください。これらのマクロは、コンテキスト構築時に正しい名前に展開され、ツールが使用できない場合でも適切にフォールバックされます。`{pin_tool}`と`{timestamp_refresh_tool}`は、それぞれ`{manage_message_tool}`と`{message_metadata_tool}`の互換エイリアスとして引き続き使用できます。以下のウェブ検索およびURL関連ツールにもマクロがあります：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}`、`{url_metadata_tool}`。これらは、ギルドMCPによる置き換えを含め、利用可能な最適なエンジンに動的に解決されます。
:::

## ウェブ検索とURLの読み込み

モデルは単一の統合された`web_search(query, category)`ツールを認識します。この背後で、ディスパッチャーが各呼び出しをエンジンのチェーンを通してルーティングし、最初に成功したものを返します：

**Brave → SearXNG → DuckDuckGo → Felo**

- **Brave**は、Brave APIキーが設定されている場合に最初に実行されます（`/optional-key brave set`で設定します）。画像、動画、ニュースの検索が追加されます。⚠️ 予期しない請求を避けるため、Braveダッシュボードで5ドルの使用制限を設定してください。
- **DuckDuckGo**は、キーが設定されていない場合のデフォルトであり、レート制限に達した場合は**Felo**にカスケードします。
- **SearXNG**と**Crawl4AI**は、オプションのセルフホストサイドカーであり、より多くのカテゴリーとブラウザでレンダリングされたページの取得を可能にします。[セルフホスト](/ja/self-hosting/)を参照してください。

特定のページを読み込むには、`fetch_url`を使用します。これはNovelAIでは利用できません。

## MCPサーバー

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）サーバーを使用すると、自分で登録した外部ツールでトモリを拡張できます。

### オンラインMCPの追加

HTTPSエンドポイントを持つ公開されているMCPサーバーであれば、どれでも動作します。[Smithery.ai](https://smithery.ai)を例に挙げます：

1. アカウントを作成し、プロフィールからAPIキーを生成します。
2. カタログからMCPを開き、その**接続URL**をコピーします（例：`https://youtube.run.tools`）。
3. `/mcp add`を実行し、**URL**に接続URLを貼り付け、**Auth Token**にSmitheryキーを貼り付けます。

サーバーが認証を必要としない場合は、**Auth Token**を空白のままにしてください。認証トークンは保存時に暗号化され、二度と表示されません。`/mcp remove`を使用すると、いつでもサーバーを削除できます。これにより、即座に切断され、スロットが解放されます。

### ローカルMCPサーバー

ローカルMCPサーバーは**セルフホストのインスタンスでのみサポート**されています。パブリックホストのBotはHTTPSを必要とし、ローカル/プライベートアドレスをブロックします。自身のインスタンスを運用している場合は、[セットアップ：ローカルMCPサーバー](/ja/self-hosting/local-endpoints/setup-local-mcp/)を参照してください。

:::danger[信頼できるMCPサーバーのみを追加してください]
悪意のあるMCPサーバーは、隠し指示による**プロンプトインジェクション**、ユーザーがツールに渡したデータの**流出**、またはサーバーに送信される**有害/虚偽の結果**を返す可能性があります。MCPサーバーはブラウザの拡張機能と同様に扱ってください。疑わしい場合は追加しないでください。追加する前に、MCPに記述されているツールを常に確認してください。
:::

## 意図的ツールモード

宣言されたツールはすべてプロンプトに追加されます。**意図的ツールモード（Deliberate Tool Mode）**は、メッセージが実際にツールを必要としているように見えない限り、通常のチャットのやり取りからツール宣言を除外します。これにより、プロンプトのサイズが縮小され、小規模/ローカルモデルがより速く応答できるようになります。

- トモリはまず、メッセージに**ツールの意図**があるかどうかを確認します。組み込みのトリガーは、一般的なリクエスト（リマインダー、ウェブ検索、メモリーの更新、クロスチャンネルメッセージ、画像/動画/音声の生成、メディア分析、スレッドの作成、メッセージアクション）をカバーしています。音声メッセージのリクエストの後に「もっと怒りながらもう一回やって」などと言うような、フォローアップの表現でも機能します。
- サーバー管理者は、`/server trigger add`を使用して文字通りの**カスタムトリガーフレーズ**を追加できます。例えば、`pic`、`img`、または`pfp`を画像生成にマッピングするなどです。

### 制御

- `/server dtm`：サーバー管理者がオン/オフを切り替えます。
- `/personal dtm`：ユーザーが自身の設定を上書きします。
- 思考ログのチャンネル（`/server thought-logs`）が設定されている場合、成功した意図的ツールモードの呼び出しは、ツールを公開したトリガーとともにそこにログとして記録されます。

意図的ツールモードは、どのツールをモデルに*表示するか*を決定するだけです。モデルは依然として、いずれかのツールを呼び出すことを選択する必要があります。Discordでの概要については、`/help deliberate-tool-mode`を実行してください。

:::note
**意図的ツールモード（Deliberate Tool Mode）**（このセクション）は、*トモリ*がどのようにトリガーされるかを制御する**意図的トリガーモード（Deliberate Trigger Mode）**とは無関係です。[チャットとトリガー](/ja/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)を参照してください。どちらもDiscordでは「DTM」と略されます。
:::
