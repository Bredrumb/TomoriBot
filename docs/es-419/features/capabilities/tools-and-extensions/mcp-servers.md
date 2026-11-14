---
title: "Servidores MCP"
sidebar:
  order: 3
---

Los servidores [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) amplían a TomoriBot con herramientas externas que registras tú mismo.

### Agregar un MCP en línea

Usa el punto de conexión HTTPS directo de un proveedor compatible con MCP Streamable HTTP o SSE:

Agrega el punto de conexión y cualquier autenticación requerida en `/config` > `Plugins` > `Servidores MCP`.
Elige `Corrector de prosa` para un verificador de reglas de Revisión de respuestas; sus herramientas no se llaman durante el chat.

Los tokens de autenticación se cifran en reposo. Desactivar un servidor usado para búsqueda o lectura de URLs restaura la herramienta integrada. Una lista de herramientas guardada refleja el último descubrimiento exitoso y no garantiza que el servidor sea accesible actualmente.

Las respuestas de las herramientas están limitadas a 8 MiB, incluido todo el flujo para conexiones SSE. Pide al proveedor paginación o resultados más pequeños si una herramienta supera el límite.

### Agregar un MCP que requiere inicio de sesión

Algunos servicios, como Linear y Notion, te piden iniciar sesión en tu cuenta en lugar de darte un token. Agrega el MCP dejando `Token de autenticación` en blanco. Cuando el servidor solicita un inicio de sesión, el panel muestra un botón `Iniciar sesión`:

1. Elige `Iniciar sesión` e inicia sesión en el servicio dentro de 10 minutos.
2. La página de confirmación indica tu servidor de Discord y la dirección del MCP. Elige `Conectar` solo si ambos son correctos y tú iniciaste este acceso.
3. El panel se actualiza en Discord una vez que el MCP se agrega.

Cada miembro que usa las herramientas del MCP actúa como la cuenta que inició sesión, así que usa una cuenta cuyos datos todo el servidor pueda ver.

Cuando un inicio de sesión vence o el servicio solicita más acceso, las herramientas de ese MCP se pausan y su fila muestra `Reconectar`. Elígelo e inicia sesión de nuevo; el MCP conserva su nombre, tipo y espacio.

El inicio de sesión solo funciona al agregar un MCP en un servidor, no en un mensaje directo. En un bot autoalojado, el anfitrión lo configura primero; consulta [Configuración de inicio de sesión MCP](/self-hosting/mcp-servers/mcp-sign-in/).

### Servidores MCP locales

Los servidores MCP locales solo se admiten en instancias autoalojadas, ya que el bot alojado públicamente exige HTTPS y bloquea direcciones locales y privadas. Si ejecutas tu propia instancia, consulta [Configuración: Servidor MCP local](/self-hosting/mcp-servers/setup-local-mcp/).

:::danger[Solo agrega servidores MCP en los que confíes]
Un servidor MCP malicioso puede hacerle inyección de prompts con instrucciones ocultas, exfiltrar datos que los usuarios pasen a sus herramientas o devolver resultados dañinos o falsos que ella transmitirá a tu servidor. Trata los servidores MCP como extensiones de navegador: si tienes dudas, no lo agregues. Revisa siempre las herramientas descritas de un MCP antes de agregarlo.
:::
