---
title: "提示词宏"
sidebar:
  order: 5.5
---

提示词宏会在 TomoriBot 准备回复时插入当前名称、可用工具和其他值。使用条件区块可以只在条件成立时才包含相应指令。

## 名称宏
<!-- anchor: names -->

在已保存的提示词、属性、示例对话、世界书和记忆中使用名称宏。在上下文提醒中，请使用 `{@userId}`。

| 宏 | 插入内容 | 示例 |
| --- | --- | --- |
| `{bot}`、`{char}` | 当前生效人格的名称。 | 当 Lilya 生效时，`You are {char}.` 会变为 `You are Lilya.`。 |
| `{user}` | 触发本次回复的人。在共享提示词、属性、世界书和服务器记忆中，它会变为 `User`。在个人记忆中，它会指代该记忆所描述的人。 | 在示例对话中，当 Mirri 触发回复时，`Hi, {user}!` 会变为 `Hi, Mirri!`。 |
| `{user_formatted}` | 触发回复用户的名称，附带当前生效人格使用的前缀与后缀。 | Lilya 的英文预设集会将 Mirri 的 `Hi, {user_formatted}!` 变为 `Hi, Mirri-senpai!`。 |
| `{user_term}` | 当前生效人格对触发回复用户的称呼词。 | Rose 的英文预设集会使用 `fam`（中性）、`bro`（男性）或 `sis`（女性）。 |
| `{@123456789012345678}` | 拥有该 ID 的 Discord 用户的昵称，即使本次由其他人触发了回复。 | 若其保存的昵称为 `Navigator`，`Ask {@123456789012345678}.` 会变为 `Ask Navigator.`。 |

名称宏支持单大括号或双大括号，且不区分大小写。例如，`{{char}}` 和 `{CHAR}` 都可以生效。在共享的系统或人格提示词中，请使用 `{user_formatted}` 或 `{user_term}` 来指代触发本次回复的人。这两个宏在回复预填充中会按原样保留。在文本中使用 `{user_term}` 前，请先在该人格的`称呼习惯`中设置中性称呼词。

### 指代特定 Discord 用户
<!-- anchor: refer-to-a-specific-discord-user -->

开启`开发者模式`并复制对方的用户 ID。参见 [Discord 复制 ID 指南](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)。将数字放在 `@` 之后并包在单大括号内，例如 `Treat {@123456789012345678} as the ship's navigator.`。

TomoriBot 会依次尝试使用该成员对当前生效人格的昵称、来自 `/personal config` > `资料`的全局昵称，最后是其 Discord 用户名。如果服务器禁用了个人记忆、该成员在黑名单中，或者其隐私等级设为`完全`，她会直接使用其 Discord 用户名。如果无法解析名称，宏会按原样保留。

实时聊天会按原样保留该宏，包括原封不动引用进短期记忆的内容，或通过 `{{input}}` 或 `{{lastChatMessage}}` 复制到预设集中的聊天内容。当其他人格读取某个人格通过公开资料共享的属性时，该宏也会按原样保留。

### Discord 提及与链接

启用个人记忆时，用户提及（`<@userId>` 和 `<@!userId>`）会使用对方保存的全局昵称。它们会回退为服务器昵称或用户名，对于黑名单用户也是如此。如需解析人格专属昵称，请使用 `{@userId}`。

当 TomoriBot 能解析对应频道时，频道提及（`<#channelId>`）或 Discord 频道与消息链接会提供可读的频道标签。若当前服务器中存在对应身份组，身份组提及（`<@&roleId>`）会变为类似 `@Raid Guides` 的名称。无法解析的身份组提及会按原样保留。

## 随机选择

在组装提示词时，使用 `{{random: north, south}}` 或 `{{random::north::south}}` 来随机挑选一项。双冒号写法允许选项内部包含逗号。这两种写法也都支持单大括号。

## 工具宏
<!-- anchor: tool-macros -->

