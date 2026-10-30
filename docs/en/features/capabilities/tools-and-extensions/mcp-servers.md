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

### Adding an MCP that needs sign-in

Some services, such as Linear and Notion, ask you to sign in to your account instead of giving you
a token. Add the MCP with `Auth Token` left blank. When the server asks for a sign-in, the panel
shows a `Sign In` button:

1. Choose `Sign In` and sign in to the service within 10 minutes.
2. The confirmation page names your Discord server and the MCP's address. Choose `Connect` only if
   both are right and you started this sign-in yourself.
3. The panel updates in Discord once the MCP is added.

Every member who uses the MCP's tools acts as the account that signed in, so use an account whose
data the whole server may see.

When a sign-in expires or the service asks for more access, that MCP's tools pause and its row
shows `Reconnect`. Choose it and sign in again; the MCP keeps its name, type, and slot.

Sign-in works only when adding an MCP in a server, not in a DM. On a self-hosted bot, the host sets
it up first; see [MCP Sign-In Setup](/self-hosting/mcp-sign-in/).

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
