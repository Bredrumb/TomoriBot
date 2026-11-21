---
title: "プロンプトマクロ"
sidebar:
  order: 5.5
---

プロンプトマクロは、TomoriBotが返信を準備する際に現在の名前や利用可能なツールなどの値を挿入します。該当する場合にのみ指示を含めるには、条件付きブロックを使用してください。

## 名前マクロ
<!-- anchor: names -->

名前マクロは、保存されたプロンプト、属性、サンプル対話、ロアブック、および記憶で使用します。コンテキストノートでは `{@userId}` を使用してください。

| マクロ | 挿入される内容 | 例 |
| --- | --- | --- |
| `{bot}`, `{char}` | アクティブなペルソナの名前。 | Lilyaがアクティブな場合、`You are {char}.` は `You are Lilya.` になります。 |
| `{user}` | 返信をトリガーした人。共有プロンプト、属性、ロアブック、およびサーバーの記憶では `User` になります。個人の記憶では、その記憶が記述している相手の名前になります。 | サンプル対話では、Mirriが返信をトリガーした場合、`Hi, {user}!` は `Hi, Mirri!` になります。 |
| `{user_formatted}` | アクティブなペルソナが使用する接頭辞と接尾辞が付いた、トリガーしたユーザーの名前。 | Lilyaの英語プリセットでは、Mirriに対して `Hi, {user_formatted}!` が `Hi, Mirri-senpai!` に変わります。 |
| `{user_term}` | トリガーしたユーザーに対するアクティブなペルソナの呼びかけ語。 | Roseの英語プリセットでは、`fam`（中立）、`bro`（男性）、または `sis`（女性）を使用します。 |
| `{@123456789012345678}` | 別の人が返信をトリガーした場合でも、そのIDを持つDiscordユーザーのニックネーム。 | ニックネームとして `Navigator` が保存されている場合、`Ask {@123456789012345678}.` は `Ask Navigator.` になります。 |

名前マクロは単一または二重の中括弧を受け入れ、大文字と小文字を区別しません。たとえば、`{{char}}` と `{CHAR}` の両方が機能します。共有のシステムプロンプトまたはペルソナプロンプトで返信をトリガーした人を指すには、`{user_formatted}` または `{user_term}` を使用します。これら2つのマクロは応答プリフィルでは記述されたまま残ります。テキスト内で `{user_term}` を使用する前に、ペルソナの呼び方の癖で中立の呼びかけ語を設定してください。

### 特定のDiscordユーザーを参照する
<!-- anchor: refer-to-a-specific-discord-user -->

`開発者モード` を有効にして、その人のユーザーIDをコピーします。[DiscordのIDをコピーするガイド](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)を参照してください。`Treat {@123456789012345678} as the ship's navigator.` のように、単一の中括弧内の `@` の後ろに番号を配置します。

TomoriBotは、アクティブなペルソナでのその人のニックネーム、次に `/personal config` > プロフィール のグローバルニックネーム、次にDiscordユーザー名の順に使用します。サーバーで個人の記憶が無効になっている場合、その人がブラックリストに登録されている場合、またはプライバシーが `完全` に設定されている場合は、Discordユーザー名を使用します。名前を解決できない場合、マクロは記述されたまま残ります。

ライブチャットでは、短期記憶にそのまま引用されたチャットや、`{{input}}` または `{{lastChatMessage}}` でプリセットにコピーされたチャットを含め、マクロは記述されたまま残ります。ペルソナの公開プロフィールを通じて共有された属性も、別のペルソナが読み取るときには記述されたまま残ります。

### Discordのメンションとリンク

ユーザーメンション（`<@userId>` および `<@!userId>`）は、個人の記憶が有効な場合、保存されたグローバルニックネームを使用します。ブラックリストに登録されたユーザーを含め、該当しない場合はサーバーニックネームまたはユーザー名にフォールバックします。ペルソナ固有のニックネームを解決するには `{@userId}` を使用してください。

チャンネルメンション（`<#channelId>`）またはDiscordのチャンネルやメッセージリンクは、TomoriBotがチャンネルを解決できる場合、読み取り可能なチャンネルラベルを提供します。ロールメンション（`<@&roleId>`）は、現在のサーバーにそのロールが存在する場合、`@Raid Guides` のような名前になります。解決できないロールメンションは記述されたまま残ります。

## ランダム選択

プロンプト組み立て時に1つのオプションを選択するには、`{{random: north, south}}` または `{{random::north::south}}` を使用します。二重コロン形式ではオプション内にカンマを含めることができます。どちらの形式も単一の中括弧を受け入れます。

