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

### Adding a Smithery Server

Servers hosted on Smithery have addresses ending in `.run.tools`. Paste that address into `URL`
and your Smithery API key into `Auth Token`. TomoriBot sends the key only to Smithery's API at
`api.smithery.ai`, never to the server address itself. Smithery then passes each tool call to the
server, so Smithery sees every tool request and result. Registrations saved before this support
returned work again without changes.

Some servers ask you to sign in with the service they wrap. Adding one fails with a message that
authorization is needed, and TomoriBot never shows the sign-in link in Discord. Open your Smithery
dashboard, finish the sign-in for the connection whose name starts with `tomoribot-`, then add the
server again. Connecting and listing tools must finish within 15 seconds.

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
