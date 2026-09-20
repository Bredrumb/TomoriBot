---
title: "多个人格"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay";
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | 为你的 Discord 服务器准备的 AI 伙伴与人格"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "在一个 Discord 服务器里运行多个 AI 伙伴。每个人格都有自己的头像、触发设置和说话风格。"
sidebar:
  order: 2
---

TomoriBot 的人格落在**人格（persona）**里：她的名字、头像、属性、说话方式和行为。你可以同时运行好几个人格，每个都是一个有自己触发设置和 Webhook 头像的独立角色。这一页讲的是*她如何表现*；至于*她知道什么*（事实与记忆），见[记忆](/zh-CN/features/knowledge/memory/)。

## 创建人格

- `/persona create`：从零开始搭一个自定义人格。
- `/persona generate`：让 AI 根据一段描述和一张图片生成人格。需要支持结构化输出的提供方。你也可以在这里上传现有的 TomoriBot 预设集或 SillyTavern 角色卡，把一个已有的角色转换过来（见 [SillyTavern 支持](/zh-CN/features/integrations/sillytavern-support/)）。
- `/persona default`：切换到一个内置默认人格作为底子。
- `/persona export` / `/persona import`：把人格导出成文件分享或备份。导入支持把人称作为**副人格**带进来，并配上它自己的触发设置和 Webhook 头像。
- `/persona remove`：移除一个副人格。

一个不错的起步流程：挑一个默认人格或者生成一个，然后用下面的属性和示例对话把它打磨出来。

## 副人格

副人格让多个角色共存于同一个服务器：

- 每个副人格都有自己的性格、触发词和 **Webhook 头像**，所以不同角色在同一个频道里会以不同的名字和头像出现。
- 多条消息可以同时触发多个副人格，上限由 `/config` > 行为 > 触发行为决定。
- **回复一条 Webhook 消息**会以那个人格的身份继续对话。
- 用 `/persona import`（alter 选项）添加副人格；用 `/persona` 和 `/persona remove` 管理它们。

群组角色扮演和多角色服务器就是靠这个实现的。关于触发如何路由到人格、Webhook 身份如何工作的运行细节，见[多个人格行为](/en/architecture/subsystems/multi-persona/)的架构参考。

## 塑造性格

教她怎么说话、怎么行动，主要靠两条指令：

### 属性
<!-- anchor: attributes -->

`/config` > 人格 > 身份与性格 可以添加性格特质或外貌特征，例如 `friendly`、`red hair`，或者 `ends sentences with *Nya~*`。移除它们也在
`/config` > 人格 > 身份与性格。

### 示例对话
<!-- anchor: sample-dialogues -->

`/config` > 人格 > 身份与性格 用示例教她*她是怎么说话的*。请使用 `{user}` 和 `{bot}` 占位符，这样对话对所有人都成立（分享人格时也一样）：

- `{user}`：替换成实际用户的名字或昵称
- `{bot}`：替换成她当前的名字

```text
{user}: 你最喜欢的爱好是什么？
{bot}: 呼呋~ 我喜欢给小玩偶织小衣服~♥
```

写好示例对话的几条建议：

- 写自然、像日常聊天的往来。
- 把你希望她表现出的属性和特质写进去。
- 示范你想要的那种语气，并加入变化，好让她能举一反三。

移除示例也在 `/config` > 人格 > 身份与性格。

### 名字与头像

- `/config` > 人格 > 身份与性格：设置她怎么称呼自己。
- `/config` > 人格 > 身份与性格：设置她在本服务器的头像。

你也可以用 `/config` > 行为 > 常规行为 设置自定义系统提示词，进一步塑造行为；见[行为调整](/zh-CN/features/chatting-personality/behavior-tweaking/)。

## 立绘（表情头像）
<!-- anchor: sprites-emotion-avatars -->

立绘是一个人格可以在对话中途切换的备用头像，用来表达某种情绪或处境（可以理解成她的表情）。每个立绘都是一张带标签的图片（例如 `happy`、`mad`、`embarrassed`），在合适的时机她会用它代替平时的头像。

她怎么用立绘：每轮可用的立绘和它们的使用说明都会交给模型。要展示某个立绘，她会让回复的某一行以 `PersonaName (label):` 开头；那一行就会配上对应的立绘图片发出。如果没有合适的立绘，她就正常回复。

在 `/config` > 人格 > 立绘 管理人格的立绘（添加和移除需要**管理服务器**权限）：

- `/config` > 人格 > 立绘：添加或替换一个立绘：选择人格，给它一个**标签**，上传**图片**（PNG、JPG 或 GIF），还可以加上**使用说明**告诉她什么时候用。重复使用同一个标签会替换掉那个立绘。每个人格有立绘数量上限。
- `/config` > 人格 > 立绘：修改已有立绘的名称、图片、说明或身份开关。
- `/config` > 人格 > 立绘：删除某个人格的立绘。
- `/config` > 人格 > 立绘 上的导出与导入：把一个人格的全部立绘打包成文件备份或分享。

**身份**开关会把消息名在 Discord 里装扮成 `Label (Persona)`，对那些以不同角色身份说话的[副人格](#副人格)尤其有用。

改动默认人格的头像会移除它自带的立绘，因为那些立绘显示的是原角色的脸。你自己添加的立绘会保留。运行 `/persona default` 可以把默认立绘找回来。

## 按频道指定人格

想在某个频道里控制*你*由哪个人格回答，又不想动全服务器的设置？那就是个人聚光灯；见[个性化](/zh-CN/features/knowledge/personalization/#personal-spotlight)。

## 人格各自的称呼方式

服务器管理员可以用 `/config` > 人格 > 身份与性格 给每个人格独立设置阳性、阴性、中性前缀、后缀和单独的称呼词。用户自己按人格范围的覆盖以稳定的记忆谱系为键，所以在同一次多个人格回复里，两个人格可以用不同的名字称呼 Sparrow，而两者仍然指向同一个 Discord 用户。编辑官方指针时会先创建一份独立副本；它永远不会改动共享目录或另一个服务器的人格。
