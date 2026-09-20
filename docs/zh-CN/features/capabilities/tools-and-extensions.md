---
title: "工具与扩展"
sidebar:
  order: 1
---

TomoriBot 是代理式的：除了聊天，她还能调用**工具**去搜索网页、读取
文档、生成媒体、设置提醒、在别的频道里行动等等。她会根据对话自行决定
什么时候使用它们。这一页讲内置工具、如何用 MCP 服务器扩展
她，以及如何用明确工具模式让工具声明保持精简。

## 内置工具

工具能否使用取决于当前生效的提供方与模型是否支持工具调用，而且很多工具还被
功能开关（`/config` > 权限 里的开关）、Discord 权限、模型能力，或者
一个可选 API 密钥所限制。

| 工具 | 提示词宏 | 需要 | 它做什么 |
|---|---|---|---|
| Review capabilities | `{capabilities_tool}` | 无 | 回答之前先检查当前的聊天能力、指令或设置。 |
| Create / update long-term memory | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 保存或替换一条稳定的服务器事实或用户偏好。 |
| Update short-term memory | `{short_term_memory_tool}` | （NovelAI 上不可用） | 为当前频道或剧情线保存临时工作记忆。 |
| Create / update task | `{task_tool}` / `{task_update_tool}` | 无 | 安排或编辑提醒与自我任务（见[定时任务](/zh-CN/features/capabilities/scheduled-tasks/)）。 |
| Cross-channel message | `{cross_channel_tool}` | （NovelAI 上不可用） | 在另一个频道或子区里行动，可选回报结果。 |
| Create thread | `{create_thread_tool}` | `thread_creation_enabled` + 子区权限 | 开一个公开子区并发出它的起始消息。 |
| Select sticker | `{sticker_tool}` | `sticker_usage_enabled` | 在回复里附上一张匹配的服务器贴纸。 |
| Manage message | `{manage_message_tool}` | `manage_message_enabled` | 置顶、编辑或删除近期消息（置顶需要 `Manage Messages`）。 |
| Block / unblock user | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | 按人格对某个用户禁言或屏蔽（不涉及记忆）。 |
| Interact with recent message | `{message_interaction_tool}` | 无 | 对一条近期消息做出表情回应，或者回一句短的。 |
| Peek profile picture | `{profile_picture_tool}` | 视觉模型或 `vision_llm` | 查看某个用户或人格的头像。 |
| Read document | `{document_tool}` | 无 | 从 PDF 或**任何** UTF-8 文本文件里提取文字：源代码（`.py`/`.ts`/`.rs`/……）、`.json`、`.yaml`、`.md`、`.txt`，以及任何非二进制的附件。 |
| Reveal message metadata | `{message_metadata_tool}` | 无 | 给近期发言标注句柄与时间戳，便于精确指向。 |
| Process YouTube video | `{youtube_tool}` | 支持视频的模型 | 按需分析某个 YouTube 链接。 |
| Analyze image | `{image_analysis_tool}` | 已配置的 `vision_llm` | 把图像理解交给一个独立的视觉模型。 |
| Generate image / anime image | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 有能力的提供方 | 生成或编辑图像（见[媒体生成](/zh-CN/features/capabilities/media-generation/)）。 |
| Generate voice message | `{voice_message_tool}` | ElevenLabs 密钥 + 人格语音 + `voice_message_enabled` | 发一条说出来的 Discord 语音回复。 |

:::note[给提示词作者]
在自定义她的系统提示词或人格指令时，请用上表里的**提示词宏**来引用工具，而不要写死工具名，因为宏会在拼接上下文时展开成
正确的名字，并在某个工具不可用时优雅降级。
`{pin_tool}` 和 `{timestamp_refresh_tool}` 仍然可以作为
`{manage_message_tool}` 和 `{message_metadata_tool}` 的兼容别名。下面的网页搜索与 URL 工具
也有宏：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、
`{news_search_tool}`、`{url_fetch_tool}` 和 `{url_metadata_tool}`：它们会动态
解析到当前可用的最佳引擎，包括服务器 MCP 提供的替代项。
:::

### 条件提示词区块

支持上述工具宏的提示词文本也支持带范围的条件：

```text
{{if capability:self_teaching}}
有值得记住的细节时，使用 {memory_tool}。
{{else}}
不要承诺保存长期记忆。
{{/if}}
```

