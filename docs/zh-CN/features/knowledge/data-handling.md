---
title: "数据处理"
sidebar:
  order: 4
---

TomoriBot 的构建目标之一就是对你的数据保持透明。她存下的所有东西你都可以导出、导入或删除，这一页会逐项说明那到底是什么。法律文本见 `/legal privacy-policy` 和 `/legal terms-of-service`。

:::note
这一页讲的是 Discord 内的按用户控制项。**自己部署一套实例？** 整个数据库的备份与还原属于主机侧操作；见
[维护与备份](/zh-CN/self-hosting/maintenance/)。
:::

## 她存了什么

**会存：**

- 服务器记忆与个人记忆
- 她的设置与人格数据
- 服务器配置
- 加密后的 API 密钥

**不会存：**

- 你的 Discord 消息
- 聊天历史

**会发给你的 AI 提供方：** 每当她被触发，她会取频道里的**最新消息**以及任何**相关记忆**作为模型的上下文。除了这些触发之外，她不会监控或读取消息。

:::note
你选择的 AI 提供方（Google、OpenRouter、NovelAI 等）按*它们自己的*隐私政策处理消息。永远不要向任何 AI 分享敏感的个人信息。
:::

## 导出你的数据

所有可导出的内容都会以 JSON 文件的形式发到你的私信：

- `/export config`：服务器配置值（不含 API 密钥、凭据或提供方设置）。
- `/export personal config`：你的个人设置（资料、隐私、外观、回复模式）。
- `/export memories`：服务器记忆，范围可为主人格、选定的某个人格，或每个人格分别导出。
- `/export personal memories`：你的个人记忆，范围为全局、某个人格，或每个人格分别导出。
- `/persona export`：完整的人格定义。

## 导入你的数据

附上之前导出的文件即可恢复：

- `/import config`：服务器配置；需要**管理服务器**权限。可以选择要应用哪些检测到的区块。
- `/import personal config`：你的个人设置。可以选择要应用哪些检测到的区块。
- `/import memories`：服务器记忆；需要**管理服务器**权限。可合并或替换，如果文件里有多个来源人格，还能逐一映射。
- `/import personal memories`：你的个人记忆。可合并或替换，如果文件里有多个来源人格，还能逐一映射。
- `/persona import`：恢复一个人格。它也接受 PNG 和 JSON 格式的 SillyTavern 角色卡，以及
  `.charx` 的 Character Card V3 压缩包，这两种只导入角色文本（见
  [SillyTavern 支持](/zh-CN/features/integrations/sillytavern-support/)）。

## 删除你的数据

下面这些会永久移除或重置数据，**无法撤销**：

- `/personal memories`、`/memories`
- `/reset config`：把 29 张配置表里的服务器配置重置为数据库默认值。
  - **恢复为 DDL 默认值的单例表（18 张）：** chat configs、model configs、member permissions、capabilities、notice embeds、nsfw configs、speech configs、auto-trigger configs、channel scope configs、trigger behavior configs、NovelAI image generation configs、BYOK configs、memory configs、short-term memory configs、welcome configs、image quota configs、text quota configs 和 video quota configs。
  - **保留的配置（两组）：** `server_model_configs` 里当前生效的模型 ID、凭据和自定义端点参数（`llm_id`、`embedding_model_id`、`diffusion_model_id`、`video_model_id`、`vision_llm_id`、`api_key`、`key_version`、`custom_endpoint_url`、`custom_model_name`、`custom_num_ctx`、`other_model_codename`、`other_model_capabilities`、`other_model_capabilities_fetched_at`），以及当前生效的 NovelAI 扩散模型身份（`server_novelai_imagegen_configs` 里的 `nai_diffusion_model_id`）。
  - **清空的集合（11 张表）：** `server_auto_trigger_persona_overrides`、`stm_categories`、`random_triggers`、`channel_llm_overrides`、`channel_prompt_overrides`、`channel_context_notes`、`personalization_blacklist`、`persona_user_blocks`、`channel_whitelist`、`role_whitelist` 和 `channel_persona_whitelist`。
  - **保留的领域：** 人格与人格设置、服务器记忆、短期记忆、表情（表情与贴纸）、已记录的配额消耗、保存的提供方配置，以及外部集成（Matrix 与 MCP）。
  - **上下文与权限：** 在服务器里需要管理服务器权限。在私信（DM）里可用，使用发起操作的用户工作区 snowflake。
- `/reset personal config`：把所有服务器上的用户配置和个人频道聚光灯重置为数据库默认值。
  - **重置的字段：** 恢复 `users.language_pref`（'en-US'）和 `users.privacy_level`（0），把 `user_personalization_configs` 的全部 13 列（昵称、跨服务器选择加入、外貌标签、角色参考 URL、扮演提示词、个人 DTM、明确工具模式、时区偏移、前缀与后缀覆盖、性别认同、人称代词、称呼风格）恢复为架构默认值，并删除所有 `user_persona_naming_preferences`。
  - **清空的集合：** 删除该用户在所有工作区里的 `personal_spotlights`，级联到 `personal_spotlight_personas`。
  - **保留的个人领域：** 用户账号身份、注册语言、个人记忆、保存的提供方配置（`user_saved_provider_configs`）、自定义端点，以及定时任务与提醒。
  - **上下文：** 所有用户在服务器和私信里都可以使用。

## 选择退出

- `/personal config`：控制她对你的可见程度，最高可以完全不可见（彻底退出
  记忆功能）。
- `/config` > 权限：服务器管理员可以关掉自我学习和其他功能。

关于记忆日常如何运作，见[记忆](/zh-CN/features/knowledge/memory/)。
