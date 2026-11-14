---
title: "MCPサーバー"
sidebar:
  label: "概要"
  groupLabel: "MCPサーバー"
  order: 8
---

セルフホストのTomoriBotでOAuthサインインフローを有効にするか、ローカルのModel Context Protocol（[MCP](https://modelcontextprotocol.io/)）サーバーを併用するように設定します。

| ガイド | 目的 |
|---|---|
| [MCPサインインのセットアップ](/self-hosting/mcp-servers/mcp-sign-in/) | 管理者がリモートMCPサーバーを追加する際にブラウザーでOAuthを完了できるよう、`TOMORI_PUBLIC_BASE_URL` を設定します。 |
| [ローカルMCPサーバー](/self-hosting/mcp-servers/setup-local-mcp/) | `localhost` またはプライベートネットワーク上でHTTP/SSE MCPサーバーを実行し、Discordで登録します。 |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | 下書きレビューのルールチェック用に、コンテナ化された文章校正ツール `slop-guard` をStreamable HTTP MCP経由で実行します。 |

DiscordでMCPサーバーを追加、確認、または削除するには、[MCPサーバー](/features/capabilities/tools-and-extensions/mcp-servers/)を参照してください。
