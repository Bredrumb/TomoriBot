---
title: "Configuración de inicio de sesión MCP"
description: "Permite que tu instancia autoalojada de TomoriBot agregue servidores MCP que solicitan iniciar sesión en una cuenta."
sidebar:
  order: 1
---

Algunos servidores MCP piden a los administradores iniciar sesión en una cuenta en lugar de pegar un token. Un bot autoalojado ofrece ese inicio de sesión solo cuando `TOMORI_PUBLIC_BASE_URL` está configurado. Sin él, únicamente funcionan los servidores MCP que aceptan un token en `Token de autenticación`.

Si usas el [bot público desplegado](https://discord.com/oauth2/authorize?client_id=841644102059556915), no necesitas esta página; consulta [Servidores MCP](/features/capabilities/tools-and-extensions/mcp-servers/).

## Elige una URL base

Configura `TOMORI_PUBLIC_BASE_URL` en `.env` con una dirección sin ruta y luego reinicia el bot:

| Valor | Úsalo cuando |
|---|---|
| `http://127.0.0.1:8080` o `http://localhost:8080` | El inicio de sesión termina en un navegador en la propia máquina del bot. No se necesita ningún dominio ni túnel. |
| `https://<your-host>` | Los administradores inician sesión desde sus propias computadoras. Necesitas una dirección HTTPS pública que reenvíe al bot. |

Configurar la variable inicia el servidor HTTP del bot en `PORT` (predeterminado `8080`), y ese servidor escucha en todas las interfaces de red. Un inicio de sesión en curso vive en memoria, por lo que reiniciar el bot durante uno implica volver a iniciarlo desde Discord.

## Dirección de bucle invertido

- Usa el puerto definido en `PORT`. El bot registra una advertencia al iniciar cuando ambos difieren.
- Termina el inicio de sesión en un navegador en la máquina del bot. Desde otra computadora, reenvía el puerto por SSH primero y luego elige `Iniciar sesión` en el navegador de esa computadora:

  ```sh
  ssh -L 8080:127.0.0.1:8080 "<user>@<bot-host>"
  ```

- Cada servicio decide si acepta una dirección de bucle invertido. Si alguno la rechaza, usa una dirección HTTPS o un token en su lugar.

## Dirección HTTPS

Reenvía estas rutas desde tu dirección pública al `PORT` del bot:

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

Los servicios identifican a tu bot mediante `https://<your-host>/oauth/client.json`, así que elige el nombre de host antes del primer inicio de sesión y consérvalo.

## Docker Compose

Compose no publica el puerto del bot. Crea `docker-compose.override.yaml` junto a `docker-compose.yaml`:

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

Mantén el prefijo `127.0.0.1:`, ya que sin él cualquier computadora en tu red puede alcanzar el servidor HTTP del bot. Un proxy inverso o túnel que se ejecute en la misma máquina aún puede reenviar a este puerto.
