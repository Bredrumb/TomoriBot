---
title: "MCP servers"
sidebar:
  order: 3
---

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) servers extend her with
external tools you register yourself.

### Adding an Online MCP

Use a provider's direct HTTPS endpoint supporting MCP Streamable HTTP or SSE:

Add the endpoint and any required authentication under `/config` > `Plugins` > `MCP Servers`.
Choose `Prose Linter` for a Response Drafting rule checker; its tools are not called during chat.

Authentication tokens are encrypted at rest. Disabling a server used for search or URL reading
restores the built-in tool. A saved tool list reflects the last successful discovery and does not
guarantee the server is currently reachable.

Tool responses are limited to 8 MiB, including the entire stream for SSE connections. Ask the
provider for pagination or smaller results if a tool exceeds the limit.

### Local MCP Servers

Local MCP servers are supported on self-hosted instances only, because the public hosted bot
requires HTTPS and blocks local/private addresses. If you run your own instance, see
[Setup: Local MCP Server](/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Only add MCP servers you trust]
A malicious MCP server can prompt-inject her with hidden instructions, exfiltrate
data users pass to its tools, or return harmful or false results she'll relay to your
server. Treat MCP servers like browser extensions: if in doubt, don't add it. Always review
an MCP's described tools before adding it.
:::
