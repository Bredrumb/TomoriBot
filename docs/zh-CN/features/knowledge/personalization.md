---
title: "个性化"
sidebar:
  order: 3
---

TomoriBot 可以用 `/personal` 系列指令针对**你个人**进行配置：这些设置会跟着你走过每一个与她共存的服务器，独立于任何服务器的配置。

## 个人记忆

她记住的关于你的事实会跟着你在服务器之间走。管理它们（添加、移除、导出）
见[记忆](/zh-CN/features/knowledge/memory/#personal-vs-server-memories)页面。

## 资料与人格感知称呼

`/personal config` 保存三项互相独立、可选的偏好：性别认同、
人称代词和称呼风格。TomoriBot 绝不会从其中一项推断另一项。称呼风格
决定某个人格使用阳性、阴性还是中性的命名变体，中性是
预选的默认值。留空的字段会被清空，并从提示词上下文里省略。原始资料
字段只在「无」隐私等级下才会暴露。

`/personal config` 会打开一个命名弹窗，作用范围可选全局或某个人格。按人格范围的
偏好会跟随那个人格稳定的记忆谱系跨服务器生效。昵称的继承顺序是人格偏好、
再到全局偏好，最后才是 Discord 实时的显示名。全局昵称留空就会继续跟随 Discord，包括之后的显示名变更。保存一个全局
昵称则会冻结那个自定义值，直到它被清空。前缀或后缀留空时按同样的方式继承，输入文字就会覆盖它，所以 `Master Sparrow-san`
可以组合来自不同层级的取值，而不改变底层指向的 Discord 提及
目标。要去掉某个人格自己加上的称呼，直接跟那个人格说（「别叫我主人」）；这样只会为那个人格抑制它，其他
人格不受影响。

服务器管理员可以用 `/config` > 人格 > 身份与性格 配置人格默认值。像 `fam` 这样的独立
称呼词与格式化后的名字是分开的，只对人格自己写的提示词文本可用。默认开启的 User Info Updates 功能允许人格
应用对话中明确提出的结构化修改。关掉它会停止自动的
工具更新，但不会禁用 `/personal config`。

`/personal config` 只保存 -12 到 +14 的数字 UTC 偏移。它不保存
也不推断地理位置或 IANA 时区。

## 你自己的提供方 {#your-own-providers}

个人提供方让你*自己的请求*使用*你自己的* API 密钥和模型，而不是
服务器的默认值。这就是个人层面的 BYOK（bring your own key，自备密钥）。

这里涉及两个范围，值得分清：

- **服务器默认**：`/providers` 里的共享凭据与目录，路由由拥有所需服务器权限的成员通过
  `/model` 选择。它对那里的所有人生效。
- **个人覆盖**：只用于你自己请求的配置。启用后，它会在你使用
  TomoriBot 的**每一个服务器**里覆盖该功能的服务器默认，而不只是你设置它的那个服务器。

**设置步骤：**

1. `/personal providers` 保存一个提供方（你的密钥会被加密）。这同时会立刻启用你的
   个人**文本**覆盖，使用该提供方的默认文本模型。
2. `/personal config` 可以为你的个人文本覆盖选择不同的模型。
   在这里选一个模型会保持文本覆盖处于启用状态。
3. 需要更新凭据、管理自定义
   端点，或者添加与编辑个人模型登记时，回到 `/personal providers`。

用 `/personal config` 选择模型会为你的请求启用该功能。

因为第 1 步和第 2 步会把你切到跨服务器覆盖，所以每当某个功能从服务器默认切到个人
配置时，TomoriBot 都会在保存前请你确认。在已经负责你请求的提供方上轮换密钥
会跳过这个确认，因为路由并没有变。

思考日志会把这些轮次归到你名下，你可以用 `/personal config` 调整它们。
这会影响你在所有地方的请求，并且绝不触碰这个服务器的设置。你也可以
用 `/personal providers` 登记个人自定义端点；见
[自定义端点](/zh-CN/features/setup-administration/providers-and-models/#custom-endpoints)。

如果在使用你的个人提供方时请求失败，错误里的「你可以做什么」提示会点名
真正能修好它的个人指令（`/personal providers`、`/personal config`），
而不是那些服务器管理指令。

:::note[要求 BYOK 的服务器]
服务器可以通过 User BYOK 模式要求成员自备提供方
（[服务器管理](/zh-CN/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)）。开启之后，
你触发的消息需要先有个人提供方，她才能回答。个人
提供方在你使用她的每一个服务器里都生效。
:::

## 其他个人设置

- `/personal config`：改她怎么称呼你。
- `/personal config`：你自己的外貌标签（booru 风格），在
  [图像生成](/zh-CN/features/capabilities/media-generation/image-generation/#标签自定义)
  引用你时使用。提交一个空框即可清除它们。
- `/personal config`：控制她对你的可见程度，最高可以**完全不可见**（彻底退出
  记忆功能）。
- `/personal config`：你对
  [明确触发模式](/zh-CN/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)的个人覆盖。
- `/personal config`：选择加入跨服务器短期记忆共享；
  `/personal memories` 会清空你的 STM。
- `/personal config`：设置一段可复用的提示词，供她通过
  `/impersonate user` 扮演你时使用。

## 个人聚光灯 {#personal-spotlight}

**个人聚光灯：按频道指定人格。** 聚光灯让你在某个频道里收窄自己
能触发哪些人格，并可选地为你在那里的消息指派一个人格做自动触发。它的范围是**你 + 一个频道**，不影响其他人。

**设置一个**用 `/personal config`，选择：

- 以小时为单位的时长（用 **0** 表示一直保留到你手动移除），
- 目标频道，
- 你想放进聚光灯的人格。

选完人格之后，你可以选一个作为你的**个人自动触发
人格**：在那个频道里你消息的兜底回复者。直接触发仍然会
指向你明确叫的那个人格。按 Finish 可以跳过。

**重要规则：**

- 聚光灯只**收窄**访问范围，绝不会扩大它。选中的那些人格式你在那里*唯一*
  能触发的。
- 它仍然遵守通过 `/moderation` 配置的服务器级人格限制。
- 代理链会被阻断：如果你的聚光灯只包含 Alice，那么在你这条消息链里，Alice 的回复不能
  转交给 Bob。

用 `/personal config` 查看或移除条目（取消勾选即可移除；限时
聚光灯会自行过期）。在 `/help` 里选择 **行为**，再选 **个人聚光灯**，可以看到 Discord 里的说明。
