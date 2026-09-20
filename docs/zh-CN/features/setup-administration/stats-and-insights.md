---
title: "统计与洞察"
sidebar:
  order: 4
---

TomoriBot 会记录用量，让你看到谁在和谁说话、哪些人格和模型被用到、
以及哪些工具被触发（还能把它变成一张可分享的信息图）。

## 文字仪表盘

三条指令会打开一个可交互的分页仪表盘（Overview、Personas、Models & Cost、
Tools & Commands、Expression、Favorite People、Leaderboard）：

文字分页是由发起者控制的公开持久仪表盘。它们会一直可用
直到消息被移除，其他用户无法操作这些控件。

- `/stats personal`：你自己的用量。
- `/stats persona`：某个人格在这个服务器上的用量。
- `/stats server`：全服务器的用量。

大多数都支持**时间范围**窗口，个人统计还可以限定在这个服务器或
所有服务器。

:::note
**Token 计数**在提供方有报告时用的是它自己上报的用量（只有完全不报告用量的提供方才会
改用基于字符的估算）。**费用**按模型目录的标价计算这些
token，所以可能与你的实际账单不同（提示词缓存、折扣、
免费档位额度等等）。
:::

## 可分享的信息图卡片

`/stats generate` 会渲染一张可以直接发到聊天里的精美图片卡片：

- **Personal Wrapped**：你的个人活动，Spotify Wrapped 风格。
- **Persona Affinity**：某个人格在这个服务器上的统计。
- **Server Leaderboard**：全服务器的排行。

完全私密的用户（`/personal config`）无法生成个人卡片。

关于卡片如何组成与渲染，见
[统计信息图子系统](/en/architecture/subsystems/stats-infographic/)的架构参考。
