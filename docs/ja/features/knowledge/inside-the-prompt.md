---
title: "プロンプトの中身"
sidebar:
  order: 2
---

TomoriBotをトリガーするたびに、以下の内容が組み立てられ、設定されたテキストモデルにメインプロンプト/コンテキストとしてこの順序で送信されます。

| ブロック | 任意？ | コマンド | 内容 |
|---|---|---|---|
| [**システムプロンプト**](/ja/features/chatting-personality/behavior-tweaking/#システムプロンプト) | | `/config` > 動作 > 一般的な動作 | コンテキストの最上部にある基本的な指示。 |

> **デフォルトのシステムプロンプトのテキスト**（サーバーのシステムプロンプトが未設定の場合のみ使用されます）：
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| ブロック | 任意？ | コマンド | 内容 |
|---|---|---|---|
| **チャンネルプロンプト（追加）** | *(任意)* | `/config` > チャンネル > チャンネルの個別設定 | チャンネルごとに異なり、システムプロンプトの直後に挿入されます。同じページの*replace*モードは、新しいブロックを追加するのではなく、上のシステムプロンプトの枠を完全に置き換えます。 |
| **ペルソナプロンプト** | *(任意)* | `/config` > ペルソナ > 高度な設定 | システムプロンプトとは別に、アクティブなペルソナ専用に書かれたプロンプト。 |
| [**ペルソナの属性**](/ja/features/chatting-personality/multiple-personas/#属性) | | `/config` > ペルソナ > アイデンティティと性格 | アクティブなペルソナの性格特性と話し方のパターン。 |
| **サーバー情報** | | *(なし、Discordから取得)* | サーバー名、説明、彼女がいるチャンネル。Discord自体から取得されます。 |
| [**ペルソナ・ユーザーブロック**](/ja/features/capabilities/tools-and-extensions/#組み込みツール) | *(任意)* | 確認/クリアは `/moderation`。`/config` > 権限 (User Blocking) でゲートされています | このペルソナが特定のユーザーに対して保持している有効なミュート/ブロック制限。 |
| [**サーバーの記憶**](/ja/features/knowledge/memory/#個人とサーバーの記憶) | | `/memories` | このサーバー用に保存された長期的な事実。 |
| [**サーバーの絵文字**](/ja/features/chatting-personality/behavior-tweaking/#機能の有効化許可する操作) | *(任意)* | `/config` > 権限 (Emoji Usage) (切り替えのみ)、初期化は `/expressions initialize` | サーバーに存在するカスタム絵文字。 |
| [**サーバーのスタンプ**](/ja/features/chatting-personality/behavior-tweaking/#機能の有効化許可する操作) | *(任意)* | `/config` > 権限 (Sticker Usage) (切り替えのみ)、初期化は `/expressions initialize` | サーバーに存在するカスタムスタンプ。 |
| [**ペルソナスプライト**](/ja/features/chatting-personality/multiple-personas/#スプライト表情アバター) | *(任意)* | `/config` > ペルソナ > スプライト | ペルソナに設定された、名前付きの表情スプライト（設定されている場合）。 |
| [**会話の参加者**](/ja/features/knowledge/memory/#個人とサーバーの記憶) | *(任意)* | `/personal memories` (`/config` > 権限 (Personalization) でゲートされています) | 会話に参加している人、そのニックネームとメンションハンドル、そして各人について保存された個人の記憶。その人がコンテキスト内にメッセージを持っている場合、またはその名前/エイリアスが言及された場合に読み込まれます。また、`/config` > 動作 > 一般的な動作 の設定を使用して、現在のチャンネルとローカル時刻をフッターとして追加します。 |
| [**短期記憶**](/ja/features/knowledge/memory/#短期記憶stm) | | `/config` > ペルソナ > 記憶; エントリをクリアするには `/memories`; `/config` > 権限 (Short-Term Memory) でゲートされています | 異なるチャンネルの要約と直近のメッセージが含まれます。 |
| [**ドキュメント**](/ja/features/knowledge/memory/#ドキュメント知識ベースrag) | *(任意)* | `/memories` | RAGを使用してナレッジベースから抽出された関連チャンク。 |
| [**条件付け**](/ja/features/knowledge/memory/#条件付け) | *(任意)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, `/conditioning remove` を介して管理 | このサーバーのこのペルソナに対する蓄積された行動的後押し。 |
| [**サンプル対話**](/ja/features/chatting-personality/multiple-personas/#サンプル会話) | *(任意)* | `/config` > ペルソナ > アイデンティティと性格 | 設定されている場合、このペルソナの話し方の例。 |
| [**直近のメッセージ**](/ja/features/chatting-personality/behavior-tweaking/#生成の調整) | | `/config` > 動作 > 一般的な動作 | 実際の会話。最大でこの件数まで（デフォルト80件）。コンテキストノートや再会ノートは、別々のブロックとしてではなく、設定可能な深さでこのブロック内にインラインで挿入されます。 |

*(任意)* とマークされた行は、一致するドキュメントがない場合やサーバーにカスタム絵文字がない場合など、言うべきことが何もないときは（トークンを消費せず）何も寄与しません。

直近のメッセージは最も大きく、最も脆い部分であり、人々が話すにつれて前方にスライドするウィンドウです。それより上のすべてのものは保存された設定から再構築されるため、安定しています。

`/tool prompt snapshot` は、あるペルソナの正確なバンドルをファイルにダンプします。これは、どの記憶が現在アクティブか、ドキュメントが一致したか、そして会話が実際にどれだけ収まったかを確認するための信頼できる情報源です。

`/tool estimate cost` は、同じバンドルをサイズごとに分類します。これは、制限を引き上げる前に何がコンテキストを消費しているかを把握するのに役立ちます。

### ツールはどこで定義されていますか？

TomoriBotがネイティブにサポートしているすべてのプロバイダーについて、ツールスキーマはプロバイダー自身の `tools` フィールドを介して送信されるため、プロバイダー/設定された推論エンジンに依存します。

### なぜTomoriBotは忘れるのですか？

この順序は、「なぜ彼女は覚えていないのですか？」という質問のほとんどを説明します。

| 起きたこと | 理由 |
|---|---|
| 今日の少し前のことを忘れた | メッセージの制限を過ぎてスクロールしました。それは**直近のメッセージ**の中にしかなかったため、Tomoriがそれを長期記憶として保存しない限り、メッセージウィンドウの外に出た時点で忘れられます。 |
| 別のチャンネルのことを忘れた | **直近のメッセージ**はチャンネルごとのものです。**サーバーの記憶**、**会話の参加者**、**短期記憶**のみがチャンネルをまたぎます。短期記憶は異なるチャンネルからの直近のメッセージを読み込むことでこれを補いますが、すべてをダンプするわけではありません。 |
| `/refresh` したら彼女が忘れた | リフレッシュは**直近のメッセージ**を切り捨て、このチャンネルの**短期記憶**をクリアしますが、長期記憶は削除しないはずです。切り捨てを削除するには、リフレッシュの埋め込みを削除してください。 |
| 再起動後に何かを忘れた | **直近のメッセージ**は再起動後には残りません。 |

上記すべてを乗り越えて残したいものがある場合は、それを**長期記憶**にする必要があります。[記憶](/ja/features/knowledge/memory/#長期記憶)を参照してください。

## ヒントとコツ

- `/config` > 動作 > 一般的な動作 は、会話のウィンドウを広げます（20〜100件）。コンテキストが増えるぶん、返信ごとのトークンも増えます。
- `/config` > 動作 > 一般的な動作 は、選択した深さで短いリマインダーを挿入します。これはバンドルの下部、直近のメッセージに近い位置にあるため、システムプロンプト内のものよりも行動に移される可能性が高くなります。これは、より頻繁に記憶を保存するように彼女を促すのに最適な場所です。
- `/personal memories` と `/memories` は、**サーバーの記憶**と**会話の参加者**に直接書き込みます。これは、TomoriBotのコンテキストで知識を永続的なものにする確実な方法の1つです。
