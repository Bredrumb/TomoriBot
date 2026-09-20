---
title: "Configuración: Codex CLI a través de ChatMock"
sidebar:
  order: 5
---

:::note
Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.
:::

Si quieres que TomoriBot use tu cuenta de ChatGPT a través de un puente local compatible con OpenAI, puedes ejecutar [ChatMock](https://github.com/RayBytes/ChatMock) y apuntar el proveedor `custom` de TomoriBot hacia él.

## Qué hace ChatMock

- ChatMock ejecuta un servidor local de API compatible con OpenAI
- TomoriBot puede usar ese servidor local a través del proveedor `custom`

## 1. Iniciar ChatMock

Instala e inicia ChatMock siguiendo sus instrucciones en GitHub:

- [Repositorio de ChatMock](https://github.com/RayBytes/ChatMock)

Después de instalar, ejecuta:
```sh
chatmock login
chatmock serve
```

Por defecto, ChatMock escucha en `http://127.0.0.1:8000/v1`

## 2. Configurar TomoriBot para usar ChatMock

En Discord, configura el proveedor `custom` de TomoriBot y usa:

- **Endpoint URL**: `http://127.0.0.1:8000/v1`
- **Model Name**: la cadena exacta del modelo que ChatMock debe recibir, como `gpt-5.4` o `gpt-5.3-codex`

Un simple `http://127.0.0.1:8000` también funciona: TomoriBot lo normaliza a `/v1` antes de agregar `/chat/completions`.

Habilita estas banderas de capacidad para ChatMock:
- **Function Calling / Tools**: Sí
- **Image Understanding**: Sí
- **Video Understanding**: No
- **Structured Output**: Sí

**Nota**: Codex CLI no permite cambiar su prompt `system`, por lo que el prompt `system` de TomoriBot se convierte en un turno de `user` en el contexto como solución alternativa. Por favor configura la variable de entorno .env `CHATMOCK_PORT` para que coincida con tu puerto real de ChatMock y que esta solución alternativa funcione correctamente (el valor predeterminado es 8000).