用 `capability:<name>` 表示某个已启用的 TomoriBot 设置，用 `tool:<function_name>` 表示
仅当那个确切的工具对当前提供方和模型可用时，这段文本才出现。当内置的 URL 读取器或者服务器 MCP
提供的替代项任一可用时，用 `tool_family:url_fetch`。在条件前加 `!` 可以取反。区块可以嵌套，
并且最多包含一个 `{{else}}`；不支持通用的 `and`/`or` 表达式。

支持的功能名有 `tool_use`、`self_teaching`、`personal_memories`、
`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、
`image_generation`、`video_generation`、`voice_message`、`user_blocking`、
`short_term_memory` 和 `time_awareness`。

工具条件反映的是提供方与模型的支持情况、服务器配置、已配置的后端、
MCP 替代项，以及当前的明确工具模式允许清单。它们不会绕过或预测工具执行时
进行的 Discord 权限检查。未知的功能名会
判定为 false 并被记录下来；格式错误的区块会被省略。原始聊天消息、模型
输出和工具结果永远不会被当作条件模板处理。

## 网页搜索与 URL 读取

模型看到的是一个统一的 `web_search(query, category)` 工具。在它背后，一个调度器
把每次调用按引擎链依次路由，并返回第一个成功的结果：

**Brave → SearXNG → DuckDuckGo → IAsk**

- 配置了 Brave API 密钥时**Brave** 排在第一个（用
  `/providers` 设置）；它会增加图像、视频和新闻搜索。⚠️ 请在 Brave 后台设置 5 美元的用量上限，
  以免出现意外扣费。
- 没有设置密钥时**DuckDuckGo** 是默认项，在遇到速率限制或结果为空时级联到 **IAsk**。
- **SearXNG** 和 **Crawl4AI** 是可选的自行部署附属服务，能解锁更多分类
  以及浏览器渲染的页面抓取；见[自部署](/zh-CN/self-hosting/)。

要读取某个具体页面，她使用 `fetch_url`。它在 NovelAI 上不可用。

## MCP 服务器

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）服务器能用你自己
登记的外部工具扩展她。

### 添加在线 MCP

任何公开托管、带 HTTPS 端点的 MCP 服务器都可以。以
[Smithery.ai](https://smithery.ai) 为例：

1. 注册账号，并在个人资料里生成一个 API 密钥。
2. 在目录里打开一个 MCP，复制它的**连接 URL**（例如 `https://youtube.run.tools`）。
3. 打开 `/config` > 插件 > MCP 服务器，选择 **+ Add MCP**，把连接 URL 粘贴到 **URL**，把你的
   Smithery 密钥粘贴到 **Auth Token**，并选择所需的 **Server Type**。**General
   Purpose** 默认已选中。

如果服务器不需要认证，把 **Auth Token** 留空。你的认证令牌在静态存储时会被加密，
之后不再显示。打开同一个配置页面可以查看已配置的状态、启用或禁用一个服务器，
或者在明确确认后移除它。移除会立刻断开连接并释放一个槽位。
每一行已保存的记录还会显示它上次成功发现到的工具名列表（有长度上限）。**None
discovered** 是已知的零工具结果；**Discovery unknown** 表示这是一行历史遗留记录，或者是一个
还没有成功快照的服务器。打开 MCP 管理界面只会读取已保存的元数据，不会联系
远端服务器。

### 本地 MCP 服务器

本地 MCP 服务器**只在自部署实例上受支持**，因为公开托管的 bot
要求 HTTPS 并会拦截本地与私有地址。如果你自己跑实例，见
[设置：本地 MCP 服务器](/zh-CN/self-hosting/local-endpoints/setup-local-mcp/)。

:::danger[只添加你信任的 MCP 服务器]
一个恶意的 MCP 服务器可以用隐藏指令**提示词注入**她、**窃取**
用户传给它的工具的数据，或者返回**有害或错误的结果**让她转发到你的
服务器。把 MCP 服务器当成浏览器扩展来看：有疑虑就别加。添加之前
一定要先看过这个 MCP 描述的工具。
:::

## 明确工具模式

每一个声明的工具都会增加提示词长度。**明确工具模式**让工具声明在
普通聊天轮次里不出现，除非消息看起来确实需要一个工具；这能减小
提示词体积，并帮助更小的本地模型更快回答。

