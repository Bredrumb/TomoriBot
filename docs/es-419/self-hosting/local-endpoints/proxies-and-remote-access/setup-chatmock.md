---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
aiGenerated: true
---

Conecta TomoriBot a un puente local de Chat Completions usando [ChatMock](https://github.com/RayBytes/ChatMock).

:::caution[Usa los proxies de cuentas CLI bajo tu propia responsabilidad]
El acceso de terceros mediante una cuenta CLI puede infringir los términos del proveedor y poner en riesgo de suspensión la cuenta. Una suscripción no otorga permiso para el uso con bots o API. Revisa la [guía de riesgo de cuenta](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk) antes de iniciar sesión; TomoriBot no ofrece ninguna garantía de seguridad de cuenta.
:::

## 1. Iniciar ChatMock

1. Instala ChatMock siguiendo las [instrucciones de su repositorio](https://github.com/RayBytes/ChatMock).
2. Si tu cuenta y método de acceso permiten este uso, autentícate e inicia el servidor:

```sh
chatmock login
chatmock serve
```

3. Confirma que la API local sea accesible en `http://127.0.0.1:8000/v1`.

## 2. Configurar TomoriBot

1. Ejecuta `/providers` o `/personal providers` y agrega un punto de conexión personalizado `Compatible con OpenAI`.
2. Ingresa los ajustes de conexión:

| Campo | Valor |
|---|---|
| URL del punto de conexión | `http://127.0.0.1:8000/v1` cuando el bot se ejecuta en esta máquina fuera de producción |
| Token de autenticación | La clave de cliente del puente si la autenticación está activada |

3. Selecciona el punto de conexión guardado y agrega un `Modelo de texto` con el ID exacto de API que expone ChatMock. Registra más IDs bajo la misma conexión para cambiar de modelo.

- Un `http://127.0.0.1:8000` simple se normaliza a `/v1`; no agregues `/chat/completions`.
- Permite `127.0.0.1:8000` en el ajuste de desarrollo `ALLOW_PRIVATE_NETWORK` de TomoriBot. La dirección de bucle invertido de Docker se refiere al contenedor.
- Activa las herramientas, imágenes o salida estructurada solo después de probar el puente y el modelo seleccionado. Mantén el video desactivado.
- Para un bot de producción alojado por separado, sigue la guía de [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). Producción requiere HTTPS público. La detección directa de prompts de ChatMock basada en bucle invertido y puerto no se aplica al nombre de host público del relé, así que valida el comportamiento de las instrucciones del sistema por separado.

:::note[Manejo del prompt del sistema y configuración del puerto]
TomoriBot detecta un punto de conexión de bucle invertido en `CHATMOCK_PORT` (predeterminado `8000`) y convierte las instrucciones del sistema en un turno inicial de usuario para compatibilidad con ChatMock. Configura `CHATMOCK_PORT` para que coincida con otro puerto local de ChatMock.
:::
