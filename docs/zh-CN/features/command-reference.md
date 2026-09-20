---
title: "指令参考"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand. / 生成的文件：请勿手动编辑。
  请在仓库根目录运行 `bun run generate-command-reference`。
-->

TomoriBot 当前注册的全部斜杠指令，由与 Discord 注册所用的同一批指令构建器和英文语言描述生成。

顶层指令组：**39**。可执行的斜杠指令：**81**。

## `/comment`

发送一条在聊天里可见、但在上下文里不可见的评论嵌入。

| 指令 | 摘要 |
|---|---|
| `/comment` | 发送一条在聊天里可见、但在上下文里不可见的评论嵌入。 |

## `/compact`

把最近的对话总结成一条紧凑的系统记忆。

| 指令 | 摘要 |
|---|---|
| `/compact` | 把最近的对话总结成一条紧凑的系统记忆。 |

## `/conditioning`

管理持久保存的奖励与惩罚记忆。

| 指令 | 摘要 |
|---|---|
| `/conditioning manage` | 管理这个服务器里所有人生成注入的奖励与惩罚历史。 |
| `/conditioning remove` | 移除这个服务器里所有人生成的奖励与惩罚条目。 |

## `/config`

配置人格、行为、频道、权限和模型设置。

| 指令 | 摘要 |
|---|---|
| `/config` | 配置人格、行为、频道、权限和模型设置。 |

## `/contribute`

找到源代码，以及帮助构建 TomoriBot 的各种方式。

| 指令 | 摘要 |
|---|---|
| `/contribute github` | 获取 GitHub 仓库链接，并了解如何为 TomoriBot 做贡献。 |

## `/donate`

支持 TomoriBot 的开发与托管开销。

| 指令 | 摘要 |
|---|---|
| `/donate kofi` | 通过 Ko-fi 捐款支持 TomoriBot 的开发。 |

## `/export`

把你的配置或记忆导出成可移植的文件。

| 指令 | 摘要 |
|---|---|
| `/export config` | 把这个服务器的配置导出成可移植的文件。 |
| `/export memories` | 把记忆导出成可移植的文件。 |
| `/export personal config` | 把你的个人配置导出成可移植的文件。 |
| `/export personal memories` | 把你账号拥有的记忆导出成可移植的文件。 |

## `/expressions`

教 TomoriBot 什么时候使用这个服务器的自定义表情和贴纸。

| 指令 | 摘要 |
|---|---|
| `/expressions edit` | 编辑单个表情或贴纸的情绪与使用说明 |
| `/expressions initialize` | 用 AI 视觉分析并分类所有自定义表情和贴纸 |

## `/generate`

生成 AI 图像、视频和语音消息。

| 指令 | 摘要 |
|---|---|
| `/generate image` | 根据你自己的提示词或当前频道场景生成一张 AI 图像 |
| `/generate scene` | 在选定的人格之间生成一段简短的脚本化文字场景。 |
| `/generate video` | 使用 Google Veo、OpenRouter 或 Z.ai 生成一段 AI 视频 |
| `/generate voice-message` | 用你挑选的语音说出一条消息 |

## `/help`

浏览设置、功能、提供方、记忆、行为、工具、媒体与集成指南。

| 指令 | 摘要 |
|---|---|
| `/help` | 浏览设置、功能、提供方、记忆、行为、工具、媒体与集成指南。 |

## `/impersonate`

扮演人格或用户，或者注入系统提示词。

| 指令 | 摘要 |
|---|---|
| `/impersonate persona` | 以这个服务器某个人格的身份发送一条消息。 |
| `/impersonate system` | 往对话上下文里注入一条系统消息。 |
| `/impersonate user` | 让 bot 像那位成员一样写并发出一条消息。 |

## `/import`

从可移植的文件导入配置或记忆。

| 指令 | 摘要 |
|---|---|
| `/import config` | 导入一个服务器配置文件。 |
| `/import memories` | 导入一个服务器记忆文件。 |
| `/import personal config` | 导入一个个人配置文件。 |
| `/import personal memories` | 导入一个个人记忆文件。 |

## `/kill`

立刻停止当前的流式输出，并清空这个频道里排队的回复。

| 指令 | 摘要 |
|---|---|
| `/kill` | 立刻停止当前的流式输出，并清空这个频道里排队的回复。 |

## `/learn`

把对话历史学习、提取并入库为记忆。

| 指令 | 摘要 |
|---|---|
| `/learn history` | 用 AI 从这个频道的消息历史里提取知识。 |

## `/legal`

查看 TomoriBot 的服务条款、隐私政策与许可协议。

| 指令 | 摘要 |
|---|---|
| `/legal license` | 查看 TomoriBot 的开源许可协议 |
| `/legal privacy-policy` | 查看 TomoriBot 的隐私政策 |
| `/legal terms-of-service` | 查看 TomoriBot 的服务条款 |

## `/matrix`

把 Discord 频道关联到 Matrix 房间，实现双向转发。

| 指令 | 摘要 |
|---|---|
| `/matrix link` | 把一个 Discord 频道关联到 Matrix 房间，实现双向转发 |
| `/matrix unlink` | 移除某个 Discord 频道上的 Matrix 桥接关联 |

## `/memories`

查看和管理服务器记忆、文档与短期记忆。

| 指令 | 摘要 |
|---|---|
| `/memories` | 查看和管理服务器记忆、文档与短期记忆。 |

## `/model`

管理这个服务器的默认 AI 模型。

| 指令 | 摘要 |
|---|---|
| `/model override remove` | 移除频道与人格的模型覆盖。 |

## `/moderation`

管理成员权限、黑名单、频道与身份组白名单，以及配额设置。