使用工具宏插入当前提供方和模型可用的函数名称。当没有可用工具时，内置宏会展开为 `an unavailable tool`。请将指令放进[条件区块](#conditional-prompt-blocks)中，以便在工具不可用时省略整句。关于每个工具的功能和开启所需的设置，请参阅[内置工具](/features/capabilities/tools-and-extensions/built-in-tools/)。

### 内置工具宏

| 宏 | 用于 `tool:` 条件的函数名 | 常用指令示例 |
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
| `{manage_message_tool}`、`{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`、`{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.`（仅在开发环境中可用。） |
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

`{pin_tool}` 和 `{timestamp_refresh_tool}` 是兼容别名。

### 搜索与 URL 宏

这些宏可以选择服务器 MCP 工具来替代内置函数。如果两者都不可用，它们会插入该工具的说明文字。

| 宏 | 选择的目标 |
| --- | --- |
| `{web_search_tool}` | 网页搜索工具或内置的 `web_search`。 |
| `{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}` | 对应请求媒体的搜索工具，不可用时回退到网页搜索。 |
| `{url_fetch_tool}` | URL 读取器或内置的 `fetch_url`。 |
| `{url_metadata_tool}` | 可检查 URL 的 MCP 工具，或内置的 `fetch_url`。 |

## 条件提示词区块
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| 条件 | 分支何时显示 |
| --- | --- |
| `{{if tool:<function_name>}}` | 该确切工具对当前提供方和模型可用。 |
| `{{if capability:<name>}}` | 所命名的功能已开启。 |
| `{{if tool_family:url_fetch}}` | 内置 URL 读取器或服务器 MCP 替代项可用。 |

在条件前加上 `!`（例如 `{{if !capability:time_awareness}}`）可以测试该条件是否不成立。每个区块最多使用一个 `{{else}}`，并用 `{{/if}}` 闭合。区块最多可嵌套 32 层。如需同时满足多个条件，请使用嵌套区块。

支持的功能名称包括 `tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory` 和 `time_awareness`。当当前模型不支持调用工具时，`tool_use` 为假。

工具条件会检查提示词组装时可用的工具，包括`明确工具模式`的限制。Discord 权限会在工具实际执行时检查。未知的功能名称会判定为假并产生警告。TomoriBot 会省略格式错误的区块；如果嵌套层数超过上限，条件标签会按原样保留。

## SillyTavern 预设集宏
<!-- anchor: sillytavern-preset-macros -->

下列额外宏可在 SillyTavern 预设集节点中使用。预设集节点同样支持上文介绍的身份、随机选择和工具宏。

| 宏 | 插入内容 |
| --- | --- |
| `{{user}}`、`<USER>` | 触发回复的成员。 |
| `{{char}}`、`{{bot}}`、`<BOT>` | 当前生效人格的名称。 |
| `{{personality}}` | 人格的属性。 |
| `{{description}}` | 人格的提示词。 |
| `{{scenario}}` | 为空。导入的卡片情境设定会合入人格属性中。 |
| `{{mesExamples}}` | 示例对话。 |
| `{{lastChatMessage}}`、`{{input}}` | 提供的聊天记录中最新一条用户消息。 |
| `{{time}}`、`{{date}}`、`{{weekday}}` | 英文格式的服务器时间、日期或星期，例如 `3:45 PM`、`October 28, 2026` 或 `Wednesday`。 |
| `{{isotime}}`、`{{isodate}}` | `HH:mm` 格式的服务器时间或 `YYYY-MM-DD` 格式的日期。 |
| `{{model}}`、`{{provider}}` | 配置的模型和提供方 ID。按轮次模型随机选取的结果和备用模型不会改变这些值。 |
| `{{char_version}}` | 为空。TomoriBot 不存储卡片版本。 |
| `{{roll:2d6}}` | 掷骰子总和，最多支持 100 颗骰子和每颗 1,000 面。 |
| `{{// notes}}` | 为空。用于在预设集中写注释。 |
| `{{trim}}` | 移除该节点前后的空白字符。 |
| `{{setvar::key::value}}`、`{{addvar::key::value}}` | 设置或在预设集各节点共享的变量中追加文本。 |
| `{{getvar::key}}` | 该变量的值；若未设置则为空。 |

`<USER>` 和 `<BOT>` 是区分大小写的兼容标记。五个日期与时间宏共用同一次时钟读取和服务器的固定 UTC 偏移。夏令时切换时请调整服务器偏移。当时间感知关闭时，这五个宏均为空。请将它们放在靠后或深度注入的节点中，以便较早的文本能继续命中提示词缓存。

### 预设集条件语句
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

像 `description` 这样的简写名称表示 `{{description}}`。你也可以把取值宏直接放进条件中，例如 `{{#if {{input}}}}`。TomoriBot 在判断值时会忽略大小写和前后空格。空文本、`false` 和 `0` 判定为假。未识别的取值宏视为空。

这些区块可以与[工具和能力条件](#conditional-prompt-blocks)嵌套使用。用 `{{/if}}` 闭合 `#if`，用 `{{/unless}}` 闭合 `#unless`。未闭合的预设集区块会在其所在节点的末尾结束。TomoriBot 会丢弃多余的闭合标签和 `{{else}}` 标签，并省略包含第二个 `{{else}}` 或闭合标签不匹配的区块。32 层嵌套上限同样适用于混合区块。

预设集条件可以看到节点顺序中更早出现的变量声明，包括同一节点中前面的声明。被跳过的预设集分支中的声明不会生效。条件之外的 `{{getvar::key}}` 会在 TomoriBot 访问完所有已启用节点后读取最终值。工具和能力条件会在变量赋值之后运行。

## 验证宏

对你想检查的人格和频道运行 `/tool prompt snapshot`。打开导出的文件并查看渲染后的指令。使用 `/context` 查看提示词的各个部分占用了多少空间。参见[查看提示词](/features/knowledge/inside-the-prompt/#inspecting-the-prompt)。
