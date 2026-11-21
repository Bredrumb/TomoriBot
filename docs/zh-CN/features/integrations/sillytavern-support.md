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
卡片中的角色书会成为该人格的[世界书](/features/knowledge/memory/lorebooks/)。已停用的条目会保持停用状态。重新导入卡片会替换该人格的整本世界书，包括你自己添加的条目。
:::

## 角色卡导出

使用 `/persona export` 并将 `output_format` 设为 `兼容 SillyTavern 的 PNG`，即可将人格带入 SillyTavern。导出的角色卡包含头像、性格、示例对话、人格提示词和人格世界书。卡片不包含开场白；开始聊天前请在 SillyTavern 中自行添加。

触发设置、搭话、语音设置以及世界书频道限制等 TomoriBot 专属设置不会包含在内。选择 `TomoriBot 卡片` 或 `原始 JSON` 可保留 TomoriBot 人格设置。`TomoriBot 压缩包` 还会携带立绘与角色参考媒体，以及在请求时包含语音参考音频。这个 ZIP 是 TomoriBot 格式；用于 SillyTavern 时请使用 `兼容 SillyTavern 的 PNG`。

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

### 预设集宏
<!-- anchor: preset-macros -->

使用[预设集宏](/features/prompt-macros/#sillytavern-preset-macros)在预设集节点中插入人格详情、最新用户消息或服务器时间。

### 条件语句指令
<!-- anchor: conditional-instructions -->

使用[预设集条件语句](/features/prompt-macros/#preset-conditionals)根据某个值（例如人格是否有描述）来选择指令。

### 兼容性说明

- 在 `prompt_order` 中关闭的节点将保持停用状态，直到在 `/config` > `插件` > `SillyTavern 预设集` 中启用为止。空节点和仅含注释的节点永远不会发送给模型。
- 标记顺序按字面顺序执行：将 `chatHistory` 置于 `dialogueExamples` 之前会将聊天历史放在最前面。世界书标记定位常驻（Always On）设定；已激活的世界书、检索到的文档、在线状态和时钟则保持在最近四个发言轮次附近。新鲜的或跨频道的短期记忆同样保持在这些消息附近，若有配置也可更靠近末尾。
- 历史记录后置注入会合并到现有的对话历史中，而不是作为独立消息发送。
- 不支持正则表达式后处理、预设集定义的采样参数（温度、top-p）以及分层预设集。旧版文本补全预设集在导入时会丢弃SillyTavern专属区块。

在 `/help` 中选择 `插件`，然后选择 `SillyTavern 预设集`，可查看Discord内指南。有关内部预设集处理机制，请参阅[预设系统架构](/architecture/integrations/sillytavern/preset-system/)。
