---
title: "MCP 服务器"
sidebar:
  label: "总览"
  groupLabel: "MCP 服务器"
  order: 8
---

配置自部署的 TomoriBot 以支持 OAuth 登录流程，或在旁运行本地 Model Context Protocol（[MCP](https://modelcontextprotocol.io/)）服务器。

| 指南 | 用途 |
|---|---|
| [MCP 登录配置](/self-hosting/mcp-servers/mcp-sign-in/) | 设置 `TOMORI_PUBLIC_BASE_URL`，让管理员在添加远程 MCP 服务器时可以完成浏览器 OAuth 登录。 |
| [本地 MCP 服务器](/self-hosting/mcp-servers/setup-local-mcp/) | 在 `localhost` 或你的私有网络上运行 HTTP/SSE MCP 服务器，并在 Discord 中注册。 |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | 通过 Streamable HTTP MCP 运行容器化的 `slop-guard` 文本校对器，用于回复审核的规则检查。 |

要在 Discord 中添加、查看或移除 MCP 服务器，请参阅[MCP 服务器](/features/capabilities/tools-and-extensions/mcp-servers/)。
