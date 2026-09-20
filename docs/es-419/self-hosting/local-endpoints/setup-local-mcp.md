---
title: "Configuración: Servidor MCP local"
sidebar:
  order: 6
---

Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.

Los servidores [MCP](https://modelcontextprotocol.io/) amplían a TomoriBot con herramientas externas. Los servidores MCP en línea
(HTTPS) funcionan en cualquier instancia (consulta
[Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#mcp-servers)). Los servidores MCP **locales** son
diferentes:

:::caution[Solo para autoalojamiento]
Los servidores MCP locales **solo son compatibles en instancias autoalojadas**. El bot público alojado
requiere HTTPS y bloquea direcciones locales o privadas por seguridad, por lo que no puede comunicarse con un servidor en
`localhost` o en tu red de área local.
:::

## 1. Ejecuta un servidor MCP local

Inicia cualquier servidor MCP que exponga un transporte HTTP/SSE en un puerto local. Por ejemplo, muchos
servidores MCP se ejecutan mediante Node:

```sh
npx -y <some-mcp-server> --port 3000
```

El comando exacto depende del servidor que estés ejecutando. Toma nota de la URL y la ruta de transporte que
imprime (comúnmente algo como `http://localhost:3000/sse`).

Las herramientas propias de TomoriBot esperan que **Node.js v20+** esté disponible para las herramientas MCP en el host.

## 2. Regístralo en Discord

Abre `/config` > Complementos > Servidores MCP, elige **+ Añadir MCP**, apunta el campo **URL**
a tu servidor local, y deja el campo obligatorio **Tipo de servidor** en su valor predeterminado **Uso general**:

```text
http://localhost:3000/sse
```

Deja el campo **Token de autenticación** en blanco (no se necesita un token de autenticación para servidores locales).

## 3. Adminístralo

- Abre la página Configuración y elige **Eliminar** en la fila del servidor. Al confirmar, se anula su registro,
  se desconecta inmediatamente y se libera un espacio.

## Seguridad

:::danger[Solo añade servidores MCP en los que confíes]
Incluso un servidor local que ejecutes tú mismo puede funcionar mal si su código no es de confianza. Un servidor
MCP malicioso puede inyectar instrucciones al modelo, exfiltrar datos pasados a sus herramientas o devolver resultados
dañinos que TomoriBot retransmitirá. Revisa qué hace un servidor MCP antes de conectarlo.
:::

Para conocer el flujo de MCP en línea y la justificación de seguridad completa, consulta
[Herramientas y extensiones → Servidores MCP](/es-419/features/capabilities/tools-and-extensions/#mcp-servers).
