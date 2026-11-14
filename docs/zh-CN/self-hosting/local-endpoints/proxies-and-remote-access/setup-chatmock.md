---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
---

使用 [ChatMock](https://github.com/RayBytes/ChatMock) 将 TomoriBot 连接到本地 Chat Completions 桥接服务。

:::danger[使用 CLI 账号代理需自行承担风险]
通过 CLI 账号进行第三方访问可能违反提供方条款，并存在账号被封禁的风险。订阅并不代表获得了用于 bot 或 API 的授权。登录前请先查阅[账号风险指引](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk)；TomoriBot 不提供任何账号安全保证。
:::

## 1. 启动 ChatMock

1. 按照 [ChatMock 仓库说明](https://github.com/RayBytes/ChatMock)安装 ChatMock。
2. 在你的账号与访问方式均允许此用途的情况下，进行身份验证并启动服务器：

```sh
chatmock login
chatmock serve
```

3. 确认本地 API 可通过 `http://127.0.0.1:8000/v1` 访问。

## 2. 配置 TomoriBot

1. 运行 `/providers` 或 `/personal providers`，添加一个 `OpenAI 兼容` 自定义端点。
2. 填入连接设置：

| 字段 | 值 |
|---|---|
| 端点 URL | 非生产环境下 bot 运行在本机时，填 `http://127.0.0.1:8000/v1` |
| 认证令牌 | 若已开启身份验证，填写该桥接服务的客户端密钥 |

3. 选中已保存的端点，添加`文本模型`，并填入 ChatMock 公开的精确 API ID。在同一连接下注册更多 ID 即可切换模型。

- 裸地址 `http://127.0.0.1:8000` 会自动规范化为 `/v1`；不要手动追加 `/chat/completions`。
- 在 TomoriBot 开发环境的 `ALLOW_PRIVATE_NETWORK` 设置中允许 `127.0.0.1:8000`。Docker 中的环回地址指向容器自身。
- 仅在测试好桥接服务和所选模型后，再启用工具调用、图像输入或结构化输出。保持视频关闭。
- 对于独立托管的生产环境bot，请遵循[Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)指南。生产环境需要公网HTTPS。基于环回地址与端口的ChatMock提示词直接检测不适用于隧道的公网主机名，因此请单独验证系统指令行为。账号登录仅授权ChatMock的上游请求，并不会对公网端点的客户端进行身份验证。在共享前请先查看隧道指南中的[已知风险](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks)。

:::note[系统提示词处理与端口配置]
TomoriBot 会检测 `CHATMOCK_PORT`（默认为 `8000`）上的环回端点，并将系统指令转换为初始用户轮次以兼容 ChatMock。如本地 ChatMock 使用其他端口，请设置 `CHATMOCK_PORT` 与之匹配。
:::
