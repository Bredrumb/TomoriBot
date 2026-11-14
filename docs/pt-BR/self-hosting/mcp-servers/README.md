---
title: "Servidores MCP"
sidebar:
  label: "Visão Geral"
  groupLabel: "Servidores MCP"
  order: 8
---

Configure seu TomoriBot com hospedagem própria para oferecer suporte a fluxos de login OAuth ou execute servidores Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) locais em conjunto com ele.

| Guia | Finalidade |
|---|---|
| [Configuração de Login MCP](/self-hosting/mcp-servers/mcp-sign-in/) | Defina `TOMORI_PUBLIC_BASE_URL` para que administradores possam concluir o OAuth no navegador ao adicionar servidores MCP remotos. |
| [Servidor MCP Local](/self-hosting/mcp-servers/setup-local-mcp/) | Execute um servidor MCP HTTP/SSE em `localhost` ou na sua rede privada e registre-o no Discord. |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | Execute o verificador de prosa `slop-guard` em contêiner via MCP Streamable HTTP para verificações de regras da Revisão de respostas. |

Para adicionar, inspecionar ou remover servidores MCP no Discord, consulte [Servidores MCP](/features/capabilities/tools-and-extensions/mcp-servers/).
