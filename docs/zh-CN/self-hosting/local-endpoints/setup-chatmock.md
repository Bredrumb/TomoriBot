---
title: "配置：通过 ChatMock 使用 Codex CLI"
sidebar:
  order: 5
---

> **关于这份翻译：** 本页是英文版[配置：通过 ChatMock 使用 Codex CLI](https://docs.tomoribot.app/en/self-hosting/local-endpoints/setup-chatmock/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

如果你想让 TomoriBot 通过一个本地 OpenAI 兼容桥接层使用你的 ChatGPT 账户，可以运行 [ChatMock](https://github.com/RayBytes/ChatMock)，并让 TomoriBot 的 `custom` 提供方指向它。

## ChatMock 做什么

- ChatMock 运行一个本地 OpenAI 兼容 API 服务器
- TomoriBot 可以通过 `custom` 提供方使用这个本地服务器

## 1. 启动 ChatMock

按 ChatMock 在 GitHub 上的说明安装并启动它：

- [ChatMock 仓库](https://github.com/RayBytes/ChatMock)

安装之后运行：
```sh
chatmock login
chatmock serve
```

默认情况下，ChatMock 监听 `http://127.0.0.1:8000/v1`

## 2. 配置 TomoriBot 使用 ChatMock

在 Discord 里配置 TomoriBot 的 `custom` 提供方，并使用：

- **端点 URL**：`http://127.0.0.1:8000/v1`
- **模型名称**：ChatMock 应当收到的确切模型字符串，例如 `gpt-5.4` 或 `gpt-5.3-codex`

只写 `http://127.0.0.1:8000` 也可以：TomoriBot 会先把它规范化为 `/v1`，再追加 `/chat/completions`。

为 ChatMock 启用这些能力标记：
- **函数调用与工具**：是
- **图像理解**：是
- **视频理解**：否
- **结构化输出**：是

**注意**：Codex CLI 不允许你更改它的 `system` 提示词，所以作为兼容处理，TomoriBot 的 `system` 提示词会在上下文中变成一个 `user` 回合。请把 `CHATMOCK_PORT` 这个 .env 变量配置成你实际的 ChatMock 端口，好让这个兼容处理正常工作（默认 8000）。
