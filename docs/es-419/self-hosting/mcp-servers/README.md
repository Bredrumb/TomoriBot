---
title: "Servidores MCP"
sidebar:
  label: "Resumen"
  groupLabel: "Servidores MCP"
  order: 8
---

Configura tu instancia autoalojada de TomoriBot para admitir flujos de inicio de sesión con OAuth o ejecuta servidores locales de Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) junto a ella.

| Guía | Propósito |
|---|---|
| [Configuración de inicio de sesión MCP](/self-hosting/mcp-servers/mcp-sign-in/) | Configura `TOMORI_PUBLIC_BASE_URL` para que los administradores puedan completar el flujo OAuth en el navegador al agregar servidores MCP remotos. |
| [Servidor MCP local](/self-hosting/mcp-servers/setup-local-mcp/) | Ejecuta un servidor MCP HTTP/SSE en `localhost` o en tu red privada y regístralo en Discord. |
| [slop-guard](/self-hosting/mcp-servers/setup-slop-guard/) | Ejecuta el corrector de prosa en contenedor `slop-guard` sobre Streamable HTTP MCP para las comprobaciones de reglas de Revisión de respuestas. |

Para agregar, inspeccionar o eliminar servidores MCP en Discord, consulta [Servidores MCP](/features/capabilities/tools-and-extensions/mcp-servers/).