| 指令 | 摘要 |
|---|---|
| `/moderation` | 管理成员权限、黑名单、频道与身份组白名单，以及配额设置。 |

## `/novelai`

配置这个服务器的 NovelAI 文本与图像生成。

| 指令 | 摘要 |
|---|---|
| `/novelai generate image` | 用图库风格的标签和可选的参考角色生成一张 NovelAI 图像。 |
| `/novelai usage` | 显示这个服务器的 NovelAI Opus 生成用量表（需要管理服务器权限）。 |

## `/nsfw`

年龄限制的指令与设置。

| 指令 | 摘要 |
|---|---|
| `/nsfw jailbreaks` | 管理这个服务器上针对我提示词的可选越狱行为。 |

## `/nuke`

彻底抹掉所有服务器数据。之后需要重新运行 /setup。

| 指令 | 摘要 |
|---|---|
| `/nuke` | 彻底抹掉所有服务器数据。之后需要重新运行 /setup。 |

## `/persona`

管理人格预设集

| 指令 | 摘要 |
|---|---|
| `/persona create` | 手动创建一个简单的人格预设集 |
| `/persona default` | 应用一套人格预设集 |
| `/persona export` | 把当前人格导出成可分享的 PNG 文件 |
| `/persona generate` | AI 驱动的人格生成（需要兼容的提供方） |
| `/persona import` | 从 PNG、JSON 或 CHARX 文件导入一个人格 |
| `/persona remove` | 从服务器里移除一个副人格 |

## `/personal`

管理你的个人设置

| 指令 | 摘要 |
|---|---|
| `/personal config` | 管理你的个人偏好、隐私、模型和资料。 |
| `/personal language` | 选择 TomoriBot 与你对话时使用的语言。 |
| `/personal memories` | 管理你的个人长期记忆和短期对话上下文。 |
| `/personal nuke` | 抹掉 TomoriBot 在所有服务器里存下的关于你的一切。 |
| `/personal providers` | 管理你的个人提供方凭据、端点和模型目录。 |

## `/ping`

检查 bot 的延迟。

| 指令 | 摘要 |
|---|---|
| `/ping` | 检查 bot 的延迟。 |

## `/providers`

添加、查看、编辑和移除提供方凭据、端点和模型目录。

| 指令 | 摘要 |
|---|---|
| `/providers` | 添加、查看、编辑和移除提供方凭据、端点和模型目录。 |

## `/punish`

用俏皮的互动惩罚我。

| 指令 | 摘要 |
|---|---|
| `/punish bite` | 轻轻咬我一口！ |
| `/punish bonk` | 敲一下我的头！ |
| `/punish pinch` | 捏我一下！ |
| `/punish spank` | 俏皮地打我一下！ |
| `/punish squeeze` | 抱紧我一下！ |

## `/quota`

管理生成配额的重置。

| 指令 | 摘要 |
|---|---|
| `/quota reset global` | 重置全服务器的生成配额池。 |
| `/quota reset user` | 重置某个用户的每日配额用量。 |

## `/refresh`

清空对话历史（仅限这个频道）。

| 指令 | 摘要 |
|---|---|
| `/refresh` | 清空对话历史（仅限这个频道）。 |

## `/reset`

把服务器或个人配置重置为默认值。

| 指令 | 摘要 |
|---|---|
| `/reset config` | 把这个服务器的配置重置为数据库默认值。 |
| `/reset personal config` | 把你的个人配置重置为数据库默认值。 |

## `/respond`

手动触发对这个频道最新一条消息的回复。

| 指令 | 摘要 |
|---|---|
| `/respond` | 手动触发对这个频道最新一条消息的回复。 |

## `/reward`

用有趣的互动奖励我。

| 指令 | 摘要 |
|---|---|
| `/reward feed` | 喂我吃一口好吃的！ |
| `/reward headpat` | 摸摸我的头！ |
| `/reward hug` | 抱抱我！ |
| `/reward kiss` | 亲我一下！ |
| `/reward tickle` | 挠我痒痒！ |

## `/scheduled-task`

管理定时任务与提醒。

| 指令 | 摘要 |
|---|---|
| `/scheduled-task edit` | 编辑一条定时任务或提醒。 |
| `/scheduled-task remove` | 移除一条定时任务或提醒。 |

## `/setup`

开始初次设置流程。配置 AI 提供方与人格。

| 指令 | 摘要 |
|---|---|
| `/setup` | 开始初次设置流程。配置 AI 提供方与人格。 |

## `/stats`

查看用量统计

| 指令 | 摘要 |
|---|---|
| `/stats generate` | 生成一张可分享的统计图片卡片。 |
| `/stats persona` | 查看某个人格在这个服务器上的用量统计。 |
| `/stats personal` | 查看你自己的用量统计。 |
| `/stats server` | 查看全服务器的用量统计。 |

## `/status`

显示当前的个人、服务器或人格状态。

| 指令 | 摘要 |
|---|---|
| `/status` | 显示当前的个人、服务器或人格状态。 |

## `/support`

获取帮助、报告问题，并加入 TomoriBot 社区。

| 指令 | 摘要 |
|---|---|
| `/support discord` | 获取官方 Discord 服务器链接，用来报告问题、反馈和社区聊天。 |

## `/tool`

用于对话上下文、提示词和诊断的实用操作。

| 指令 | 摘要 |
|---|---|
| `/tool delete turn` | 从频道里删除人格最近的一轮发言。 |
| `/tool estimate cost` | 估算付费 AI 提供方的 API 开销 |
| `/tool prompt snapshot` | 把某个人格确切的 LLM 提示词导到文件里以便调试。 |

## `/update`

查看最新的 TomoriBot 发行说明

| 指令 | 摘要 |
|---|---|
| `/update` | 查看最新的 TomoriBot 发行说明 |
