---
title: "SillyTavern支持"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | 在Discord里使用SillyTavern角色卡"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "用TomoriBot把SillyTavern角色卡与提示词预设集导入Discord。把你手上的角色带进你的服务器。"
sidebar:
  order: 2
aiGenerated: true
---

TomoriBot可以从 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 导入资源：
提示管理器预设（控制提示词结构）、角色卡（角色定义）以及世界书（内嵌的角色书或独立的世界设定文件）。
如果你从未使用过SillyTavern，可以放心地跳过此页面。

## 角色卡导入

使用 `/persona import` 将现有的SillyTavern角色带入Discord。它支持：

- 内嵌 `chara` 或 `char` 元数据的 **PNG卡片**。
- 具有根级属性的 **v2格式JSON** 卡片（`name`、`description`、`first_mes`）。
- **v3 JSON** 卡片（带有嵌套 `data` 对象的 `spec: "chara_card_v3"`）。
- **`.charx`归档**（角色卡V3包）。

`.charx`文件是包含 `card.json` 定义的ZIP压缩包。TomoriBot从 `card.json` 导入角色文本，并跳过捆绑的资源文件（图标、立绘、音频、视频）。你可以在 `/config` > `人格` > `身份与性格` 中设置头像，在 `/config` > `人格` > `立绘` 中添加立绘。

如果上传的文件是不带TomoriBot元数据的有效SillyTavern卡片，导入时会自动进行转换。你还可以将卡片传给 `/persona generate`，以创建受该角色启发的新人格。

导入在保存前会进行校验（默认限制：每个文本字段5,000个字符、200个属性、每侧100对示例对话、100个触发词）。有关字段映射和转换机制，请参阅[卡片支持架构](/architecture/integrations/sillytavern/card-support/)。

:::tip
卡片中的角色书会成为该人格的[世界书](/features/knowledge/lorebooks/)。已停用的条目会保持停用状态。重新导入卡片会替换该人格的整本世界书，包括你自己添加的条目。
:::

## 提示词预设集
<!-- anchor: prompt-presets -->

SillyTavern提示管理器预设集控制发送给模型的提示词顺序和布局。打开 `/config` > `插件` > `SillyTavern 预设集` 可以导入预设集、开关单个节点、切换生效的预设集或恢复默认格式。

:::tip
导入与已有预设集同名的预设集会替换该预设集（包括你之前开启或关闭的节点状态），并激活新的预设集。如果你想同时保留两者，请给每个变体起不同的名称。
:::

### 预设集控制的内容

- 提示词顺序与标记位置
- 自定义提示词节点
- 历史记录后置节点与深度注入节点
- 导入节点的初始启用状态

### 预设集无法替换的内容

预设集用于构建提示词布局，它不会替换填充其中的文本来源：

- 系统指令和人格字段：`/config` > `行为` > `常规行为`、`/config` > `人格` > `高级` 以及 `/config` > `人格` > `身份与性格`。
- 实时聊天历史记录、检索到的文档上下文以及生效的世界书条目。
- 自动上下文：服务器记忆、表情与贴纸数据、参与者列表以及短期记忆。

### 原生区块如何映射

原生区块直接映射到TomoriBot的提示词组件：

- `main`：配置时的频道提示词覆盖
- `charDescription`：`/config` > `人格` > `高级`
- `charPersonality`：`/config` > `人格` > `身份与性格`
- `dialogueExamples`：`/config` > `人格` > `身份与性格`
- `chatHistory`：实时的频道消息历史
- `worldInfoBefore` 与 `worldInfoAfter`：对应插入位置的世界书条目，其后紧跟检索到的文档上下文

### 系统提示词规则

当导入的预设集处于生效状态时，它将完全控制系统提示词。TomoriBot的内置提示词以及来自 `/config` > `行为` > `常规行为` 的自定义提示词均不会发送，该处的系统提示词按钮也会被锁定。你的自定义提示词仍会保留，当你在 `/config` > `插件` > `SillyTavern 预设集` 中关闭该预设集时，自定义提示词将恢复生效。

### 条件语句指令

使用Handlebars块在特定值存在时才包含相应指令：

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

