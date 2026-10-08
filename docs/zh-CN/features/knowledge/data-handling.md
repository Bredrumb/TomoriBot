---
title: "数据处理"
sidebar:
  order: 4
---

使用Discord斜线命令导出、备份、导入或删除你的设置、记忆和人格。有关服务条款和隐私详细信息，请参阅`/legal terms-of-service`和`/legal privacy-policy`。

:::note
本页涵盖Discord内的用户控件。在自部署实例上，完整数据库备份和恢复是主机端操作； 参见[维护与备份](/zh-CN/self-hosting/maintenance/)。
:::

## 她储存什么

### 存储数据

- 服务器和个人记忆
- 人格简介、特征和对话示例
- 服务器配置设置
- 加密提供商API密钥
- 表情元数据、人格访问规则和上传的表情媒体

### 未存储

- Discord消息历史记录（消息未存档在持久消息日志中）

### 发送给你的AI提供商

每当触发时，TomoriBot都会获取通道中的最新消息以及相关内存作为模型的上下文。她不会阅读或处理这些触发器之外的消息。

:::note
你选择的AI提供商（Google、OpenRouter、NovelAI等）根据自己的隐私政策处理消息。避免共享敏感的个人凭据或机密数据。
:::

## 导出你的数据

可导出的数据以JSON文件形式传送到你的DM：

- `/export config`：服务器配置值（不包括API密钥和凭据）。
- `/export personal config`：个人资料设置（隐私、外观标签、命名）。
- `/export memories`：服务器内存，范围为主要人格、一个人格或所有人格。
- `/export personal memories`：个人记忆，范围全局或每个人格。
- `/persona export`：完整的人格定义。

上传的表达媒体存储在服务器主机上，并且位于这些JSON导出之外。自部署者必须同时备份数据库存储和媒体资产； 请参阅[自定义媒体备份](/zh-CN/self-hosting/safe-migration/#custom-expression-media-backups)。

## 导入你的数据

附加导出的文件以将其恢复：

- `/import config`：服务器配置（需要管理服务器）。选择要应用的部分。
- `/import personal config`：个人设置。选择要应用的检测到的部分。
- `/import memories`：服务器内存（需要管理服务器）。合并或替换并映射人格。
- `/import personal memories`：个人回忆。合并或替换并映射人格。
- `/persona import`：恢复人格。还导入SillyTavern PNG卡、JSON卡和`.charx`档案（请参阅 [SillyTavern支持](/zh-CN/features/integrations/sillytavern-support/)）。

## 删除你的数据

这些操作永久删除或重置存储的数据：

- `/personal memories`：管理或删除个人记忆。
- `/memories`：管理或删除服务器内存（需要管理服务器）。
- `/personal nuke`：永久删除跨服务器的所有个人数据。
- `/nuke`：擦除服务器数据，包括自定义表达式和人格访问规则。设置`preserve_personas: true`以保留人格，同时删除自定义表达式和媒体。
- `/reset config`：将服务器配置恢复为数据库默认值。
  - **保留**：活动模型分配、API密钥、自定义端点、人格、服务器内存和集成。
  - **清除**：通道覆盖、自动触发规则、用户黑名单和通道白名单。
  - 需要服务器中的管理服务器权限； 也可在DM中使用。
- `/reset personal config`：将个人资料设置和频道聚焦恢复为默认值。
  - **保留**：用户身份、个人记忆、保存的提供者API密钥、自定义端点和计划任务。
  - **清除**：昵称覆盖、外观标签、代词、称呼风格和频道焦点。
  - 可供服务器和DM中的所有用户使用。

有关确切的数据库表和保留的列列表，请参阅[数据库架构架构](/en/architecture/subsystems/database-schema/#reset-domain-classifications)。

## 选择退出

- `/personal config`：控制你的可见性，直至完全不可见（选择退出内存上下文）。
- `/config` > `权限`：服务器管理员可以关闭自学习和内存功能。

日常内存管理请参见[内存](/zh-CN/features/knowledge/memory/)。
