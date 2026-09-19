---
title: "SillyTavern 支持"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | 在 Discord 里使用 SillyTavern 角色卡"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "用 TomoriBot 把 SillyTavern 角色卡与提示词预设集导入 Discord。把你手上的角色带进你的服务器。"
sidebar:
  order: 2
---

TomoriBot 可以从 [SillyTavern](https://github.com/SillyTavern/SillyTavern)
导入两样你可能已经有的东西：**Prompt Manager 预设集**（提示词怎么排布）和
**角色卡**（角色本身）。这是给 ST 用户的细分功能，所以如果你从来没用过
SillyTavern，这一页可以跳过。

## 角色卡导入

用 `/persona import` 把已有的 SillyTavern 角色直接带进 Discord。它
接受：

- 带内嵌 `chara` / `char` 元数据的 **PNG 卡片**，
- **v2 风格 JSON** 卡片（根级的 `name`、`description`、`first_mes`……），
- **v3 JSON** 卡片（`spec: "chara_card_v3"`，带一个嵌套的 `data` 对象），
- **`.charx` 压缩包**（Character Card V3，也是角色卡站点默认发放的格式）。

`.charx` 文件是一个 zip，其中的 `card.json` 装着角色。TomoriBot 读取那张卡，
忽略压缩包里的其他一切：打包的图标、表情立绘、音频和视频都不会被
导入，导入回复里也会说明这一点。用 `/server avatar` 设置头像，在
`/config` > 人格 > 立绘 里添加立绘。

如果文件没有 TomoriBot 元数据，但是一张有效的 ST v2/v3 卡，导入会自动把它
走一遍 SillyTavern 转换流程。你也可以把一张卡喂给 `/persona generate`，
把它转换成一个全新的人格。

导入在保存任何东西之前会先过一遍校验架构（默认上限：每个字符串 5,000 个
字符、200 条属性、每侧 100 组示例对话、100 个触发词；
自部署者可以调整 `PRESET_MAX_*` 环境变量）。压缩包的读取另外受
`MAX_CHARX_*` 环境变量限制，因为压缩包压缩后的大小并不能说明它展开后有多大。确切的转换与字段映射见
[角色卡支持架构](/en/architecture/integrations/sillytavern/card-support/)。

## 提示词预设集

SillyTavern 的 Prompt Manager 预设集控制提示词的**排布**。用 `/config` > 插件
> SillyTavern 预设集 来导入预设集、查看已启用的节点、在预设集之间切换，或者回到
常规排布。

### 一个预设集控制什么

- 提示词顺序与标记位置
- 自定义提示词节点
- 历史后置与深度注入节点
- 哪些导入的节点初始处于启用或禁用状态

### 它*不*替换什么

预设集拥有的是*排布*，而不是所有文本来源。下面这些仍然与它并存：

- 你的系统提示词与人格块：`/config` > 行为 > 常规行为、`/config` > 人格 > 高级，
  以及 `/config` > 人格 > 身份与性格 上的属性与示例对话操作。
- 实时聊天历史与检索到的文档上下文。
- TomoriBot 的自动上下文：服务器记忆、表情与贴纸上下文、对话中的用户、
  短期记忆、奖励与惩罚，以及类似的区块。

### 原生区块如何映射

- `main` → 当前的系统提示词（`/config` > 行为 > 常规行为，否则用内置兜底）
- `charDescription` → `/config` > 人格 > 高级
- `charPersonality` → `/config` > 人格 > 身份与性格
- `dialogueExamples` → `/config` > 人格 > 身份与性格
- `chatHistory` → 实时的频道历史
- `worldInfoBefore` / `worldInfoAfter` → 检索到的文档上下文（不是 ST 的世界书）

### 系统提示词规则

预设集启用期间，内置的兜底系统提示词会被移除，但如果*你*用
`/config` > 行为 > 常规行为 设置了自己的提示词，它仍然会被发送。

### 兼容性说明

预设集看起来没生效时，常见的意外来源：

- 导入 ≠ 发送：在 `prompt_order` 里被禁用的节点会一直关闭，直到你用
  `/config` > 插件 > SillyTavern 预设集 启用它们。只有注释的节点和空节点永远不会被发送；未知的标记会被
  跳过。
- 顺序是照字面执行的：把 `chatHistory` 放在 `dialogueExamples` 之前，就会先发送实时聊天。
- 历史后置与深度注入会合并进已有的聊天历史条目，而不是变成
  独立消息；同一深度的多个节点会被批量处理。
- 不支持正则后处理、预设集一侧的温度与 top-p 与模型覆盖，以及分层预设集。
  旧式文本补全预设集走的是一条尽力而为的导入路径，会
  丢掉只属于 ST 的区块（scenario、anchors、停止字符串……）。

在 `/help` 里选择 **集成**，再选 **SillyTavern 预设集**，可以看到 Discord 内的参考。关于导入引擎的内部实现，见
[预设集系统架构](/en/architecture/integrations/sillytavern/preset-system/)。