- 她会先检查消息里有没有**工具意图**。内置触发覆盖常见请求
  （提醒、网页搜索、记忆更新、跨频道消息、图像与视频与语音
  生成、媒体分析、创建子区、消息操作）。关于她当前
  模型、工具、设置，或者某项功能为何不可用的问题，会同时暴露能力查看与
  官方文档访问。后续措辞也有效，比如在一条语音消息请求之后说「再来一次
  但是更生气一点」。
- 服务器管理员可以用 `/server trigger add` 添加字面的**自定义触发短语**，
  例如把 `pic`、`img` 或 `pfp` 映射到图像生成。
- 内置触发读取的是英语措辞。其他语言通过
  各语言自己的关键词列表到达同样的工具。所有已发布语言的列表都会在每条消息上检查，
  不管你自己的语言设置是什么，所以一个双语服务器在两种语言下都能用。
- 日语、中文或韩语的自定义短语也会在更长的词内部匹配，因为这些
  语言不用空格分词。以 `*` 结尾的短语会匹配任何以它
  开头的词：`remind*` 覆盖 `reminder` 和 `reminding`。

### 控制项

- `/server dtm`：服务器管理员开关它。
- `/personal config`：用户为自己覆盖它。
- 配置了思考日志频道（`/server thought-logs`）之后，明确模式下成功的
  工具调用会连同暴露该工具的触发一起记录在那里。

明确工具模式只决定哪些工具*展示*给模型，但模型仍然要
自己选择调用其中一个。在 `/help` 里选择 **行为**，再选 **明确工具模式**，可以看到 Discord 里的说明。

:::note
**明确工具模式**（本节）与**明确触发模式**无关，后者
控制*她*如何被触发；见
[聊天与触发](/zh-CN/features/chatting-personality/chatting-and-triggers/#明确触发模式)。两者在 Discord 里
都缩写成「DTM」。
:::

## 结构化用户信息更新

内置的 `update_user_info` 工具处理明确提出的修改请求，可改已登记用户的
昵称、前缀、后缀、性别认同、人称代词、称呼风格或数字 UTC 偏移。
它使用和其他个人工具相同的、能感知重名的名字、别名、提及与 Discord ID 解析器。省略目标
就表示触发该轮发言的人；`all` 和 `everyone`
永远不是通配目标。

每个字段都是它自己的可选参数，所以一次修改通过传那个字段来表达。移除
则是传一个 `clear` 字段名列表，这样文本、枚举和数值字段
都遵循同一条规则；空字符串会被折算成一次移除，而不是被拒绝。没有范围或动作
参数，因为范围跟着字段走：

| 字段 | 存储方式 | 效果 |
|---|---|---|
| nickname、prefix、suffix | 按人格记忆谱系 | 只有做出这次修改的那个人格会用不同的方式称呼对方 |
| gender identity、pronouns、addressing style、timezone | 每位用户一份 | 所有的人格读到的是同一个值 |

这种划分跟随的是存储方式而不是偏好：身份类字段每位用户只有一个槽位，
没有按人格的对应物。成功提示会给按人格范围的记录行标上
人格的名字，所以这个区别是看得见的，而不必去猜。没有标注的记录行是全局的，
这一点本身不需要额外解释，因为全局才是那个不让人意外的情形。

参与者上下文会分别列出每位用户的前缀、后缀和昵称，所以一次
去掉称呼的请求会解析成词缀修改，而不是昵称重写。被清空的
词缀会存成一次明确的抑制，所以这个移除不会被更低
优先级的层仍然提供的值还原。

当提交的昵称里已经带上解析后的词缀时，这个多余词缀会被
拿去与解析后的值比较并剥掉；昵称永远不会按空白切分来
猜边界。只要名字确实变了，更新结果都会报告最终的称呼形式，
所以一次称呼风格切换能在同一轮里看出来，即使那一轮里没有任何命名字段
出现；而一次人称代词或时区修改不会重述一个没被碰过的名字。

每个字段都会在一次原子写入之前完成校验。严格的隐私设置会拦截新增与
修改，但仍然允许清空取值。这个工具无法编辑人格级的称呼词。`/config` > 权限 里
默认开启的 User Info Updates 开关同时控制工具的暴露与
过期调用的防御。关掉它之后，手动 `/personal config` 仍然可用。
