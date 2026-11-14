---
title: "Proxies y acceso remoto"
sidebar:
  label: "Resumen"
  groupLabel: "Proxies y acceso remoto"
  order: 8
---

Conecta TomoriBot mediante un proxy de API local o accede de forma segura a un motor que se ejecuta en otra computadora.

## Elige una guía

1. [ChatMock](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/): conecta un puente respaldado por ChatGPT en tu máquina.
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/): instala un proxy y registra modelos desde un backend autorizado.
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/): asigna a un motor local una URL HTTPS para un bot alojado por separado.
4. [Opcional: Access y Caddy](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-access-and-caddy/): agrega una comprobación de autenticación independiente y un enrutamiento de API más estricto.

Empieza por la guía del proxy si necesitas uno. Sigue la guía de Cloudflare solo cuando el bot se ejecute en otra máquina.

## Riesgo de cuenta
<!-- anchor: account-risk -->

:::danger[Usa los proxies de cuentas CLI bajo tu propia responsabilidad]
Usar Codex, Claude Code, Antigravity u otra cuenta CLI a través de un puente de terceros puede infringir los términos del proveedor y provocar la suspensión o cancelación de la cuenta. Una suscripción de pago o un inicio de sesión exitoso no otorga permiso para el uso con bots ni para uso general de API. Revisa las reglas de tu proveedor, plan y método de autenticación. TomoriBot no ofrece ninguna garantía de seguridad de cuenta.
:::

Las reglas varían según el proveedor:

- Los [términos de OpenAI](https://openai.com/policies/terms-of-use/) se aplican al uso de cuentas individuales, con términos separados para servicios empresariales y de API. Revisa los términos que aplican a tu cuenta de Codex y al método de acceso del puente.
- La [política de autenticación de Anthropic](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) restringe el uso de OAuth de suscripción y el enrutamiento de terceros en nombre de usuarios. Dirige a quienes desarrollan servicios hacia claves de API o proveedores en la nube compatibles.
- Los [términos de Antigravity de Google](https://antigravity.google/terms) prohíben explícitamente el acceso de terceros, como los puentes OAuth de Antigravity, y permiten la suspensión o cancelación. Esta guía no recomienda ese método de acceso.

Usa únicamente backends que estés autorizado a utilizar. Para integraciones compatibles con el proveedor, usa el proveedor integrado de TomoriBot cuando esté disponible, como Google con una [clave de API de Gemini](https://ai.google.dev/gemini-api/docs/api-key), o un punto de conexión de API autorizado. CLIProxyAPI, la CLI o aplicación original y el servicio de modelos ascendente son productos separados.
