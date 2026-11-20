---
title: "MCP Servers"
sidebar:
  label: "Overview"
  groupLabel: "MCP Servers"
  order: 8
---

Configure your self-hosted TomoriBot to support OAuth sign-in flows or run local Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) servers alongside it.

| Guide | Purpose |
|---|---|
| [MCP Sign-In Setup](/self-hosting/mcp-servers/mcp-sign-in/) | Set `TOMORI_PUBLIC_BASE_URL` so admins can complete browser OAuth when adding remote MCP servers. |
| [Local MCP Server](/self-hosting/mcp-servers/setup-local-mcp/) | Run an HTTP/SSE MCP server on `localhost` or your private network and register it in Discord. |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | Run the containerized `slop-guard` prose linter over Streamable HTTP MCP for Response Drafting rule checks. |

To add, inspect, or remove MCP servers in Discord, see [MCP servers](/features/capabilities/tools-and-extensions/mcp-servers/).
