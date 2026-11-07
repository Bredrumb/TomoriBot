---
title: "长期记忆"
sidebar:
  order: 1
aiGenerated: false
---

长期记忆是 TomoriBot 保留的简短事实，除非有人将其移除，否则会一直保存。它们在 `/refresh` 和重启后依然存在。她还会通过[文档](/features/knowledge/memory/documents/)、[世界书](/features/knowledge/memory/lorebooks/)以及[短期记忆](/features/knowledge/memory/short-term-memory/)进行记忆；`/memories` 为每一项都提供了对应的选项卡。至于性格与行为，请参阅[多个人格](/features/chatting-personality/multiple-personas/)。

## 个人记忆与服务器记忆
<!-- anchor: personal-vs-server-memories -->

个人记忆是关于你的事实。它们跨服务器跟随你，并在你参与对话时使用。服务器记忆则包含供该服务器内所有人使用的信息。

每个人格都拥有独立的个人记忆与服务器记忆。在 `/personal memories` 的全局页面添加的个人记忆适用于每个人格。使用 `/personal memories` 管理个人记忆，使用 `/memories` 管理服务器记忆。

受支持的消息代理服务让 TomoriBot 能为已验证的代理身份保留独立的个人记忆。宿主 Discord 账号掌控隐私与授权。设置与限制请参阅[消息代理支持](/features/integrations/message-proxy-support/)。

## 保存记忆

你可以自己保存记忆，TomoriBot 也可以在对话中自主决定保存。当她保存一条记忆时，会发送一条确认所学内容的嵌入消息。如果没有该确认，相关信息就仅保留在对话历史中，而不会存入长期记忆。

如果你想让她记住某件事，直接要求她记住，或者自己手动添加。服务器管理员可以在 `/config` > `权限` 中禁用自动保存。

## 记忆上限
<!-- anchor: how-many-memories -->

默认情况下，每个人格最多可保存 100 条个人记忆和 100 条服务器记忆。全局个人记忆计入每个人格的个人上限。自部署者可以通过 `MAX_PERSONAL_MEMORIES`、`MAX_SERVER_MEMORIES` 和 `MAX_MEMORY_LENGTH` 修改这些上限。

:::tip
宁可多存短记忆，也不要少存长记忆。使用提高后的 `MAX_MEMORY_LENGTH` 的记忆在每次激活时都会完整发送，而 `MAX_PERSONAL_MEMORIES` 和 `MAX_SERVER_MEMORIES` 中多出的槽位在填满前不消耗任何成本。长篇参考文本适合放入[文档](/features/knowledge/memory/documents/)中，文档会通过搜索检索，而不会完整发送。
:::

### 记忆衰退

配置了嵌入模型后，一条记忆如果在计数的 7 个对话日内未与对话匹配，就会进入休眠状态：它依然处于保存状态，但不再进入日常提示词，直到后续消息再次将其召回。当列表已满时，自动保存可以遗忘一条休眠记忆，但绝不会遗忘全局个人记忆，或是某人通过 `/memories` 或 `/personal memories` 添加或编辑过的记忆。请参阅[记忆衰退](/features/knowledge/memory/memory-decay/)。

对于应该始终生效的指令，请使用[人格属性](/features/chatting-personality/multiple-personas/#attributes)、人格提示词，或[常开（Always On）世界书条目](/features/knowledge/memory/lorebooks/)。

## 控制记忆何时激活
<!-- anchor: controlling-when-memories-activate -->

当所有者和范围与对话匹配时，生效中的记忆会被包含在内。休眠记忆在相关时通过搜索返回。频道限制会缩小适用的位置，个人记忆还可以使用关键词标签。

### 个人记忆标签
<!-- anchor: keyword-tags -->

个人记忆可以携带关键词或 `#channel` 标签。在 `/config` > `行为` > `高级记忆` 中开启标签功能。开启后，带有标签的个人记忆仅在对话中出现其关键词之一时才会出现，未加标签的记忆则保持激活。`#channel` 标签会将其限制在该频道内。使用 `/tool prompt snapshot` 查看哪些记忆处于激活状态。

服务器记忆不再使用关键词标签。编写的设定属于[世界书](/features/knowledge/memory/lorebooks/)，世界书中可以按条目设置关键词和常开（Always On）。

### 频道

服务器记忆和文档可以限制在选定的频道及其子区中。个人记忆使用 `#channel` 标签。世界书条目同样支持选择频道。

较早的服务器记忆与文档的 `#channel` 标签已转换为频道选择。如果带标签的频道已不存在，该条目会在所有频道保持有效；`/memories` 会标识出这些条目，以便你选择新频道。

## 奖励与惩罚
<!-- anchor: conditioning -->

奖励与惩罚用于引导人格在服务器中的行为。附带原因给予人格的奖励与惩罚会成为她可以付诸行动的偏好。没有原因的互动会被计数，但不会出现在她的提示词中。使用 `/conditioning` 查看或清除奖励与惩罚。

趣味互动还可以让人格奖励或惩罚用户及其他人格。与用户的互动不会保存偏好；与人格的互动可以提示它们做出回应。服务器管理员可以在 `/config` > `插件` > `可用工具` 中禁用该工具。

## 隐私

关于 TomoriBot 存储的内容以及如何导出或删除，请参阅[数据处理](/features/knowledge/data-handling/)与 `/legal privacy-policy`。你可以使用 `/personal config` 选择退出记忆。
