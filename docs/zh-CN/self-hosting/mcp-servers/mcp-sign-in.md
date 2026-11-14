---
title: "MCP 登录配置"
description: "让自部署的 TomoriBot 可以添加需要账号登录的 MCP 服务器。"
sidebar:
  order: 1
---

某些 MCP 服务器要求管理员登录账号，而不是直接粘贴令牌。自部署的 bot 只有在设置了 `TOMORI_PUBLIC_BASE_URL` 后才会提供登录入口。未设置时，只有能在 `认证令牌` 中填写令牌的 MCP 服务器才能正常工作。

如果你使用的是[公开部署的 bot](https://discord.com/oauth2/authorize?client_id=841644102059556915)，则无需查看本页；请参阅[MCP 服务器](/features/capabilities/tools-and-extensions/mcp-servers/)。

## 选择基础 URL

在 `.env` 中将 `TOMORI_PUBLIC_BASE_URL` 设置为不带路径的地址，然后重启 bot：

| 值 | 适用场景 |
|---|---|
| `http://127.0.0.1:8080` 或 `http://localhost:8080` | 在 bot 所在机器的浏览器中完成登录。无需域名或隧道。 |
| `https://<your-host>` | 管理员在自己的电脑上登录。需要一个能转发到 bot 的公网 HTTPS 地址。 |

设置该变量后，bot 会在 `PORT`（默认为 `8080`）启动 HTTP 服务器，并监听所有网络接口。进行中的登录状态仅保存在内存中，因此如果在登录途中重启 bot，需要从 Discord 重新发起登录。

## 环回地址

- 请使用 `PORT` 中指定的端口。当两者端口不一致时，bot 会在启动时记录一条警告。
- 在 bot 所在机器的浏览器中完成登录。如果从另一台电脑操作，请先通过 SSH 转发该端口，再在该电脑的浏览器中选择 `登录`：

  ```sh
  ssh -L 8080:127.0.0.1:8080 "<user>@<bot-host>"
  ```

- 具体服务是否接受环回地址由该服务自行决定。如果某个服务拒绝环回地址，请改用 HTTPS 地址或令牌。

## HTTPS 地址

将以下路径从你的公网地址转发到 bot 的 `PORT`：

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

各服务通过 `https://<your-host>/oauth/client.json` 识别你的 bot，因此请在第一次登录前选好主机名并保持不变。

## Docker Compose

Compose 默认不会暴露 bot 的端口。请在 `docker-compose.yaml` 同级目录下创建 `docker-compose.override.yaml`：

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

请保留 `127.0.0.1:` 前缀，否则你所在网络中的所有电脑都能访问 bot 的 HTTP 服务器。运行在同一台机器上的反向代理或隧道仍然可以转发到此端口。
