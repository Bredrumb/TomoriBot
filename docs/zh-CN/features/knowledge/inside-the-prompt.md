---
title: "提示词内部"
sidebar:
  order: 2
---

每次你触发 TomoriBot，下面这些内容都会按这个顺序拼接起来，作为主提示词与上下文发送给你配置的文本
模型：

| 区块 | 可选？ | 指令 | 它是什么 |
|---|---|---|---|
| [**系统提示词**](/zh-CN/features/chatting-personality/behavior-tweaking/#系统提示词) | | `/config` > 行为 > 常规行为 | 位于上下文最顶端的基础指令。 |

> **默认系统提示词文本**（仅在服务器没有设置系统提示词时使用）：
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| 区块 | 可选？ | 指令 | 它是什么 |
|---|---|---|---|
| **频道提示词（追加）** | *(可选)* | `/config` > 频道 > 频道覆盖 | 因频道而异，紧接在系统提示词之后叠加。同一页的*替换*模式则会顶替上面那个系统提示词位置，而不是新增一个。 |
| **人格提示词** | *(可选)* | `/config` > 人格 > 高级 | 专门为当前生效人格写的提示词，与系统提示词分开。|
| [**人格属性**](/zh-CN/features/chatting-personality/multiple-personas/#属性) | | `/config` > 人格 > 身份与性格 | 当前生效人格的性格特质与说话方式。 |
| **服务器信息** | | *(无，来自 Discord)* | 服务器名称、简介，以及她所在的频道，直接从 Discord 拉取。 |
| [**人格与用户屏蔽块**](/zh-CN/features/capabilities/tools-and-extensions/#内置工具) | *(可选)* | 用 `/moderation` 查看或清除；由 `/config` > 权限（屏蔽用户）控制 | 这个人格对特定用户持有的当前禁言与屏蔽限制。 |
| [**服务器记忆**](/zh-CN/features/knowledge/memory/#个人记忆与服务器记忆) | | `/memories` | 为这个服务器保存的长期事实。 |
| [**服务器表情**](/zh-CN/features/chatting-personality/behavior-tweaking/#功能开关她被允许做什么) | *(可选)* | `/config` > 权限（表情使用）（仅开关），用 `/expressions initialize` 初始化 | 服务器里存在的自定义表情。|
| [**服务器贴纸**](/zh-CN/features/chatting-personality/behavior-tweaking/#功能开关她被允许做什么) | *(可选)* | `/config` > 权限（贴纸使用）（仅开关），用 `/expressions initialize` 初始化 | 服务器里存在的自定义贴纸。 |
| [**人格立绘**](/zh-CN/features/chatting-personality/multiple-personas/#立绘表情头像) | *(可选)* | `/config` > 人格 > 立绘 | 为该人格配置的具名表情立绘，如果它有任何立绘的话。 |
| [**对话参与者**](/zh-CN/features/knowledge/memory/#个人记忆与服务器记忆) | *(可选)* | `/personal memories`（由 `/config` > 权限（个性化）控制） | 对话中的人、他们的昵称和提及句柄，以及为每个人保存的个人记忆。当这个人在上下文里拥有消息，或者他们的名字与别名被提及时加载。它还会在末尾附上当前频道和本地时间，使用 `/config` > 行为 > 常规行为。 |
| [**短期记忆**](/zh-CN/features/knowledge/memory/#短期记忆stm) | | `/config` > 人格 > 记忆；用 `/memories` 清除条目；由 `/config` > 权限（短期记忆）控制 | 包含不同频道的摘要和近期消息 |
| [**文档**](/zh-CN/features/knowledge/memory/#文档知识库rag) | *(可选)* | `/memories` | 用 RAG 从知识库里取出的相关分块。 |
| [**奖励与惩罚**](/zh-CN/features/knowledge/memory/#奖励与惩罚) | *(可选)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`、`/punish <bite\|bonk\|pinch\|spank\|squeeze>`，通过 `/conditioning remove` 管理 | 为这个人格在这个服务器里累积的行为引导。 |
| [**示例对话**](/zh-CN/features/chatting-personality/multiple-personas/#示例对话) | *(可选)* | `/config` > 人格 > 身份与性格 | 这个人格怎么说话的示例，如果配置了的话。 |
| [**近期消息**](/zh-CN/features/chatting-personality/behavior-tweaking/#生成调校) | | `/config` > 行为 > 常规行为 | 真实的对话内容，最多这么多条（默认 80）。你的上下文提醒和任何重逢提醒会按可配置的深度内联注入到这个区块里，而不是单独成为一个区块。 |

标着 *(可选)* 的行在没有内容可说时不会贡献任何东西（也不花 token），例如没有匹配到文档，或者服务器没有自定义表情。

近期消息是其中最大也最脆弱的部分，它是一扇随着人们说话向前滑动的窗口。在它之上的所有内容都由保存的设置重建而来，是稳定的。

`/tool prompt snapshot` 会把某个人格的完整组合导到文件里。它是判断当前哪些记忆在生效、是否有文档匹配、以及对话实际装进了多少的
最终依据。

`/tool estimate cost` 把同一份组合按大小拆开，在提高任何上限之前，用它算清是什么在吃掉你的上下文很方便。

### 工具在哪里定义？

对 TomoriBot 原生支持的每一个
提供方，工具架构都通过该提供方自己的 `tools`
字段发送，所以这取决于提供方与配置的推理引擎。

### 为什么 TomoriBot 会忘事？

这个顺序几乎能解释每一个「她怎么不记得了？」的疑问：

| 发生了什么 | 为什么 |
|---|---|
| 她忘了今天早些时候的某件事 | 它滚出了消息上限。它原本只在**近期消息**里，如果 Tomori 没有把它保存成长期记忆，那么一旦它落到消息窗口之外就会被忘掉。 |
| 她忘了另一个频道里的某件事 | **近期消息**是按频道算的。只有**服务器记忆**、**对话参与者**和**短期记忆**能跨频道。短期记忆通过加载不同频道的近期消息来缓解这一点，但它不会把一切都倒出来。 |
| `/refresh` 之后她忘了 | 刷新会切断**近期消息**并清除这个频道的**短期记忆**，但不应该移除长期记忆。删掉那条刷新嵌入就能取消这次切断。 |
| 重启之后她忘了某件事 | **近期消息**从不跨重启存活 |

如果你希望某件事能在上述所有情况之后仍然保留，它就必须变成**长期记忆**。见[记忆](/zh-CN/features/knowledge/memory/#长期记忆)。

## 技巧与小窍门

- `/config` > 行为 > 常规行为 可以加宽对话窗口（20 到 100 条消息）。上下文更多，
  每条回复消耗的 token 也更多。
- `/config` > 行为 > 常规行为 会在选定深度注入一句简短提醒。因为它位于组合的靠后位置、贴近近期消息，
  她比起系统提示词里的内容更可能照做。这是催她更频繁保存记忆的最佳位置。
- `/personal memories` 和 `/memories` 直接写进**服务器记忆**和
  **对话参与者**，这是让知识在 TomoriBot 的上下文里永久保留的可靠办法之一。
