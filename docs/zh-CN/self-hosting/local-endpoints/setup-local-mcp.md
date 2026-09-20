---
title: "配置：本地 MCP 服务器"
sidebar:
  order: 6
---

[MCP](https://modelcontextprotocol.io/) 服务器用外部工具扩展 TomoriBot。在线
（HTTPS）的 MCP 服务器在任何实例上都能用；见
[工具与扩展](/zh-CN/features/capabilities/tools-and-extensions/#本地-mcp-服务器)。**本地** MCP 服务器则
不一样：

:::caution[仅限自部署]
本地 MCP 服务器**只在自部署实例上受支持**。公开托管的 bot 出于安全原因要求 HTTPS，并会拦截本地与私有地址，所以它无法访问跑在 `localhost` 或你局域网里的服务器。
:::

## 1. 运行一个本地 MCP 服务器

启动任意一个在本地端口上暴露 HTTP 或 SSE 传输的 MCP 服务器。例如，很多 MCP 服务器通过 Node 运行：

```sh
npx -y <some-mcp-server> --port 3000
```

确切的命令取决于你要运行哪个服务器。记下它打印出来的 URL 和传输路径（通常类似 `http://localhost:3000/sse`）。

TomoriBot 自己的工具链要求主机上有 **Node.js v20+** 可供 MCP 工具使用。

## 2. 在 Discord 里注册它

打开 `/config` > 插件 > MCP 服务器，选择 **+ 添加 MCP**，把 **服务器 URL** 字段指向你的本地服务器，并把必填的 **服务器类型** 保留在默认的 **通用型** 值上：

```text
http://localhost:3000/sse
```

把 **认证令牌（可选）** 字段留空：本地服务器不需要认证令牌。

## 3. 管理它

- 打开配置页面，在服务器的行上选择 **移除**。确认后会注销该服务器，立即断开连接，并释放一个名额。

## 安全

:::danger[只添加你信任的 MCP 服务器]
即使是你自己运行的本地服务器，只要它的代码不可信，也可能出问题。恶意的 MCP 服务器可能对模型做提示词注入、窃取传给它的工具的数据，或者返回 TomoriBot 会转达的有害结果。接入之前请先看清一个 MCP 服务器到底做什么。
:::

在线 MCP 的流程和完整的安全理由，见
[工具与扩展 → MCP 服务器](/zh-CN/features/capabilities/tools-and-extensions/#mcp-servers)。
