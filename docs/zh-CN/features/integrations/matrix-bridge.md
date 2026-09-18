---
title: "Matrix 桥接"
sidebar:
  order: 1
---

TomoriBot 可以把一个 **Matrix 房间**桥接到一个 Discord 频道：人们在 Matrix 里聊天，他们的
消息会以 Webhook 消息的形式转发进 Discord，而她则会回复到 Matrix 房间里。
这一页讲的是桥接的用户侧。appservice 的内部细节见
[Matrix 桥接架构](/en/architecture/integrations/matrix/bridge/)。

## 设置

1. 把配置好的 Matrix bot 账号邀请进一个**未加密**的 Matrix 房间。
2. 复制那个房间的 **Internal Room ID**（内部房间 ID）。
3. 在你想桥接的 Discord 频道里运行 `/matrix link`，粘贴房间
   ID。

bot 接受邀请后会在 Matrix 房间里发一条简短提醒，但你仍然要在 Discord 里
用 `/matrix link` 完成关联。

### 找到房间 ID

在大多数 Matrix 客户端里：**Room Settings → Advanced → Internal Room ID**（房间设置 → 高级 → 内部房间 ID）。它长这样：
`!abc:matrix.org`。

## 从 Matrix 这一侧使用

- 房间关联好之后正常聊天即可；Matrix 消息会转发进 Discord 频道。
- 她会回复到 Matrix 房间里。
- Matrix 里只有 `/kill` 和 `/refresh` 这两条文字指令。

## 目前的限制

- 不能从 Matrix 使用斜杠指令（`/kill` 和 `/refresh` 除外）。
- 没有私信，也没有基于私信的冷却提醒。
- Matrix 的头像她看不到。
- 不能置顶消息。
- 自定义表情和 Markdown 渲染不可靠；嵌入会以纯文本转发。
- Matrix 用户的个人记忆会退化成带归属的服务器记忆。

## 注意事项

- 如果 bot 没有自动加入，手动邀请 Matrix bot 账号，然后重新运行
  `/matrix link`。
- **Matrix 加密之后无法关掉**：已经加密的房间必须换成一个
  全新的未加密房间。
- 如果某个限制不在上面，就假设它应该能用，并到支持
  服务器里报告问题（`/support discord`）。

在 `/help` 里选择 **集成**，再选 **Matrix**，可以看到 Discord 里的同一份指南。
