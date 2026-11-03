---
title: "内置工具"
sidebar:
  order: 0
---

工具取决于支持工具调用的活动提供方和模型。许多都受到功能开关（`/config` > `权限`）、Discord权限、模型能力或可选的API密钥的限制。

:::tip
如果某个功能似乎不可用，请询问她原因。她可以报告服务器的功能开关以及活动模型是否支持工具调用，这通常能指出需要修改的设置项。
:::

| 工具 | 提示词宏 | 需要 | 它的作用 |
|---|---|---|---|
| 审核能力 | `{capabilities_tool}` | - | 在回答之前检查当前的聊天能力、指令或设置。 |
| 创建/更新长期记忆 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 保存或替换稳定的服务器事实或用户偏好。 |
| 更新短期记忆 | `{short_term_memory_tool}` | - | 为当前频道或故事线保存临时工作记忆。 |
| 创建/更新任务 | `{task_tool}` / `{task_update_tool}` | - | 安排或编辑提醒与自我任务（参见[计划任务](/features/capabilities/scheduled-tasks/)）。 |
| 跨频道消息 | `{cross_channel_tool}` | - | 在另一个频道或子区中行动，并提供可选的报告。 |
| 创建子区 | `{create_thread_tool}` | `thread_creation_enabled` + 子区权限 | 打开公共子区并发布其起始消息。 |
| 掷骰子 | - | `dice_rolling_enabled` | 公开掷骰子并将返回的结果用于角色扮演。 |
| 选择贴纸 | `{sticker_tool}` | `sticker_usage_enabled` | 在回复中添加匹配的服务器贴纸或自定义表达。 |
| 管理消息 | `{manage_message_tool}` | `manage_message_enabled` | 置顶、编辑或删除最近的消息（置顶需要`管理消息`）。 |
| 屏蔽/取消屏蔽用户 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | 人格范围内的用户静音/屏蔽（不触及记忆）。 |
| 与最近的消息互动 | `{message_interaction_tool}` | - | 对最近的消息添加反应或发送简短的回复。 |
| 查看头像 | `{profile_picture_tool}` | 视觉模型或 `vision_llm` | 检查用户或人格的头像。 |
| 阅读文档 | `{document_tool}` | - | 从PDF或任何UTF-8文本文件中提取文本：源代码（`.py`/`.ts`/`.rs`/…）、`.json`、`.yaml`、`.md`、`.txt`以及任何非二进制附件。 |
| 显示消息元数据 | `{message_metadata_tool}` | - | 为最近的回合附带标识符和时间戳，以实现精准定位。 |
| 处理YouTube视频 | `{youtube_tool}` | 具有视频支持的模型 | 按需分析特定的YouTube链接。 |
| 分析图像 | `{image_analysis_tool}` | 配置为 `vision_llm` | 将图像理解委托给单独的视觉模型。 |
| 生成图像/动漫图像 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 具备能力的提供方 | 生成或编辑图像（参见[媒体生成](/features/capabilities/media-generation/image-generation/)）。 |
| Danbooru 标签查询 | `{tag_search_tool}` | `danbooru_enabled` | 将角色名称、昵称和猜测的标签转换为准确的 Danbooru 标签（参见[Danbooru 标签查询](/features/capabilities/tools-and-extensions/danbooru/)）。 |
| Danbooru 插画搜索 | `{booru_post_search_tool}` | `danbooru_enabled` | 发送最多 4 张符合 1 到 2 个标签的现有 Danbooru 图像（参见[插画搜索与投稿读取](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)）。 |
| Danbooru 投稿读取 | - | `danbooru_enabled` | 通过 ID 或链接读取单个 Danbooru 投稿的分组标签。 |
| 生成语音消息 | `{voice_message_tool}` | ElevenLabs 密钥 + 人格语音 + `voice_message_enabled` | 发送 Discord 语音回复。 |

:::note[提示词作者须知]
自定义系统提示词或人格指令时，请通过上表中的**提示词宏**来引用工具，而不是硬编码工具名称，因为宏会在组装上下文时展开为正确的名称，并在工具不可用时平稳降级。`{pin_tool}` 和 `{timestamp_refresh_tool}` 仍可作为 `{manage_message_tool}` 和 `{message_metadata_tool}` 的兼容别名。下方的网络搜索和URL工具也有宏：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}` 和 `{url_metadata_tool}`。这些宏会动态解析为最佳可用引擎，包括服务器 MCP 替代项。
:::

### 条件提示词区块

支持上述工具宏的提示词文本也支持作用域条件：

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

对于已启用的 TomoriBot 设置使用 `capability:<name>`；当且仅当活动提供方和模型支持该确切工具时才显示文本，则使用 `tool:<function_name>`。当自带的 URL 读取器或服务器 MCP 替代项可用时，使用 `tool_family:url_fetch`。在条件前加上 `!` 可将其取反。区块可以嵌套，并且可以包含一个 `{{else}}`；不支持通用的 `and`/`or` 表达式。

支持的功能名称为 `tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory` 和 `time_awareness`。

工具条件反映了提供方/模型支持、服务器配置、配置的后端、MCP 替代项以及当前的明确工具模式允许名单。它们不会绕过或预测工具执行时执行的 Discord 权限检查。未知的功能名称评估为 false 并记录日志；格式错误的区块会被忽略。原始聊天消息、模型输出和工具结果永远不会被当作条件模板处理。