## ツールマクロ
<!-- anchor: tool-macros -->

現在のプロバイダーとモデルで利用可能な関数名を挿入するには、ツールマクロを使用します。利用可能なツールがない組み込みマクロは `an unavailable tool` に展開されます。ツールが利用できない場合に省略するには、指示を[条件付きブロック](#conditional-prompt-blocks)に入れてください。各ツールができることと有効にする設定については、[組み込みツール](/features/capabilities/tools-and-extensions/built-in-tools/)を参照してください。

### 組み込みツールマクロ

| マクロ | `tool:` 条件の関数名 | 恒常的な指示の例 |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Use {capabilities_tool} to check what you can do here before promising a feature such as stickers or voice messages.` |
| `{memory_tool}` | `create_long_term_memory` | `Save lasting member preferences, such as favorite party games, with {memory_tool} so you can use them in future chats.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Use {memory_update_tool} to revise the existing memory when a member corrects a saved preference or a moderator changes a recurring event.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `At roleplay scene breaks, use {short_term_memory_tool} to record where the party stopped, what clues they found, and what they plan to do next.` |
| `{task_tool}` | `create_task` | `Schedule game-night and poll reminders with {task_tool} when members request them. Confirm the scheduled time afterward.` |
| `{task_update_tool}` | `update_task` | `Use {task_update_tool} to reschedule the existing reminder when a member changes its time or repeat schedule.` |
| `{cross_channel_tool}` | `cross_channel_message` | `When asked to publish event results, post them in #announcements with {cross_channel_tool} and report back here.` |
| `{create_thread_tool}` | `create_thread` | `When members explicitly ask for a spoiler discussion thread, use {create_thread_tool} and open with a question about the episode.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebrate raid clears with {sticker_tool} when the server has a sticker that fits the moment.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.`（開発環境でのみ利用可能） |
| `{youtube_tool}` | `process_youtube_video` | `Use {youtube_tool} when members ask about a specific move shown in a linked YouTube guide.` |
| `{image_analysis_tool}` | `analyze_image` | `When helping with an error screenshot, read the visible error with {image_analysis_tool} before suggesting a fix.` |
| `{image_generation_tool}` | `generate_image` | `For requested event banners, use {image_generation_tool} and leave room for the event title.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Use {anime_image_generation_tool} for requested anime-style roleplay art. Keep the characters' established outfits.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resolve character nicknames and alternate spellings with {tag_search_tool} before searching for fan art.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `When members ask to browse existing anime fan art, post a small selection with {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Send quest briefings and dramatic recaps with {voice_message_tool} when players ask to hear them aloud.` |
| `{block_user_tool}` | `block_user` | `Use {block_user_tool} to apply a persona mute when a moderator asks to stop a member from triggering you for a set time.` |
| `{unblock_user_tool}` | `unblock_user` | `Use {unblock_user_tool} to lift a persona mute early when a moderator asks.` |
| `{user_info_tool}` | `update_user_info` | `Save a member's requested nickname or honorific for this persona with {user_info_tool}.` |

`{pin_tool}` と `{timestamp_refresh_tool}` は互換エイリアスです。

### 検索およびURLマクロ

これらのマクロは、組み込み関数の代わりにサーバーのMCPツールを選択できます。どちらも利用できない場合は、ツールの説明を挿入します。

| マクロ | 選択される対象 |
| --- | --- |
| `{web_search_tool}` | Web検索ツールまたは組み込みの `web_search`。 |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | リクエストされたメディア向けの検索ツール（利用できない場合はWeb検索にフォールバック）。 |
| `{url_fetch_tool}` | URLリーダーまたは組み込みの `fetch_url`。 |
| `{url_metadata_tool}` | URLを検査できるMCPツール、または組み込みの `fetch_url`。 |

## 条件付きプロンプトブロック
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| 条件 | 分岐が表示されるタイミング |
| --- | --- |
| `{{if tool:<function_name>}}` | その正確なツールがプロバイダーとモデルで利用可能な場合。 |
| `{{if capability:<name>}}` | 指定された機能が有効な場合。 |
| `{{if tool_family:url_fetch}}` | 組み込みのURLリーダーまたはサーバーMCPの代替ツールが利用可能な場合。 |

不在をテストするには、`{{if !capability:time_awareness}}` のように条件の前に `!` を付けます。1つのブロックにつき `{{else}}` は最大1つ使用でき、各ブロックは `{{/if}}` で閉じます。ブロックは最大32レベルまでネストできます。複数の要件を指定するにはネストされたブロックを使用してください。

サポートされている機能名は、`tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory`、`time_awareness` です。アクティブなモデルがツールを呼び出せない場合、`tool_use` はfalseになります。

ツール条件は、明示的ツールモードによる制限を含め、プロンプトの組み立て時に利用可能なツールを確認します。Discordの権限はツール実行時に確認されます。不明な機能名はfalseとして評価され、警告が出力されます。TomoriBotは不正な形式のブロックを省略し、ネストが上限を超えた場合は条件タグを記述されたまま残します。

## SillyTavernプリセットマクロ
<!-- anchor: sillytavern-preset-macros -->

これらの追加マクロは、SillyTavernプリセットノード内で機能します。プリセットノードでは、上記で説明した識別マクロ、ランダム選択マクロ、ツールマクロも使用できます。

| マクロ | 挿入される内容 |
| --- | --- |
| `{{user}}`, `<USER>` | 返信をトリガーしたメンバー。 |
| `{{char}}`, `{{bot}}`, `<BOT>` | アクティブなペルソナの名前。 |
| `{{personality}}` | ペルソナの属性。 |
| `{{description}}` | ペルソナのプロンプト。 |
| `{{scenario}}` | 空。インポートされたカードのシナリオはペルソナの属性になります。 |
| `{{mesExamples}}` | サンプル対話。 |
| `{{lastChatMessage}}`, `{{input}}` | 提供された会話履歴内の最新のユーザーメッセージ。 |
| `{{time}}`, `{{date}}`, `{{weekday}}` | 英語でのサーバー時刻、日付、または曜日（`3:45 PM`、`October 28, 2026`、`Wednesday` など）。 |
| `{{isotime}}`, `{{isodate}}` | `HH:mm` 形式のサーバー時刻または `YYYY-MM-DD` 形式の日付。 |
| `{{model}}`, `{{provider}}` | 設定されているモデルおよびプロバイダーのID。ターンごとのランダマイザーによる選択やフォールバックモデルではこれらの値は変わりません。 |
| `{{char_version}}` | 空。TomoriBotはカードのバージョンを保存しません。 |
| `{{roll:2d6}}` | ダイスロールの合計（最大100個のダイス、1個あたり最大1,000面）。 |
| `{{// notes}}` | 空。プリセット内のコメントに使用します。 |
| `{{trim}}` | ノードの先頭と末尾の空白を削除します。 |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | プリセットのノード間で共有される変数にテキストを設定または追記します。 |
| `{{getvar::key}}` | 変数の値、または未設定の場合は空。 |

`<USER>` と `<BOT>` は大文字と小文字を区別する互換トークンです。5つの日付と時刻のマクロは1つの時計の読み取り値とサーバーの固定UTCオフセットを使用します。サマータイムが変わった場合はサーバーオフセットを変更してください。時間認識の強化がオフの場合、5つすべてが空になります。それより前のテキストがプロンプトキャッシュの対象になり続けるように、後半または深度注入されるノードに配置してください。

### プリセット条件文
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

`description` のような単独の名前は `{{description}}` を意味します。`{{#if {{input}}}}` のように、条件内に値マクロを直接配置することもできます。TomoriBotは値をテストする際、大文字・小文字および前後の空白を無視します。空のテキスト、`false`、`0` はfalseになります。認識されない値マクロは空として扱われます。

これらのブロックは[ツールと機能の条件文](#conditional-prompt-blocks)とネストできます。`#if` は `{{/if}}` で、`#unless` は `{{/unless}}` で閉じます。閉じられていないプリセットブロックはそのノードの末尾で終了します。TomoriBotは余分な閉じタグや `{{else}}` タグを削除し、2つ目の `{{else}}` や一致しない閉じタグを含むブロックを省略します。32レベルの上限は混在ブロックにも適用されます。

プリセット条件文は、同じノード内の前方を含め、ノード順序で先にある変数宣言を参照します。スキップされたプリセット分岐内の宣言は効果を持ちません。条件外の `{{getvar::key}}` は、TomoriBotが有効なノードを巡回した後の最終値を参照します。ツールおよび機能条件は変数割り当ての後に実行されます。

## マクロを確認する

確認したいペルソナとチャンネルに対して `/tool prompt snapshot` を実行します。エクスポートファイルを開き、レンダリングされた指示を確認してください。プロンプトのどの部分が容量を占有しているかを確認するには、`/context` を使用します。[プロンプトの検査](/features/knowledge/inside-the-prompt/#inspecting-the-prompt)を参照してください。