像 `description` 这样的简写名称表示 `{{description}}`。你也可以直接在条件中放置取值宏，如 `{{#if {{input}}}}`。在修剪前后空格并忽略大小写后，空文本、`false` 和 `0` 均判定为假。条件中未知的宏视为空值。

块支持嵌套，包括TomoriBot的 `{{if capability:web_search}}` 和 `{{if tool:web_search}}` 块。使用 `{{/if}}` 闭合 `#if`，使用 `{{/unless}}` 闭合 `#unless`。格式有误的块（例如出现第二个 `else` 或闭合标签不匹配）会被忽略。缺少闭合标签的Handlebars块会在其所在节点的末尾结束。多余孤立的 `else` 和闭合标签会被丢弃。超过32层的嵌套块会保持原始条件语法不予渲染。导入说明会报告这些问题。

`{{setvar::key::value}}` 用于存储文本；`{{addvar::key::value}}` 用于追加文本。未执行的Handlebars分支中的声明不会产生效果。条件语句可以读取节点顺序中较早出现的声明，包括同一节点中前面部分的声明。纯文本中的 `{{getvar::key}}` 会在遍历完所有已启用的节点后读取最终值。工具和能力条件在其后运行，因此它们不控制变量赋值。

### 预设集宏
<!-- anchor: preset-macros -->

| 宏 | 取值 |
|---|---|
| `{{user}}` | 触发回复的成员 |
| `{{char}}`, `{{bot}}` | 当前生效的人格名称 |
| `{{personality}}` | 人格属性 |
| `{{description}}` | 人格提示词 |
| `{{scenario}}` | 为空：卡片中的情境设定已合并至人格属性中 |
| `{{mesExamples}}` | 示例对话文本 |
| `{{lastChatMessage}}`, `{{input}}` | 提供的对话中最近一条用户消息 |
| `{{time}}` | 服务器时间，例如 `3:45 PM` |
| `{{date}}` | 服务器日期，例如 `October 28, 2026` |
| `{{weekday}}` | 英文星期名称，例如 `Wednesday` |
| `{{isotime}}` | `HH:mm` 格式的服务器时间，例如 `15:45` |
| `{{isodate}}` | `YYYY-MM-DD` 格式的服务器日期，例如 `2026-10-28` |
| `{{model}}` | 配置的模型 ID；按轮次随机选取的模型与备用模型不会反映在此处 |
| `{{provider}}` | 配置的提供方 ID：`google`、`openrouter`、`novelai` 或 `custom` |
| `{{char_version}}` | 为空：角色卡版本不予存储 |

时间相关的宏在每次生成提示词时共用一次时钟读取，并使用服务器的数值型 UTC 偏移。夏令时遵循你所设置的偏移。成员的个人时区不会影响它们。当时间感知关闭时，所有5个时间宏均为空，测试它们的条件语句判定为假。请将时间宏放在靠后或深度注入的节点中：像 `{{time}}` 这样变化的值会使其之后的所有内容在提供方的提示词缓存中失效。

`{{random: A, B}}` 和 `{{random::A::B}}` 用于随机选取一项；`{{roll:2d6}}` 用于掷骰子。`{{// notes}}` 用于移除注释，`{{trim}}` 用于修剪节点前后的空白字符。这些宏和条件语句仅适用于预设集指令。世界书条目仅支持展开 `{{user}}`、`{{char}}` 和 `{{bot}}`。

### 兼容性说明

- 在 `prompt_order` 中关闭的节点将保持停用状态，直到在 `/config` > `插件` > `SillyTavern 预设集` 中启用为止。空节点和仅含注释的节点永远不会发送给模型。
- 区块顺序按字面顺序执行：将 `chatHistory` 置于 `dialogueExamples` 之前会将聊天历史放在提示词的最前面。
- 历史记录后置注入会合并到现有的对话历史中，而不是作为独立消息发送。
- 不支持正则表达式后处理、预设集定义的采样参数（温度、top-p）以及分层预设集。旧版文本补全预设集在导入时会丢弃SillyTavern专属区块。

在 `/help` 中选择 `插件`，然后选择 `SillyTavern 预设集`，可查看Discord内指南。有关内部预设集处理机制，请参阅[预设系统架构](/architecture/integrations/sillytavern/preset-system/)。
