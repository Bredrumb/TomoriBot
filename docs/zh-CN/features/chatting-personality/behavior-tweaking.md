---
title: "行为调整"
sidebar:
  order: 3
---

TomoriBot 的行为（**她被允许做什么，以及她如何生成内容**）由 `/config` > 权限和 `/config` 控制，此外还有人格（[多个人格](/zh-CN/features/chatting-personality/multiple-personas/)）和知识（[记忆](/zh-CN/features/knowledge/memory/)）。这一页挑出最值得调的几组开关；全部指令见[指令参考](/zh-CN/features/command-reference/)。

## 功能开关：她被允许做什么
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > 权限 用来开关她的各项功能：图像生成、贴纸使用、创建子区、消息管理、屏蔽用户、自我教导、语音消息等等。每个开关就是对应工具的开关（见[工具与扩展](/zh-CN/features/capabilities/tools-and-extensions/)）。一旦关掉，不管用户怎么要求，她就是做不了。

## 生成调校
<!-- anchor: generation-tuning -->

- `/config` > 模型 > 文本采样器与参数：采样参数（温度、top-p 等）：创造力与随机程度。温度越高，输出越多样。
- `/config` > 行为 > 常规行为：她的回复读起来有多像真人。可选的 `scope` 选项决定这个档位作用于全服务器（`Global`，默认值）还是单个人格（`Persona`），当一个人格应该用 3 档随意发消息、另一个人格像写小说时很有用。人格选择「Inherit」会清除它的覆盖。
- `/config` > 行为 > 常规行为：每次触发时她拉取多少条近期消息作为上下文。这是个好用的杠杆：调高能让她更了解对话，调低能省 token 开销。

## 系统提示词
<!-- anchor: system-prompt -->

系统提示词位于人格之上，塑造整体行为：

- `/config` > 行为 > 常规行为：设置自定义系统指令（最长 16,000 个字符）。
- `/config` > 行为 > 常规行为：从系统提示词预设集中挑选一个。
- `/config` > 行为 > 常规行为：恢复默认值。确认消息会显示刚刚被移除的提示词，所以如果你不小心清空了，可以把它复制回来。

当 [SillyTavern 预设集](/zh-CN/features/integrations/sillytavern-support/)处于启用状态时，内置的兜底系统提示词会被替换掉，但你在这里设置的自定义提示词仍然会发送。

## 不做内容过滤
<!-- anchor: uncensored-output -->

TomoriBot **自身没有任何内容过滤**：她不是一套审核机制，也不会在模型之上再加安全栏杆。底层提供方返回什么，她就说什么。所以 `/nsfw jailbreaks` 并不是在 TomoriBot 内部「解锁」什么；它存在的唯一目的，是绕过**提供方那一侧**比你预期更严格的过滤。

它切换三种互相独立的手段（默认全部关闭）：

- **提示词注入**：在上下文里加入一段越狱指令，引导模型避开不必要的拒绝。
- **Unicode 空格**：把普通空格换成看起来一样的 Unicode 空格，让关键词与词元过滤无法匹配到短语，请求文本和她的回复都做同样处理。
- **净化处理**：出于同样的理由混淆一组敏感词，请求和回复两端都做。

这些都不会改变模型*能*做什么；它们只是减少过于积极的提供方过滤拦下本来正常输出的次数。其中部分选项有年龄限制；见[年龄限制指令](/zh-CN/features/setup-administration/age-restricted-commands/)。

## 外观与时间

- `/config` > 人格 > 身份与性格：她怎么称呼自己。
- `/config` > 行为 > 常规行为：服务器时区，用于需要感知时间的回复与提醒。

---

想找的是管理员与成本控制（配额、白名单、BYOK），而不是行为设置？那些在[服务器管理](/zh-CN/features/setup-administration/server-moderation/)里。
