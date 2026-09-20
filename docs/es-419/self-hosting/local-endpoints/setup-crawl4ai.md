---
title: "Configuración: Crawl4AI (Sidecar)"
sidebar:
  order: 4
---
# Configuración: Crawl4AI Sidecar

La herramienta `fetch_url` utiliza el motor `safe_http` en el proceso por defecto. Opcionalmente, puede intentar usar un sidecar de renderizado de navegador en entornos de desarrollo de confianza cuando necesites contenido renderizado para páginas con mucho JavaScript.

El orden predeterminado de los motores es `safe_http`. Debido a que Crawl4AI sigue redirecciones fuera del cliente HTTP protegido de TomoriBot, solo se admite donde se permite la recuperación desde redes privadas. Fuera de producción esto es automático (no requiere configuración). En producción requiere una habilitación explícita con `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`, lo cual no se recomienda.

Crawl4AI es un sidecar de markdown renderizado por el navegador. Ejecuta un navegador sin interfaz gráfica basado en Playwright y extrae markdown optimizado para LLM en el lado del servidor utilizando sus propios filtros de contenido (no es necesario un posprocesamiento por parte de TomoriBot).

Elige una ruta de configuración de Crawl4AI:

### A. Docker Compose (cuando TomoriBot se ejecuta en Docker)

Usa esta ruta si ejecutas TomoriBot con la pila de Docker Compose del repositorio. Primero, establece `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` y `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` en `.env`. Fuera de producción no se necesita habilitar redes privadas; solo agrega `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` si ejecutas esta pila con `RUN_ENV=production`.

Luego, inicia con:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Esto inicia la pila de Compose con el sidecar de Crawl4AI en la red de Docker de TomoriBot.

Si ejecutas TomoriBot directamente con `bun run dev`, usa la ruta independiente a continuación.

Si también quieres el sidecar de SearXNG, encadena los perfiles:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Si habilitas la autenticación por token de API de Crawl4AI, establece `CRAWL4AI_TOKEN` en `.env`; Compose se lo pasa al contenedor como `CRAWL4AI_API_TOKEN`, y TomoriBot lo envía como un token portador (bearer token).

---

### B. Docker Independiente (cuando se ejecuta `bun run dev`)

Primero, establece `CRAWL4AI_BASE_URL=http://localhost:11235/` y `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` en `.env` para que el bot se conecte al puerto del contenedor publicado en el host. Fuera de producción no se necesita habilitar redes privadas; solo agrega `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` si lo ejecutas con `RUN_ENV=production`.

Luego, en lugar de ejecutar TomoriBot directamente con `bun run dev`, usa `bun run launch --crawl4ai`. Esto maneja el ciclo de vida del contenedor automáticamente y espera a que el sidecar esté en buen estado antes de iniciar el bot:

```sh
bun run launch --crawl4ai
```

Si también quieres el sidecar de SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Si prefieres administrar el contenedor tú mismo, mantén `CRAWL4AI_BASE_URL=http://localhost:11235/` en `.env` y ejecuta:

**PowerShell:**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash (Linux/macOS):**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

Si proteges el sidecar, pasa `-e CRAWL4AI_API_TOKEN=your_token` a `docker run` y establece `CRAWL4AI_TOKEN=your_token` en `.env`.

Luego ejecuta `bun run dev` una vez que el contenedor esté en buen estado (`docker ps` muestra `(healthy)`).

---

### C. Sin Sidecar de Navegador

Deja `CRAWL4AI_BASE_URL` sin establecer. La herramienta `fetch_url` utiliza el motor protegido `safe_http`.

---

## Orden de Inicio (Importante)

TomoriBot sondea el estado del sidecar en la **primera llamada a `fetch_url` después del inicio** y almacena el resultado en caché durante 60 segundos. Si el contenedor no está listo cuando se realiza ese primer sondeo, el bot lo considera no disponible durante el siguiente minuto.

Para Docker independiente, inicia tu contenedor del sidecar antes de iniciar TomoriBot. `bun run launch --crawl4ai` ya hace esto por ti.

### Configuración por primera vez

1. Inicia el contenedor y espera hasta que muestre `(healthy)` en `docker ps`:
   ```powershell
   docker ps
   ```
2. Establece `CRAWL4AI_BASE_URL` en `.env` usando el valor para tu ruta de configuración anterior.
3. Inicia TomoriBot (`bun run dev` o `docker compose up`).

### Regresando después de un reinicio

Si el contenedor ya existe de una ejecución anterior, usa `docker start` en lugar de `docker run` para evitar un conflicto de nombres:

```powershell
# Iniciar un contenedor existente
docker start crawl4ai

# Confirmar estado saludable antes de iniciar TomoriBot
docker ps
```

Luego inicia TomoriBot como de costumbre. Reiniciar `bun run dev` restablece la caché de salud en memoria, por lo que mientras el contenedor esté listo primero, el motor correcto se seleccionará de inmediato.

---

## Inyección de Cookies (Recuperaciones Autenticadas opcionales)

Crawl4AI admite la inyección de cookies a nivel de navegador para que el navegador sin interfaz gráfica aparezca ya conectado al recuperar una página. Esto es útil para los sitios que requieren una sesión para ver contenido (por ejemplo, noticias de pago, foros privados o paneles con inicio de sesión).

El motor de reserva `safe_http` **no** admite la inyección de cookies; las cookies solo se aplican cuando Crawl4AI está activo.

> **Limitación:** La inyección de cookies elude los muros de inicio de sesión, pero no la huella digital para bots. Los sitios con detección agresiva contra bots (notablemente Twitter/X) detectan el Playwright sin interfaz gráfica a través de la huella digital de canvas/WebGL y ofrecen páginas vacías incluso con cookies de sesión válidas. La inyección de cookies funciona bien para los sitios que bloquean únicamente por autenticación.

### Obteniendo tus cookies

1. Abre tu navegador e inicia sesión en el sitio objetivo.
2. Abre las herramientas para desarrolladores (`F12`) → Pestaña **Application** → **Storage** → **Cookies** → selecciona el dominio del sitio.
3. Copia el valor de `Value` de cada cookie requerida (típicamente un token de sesión; verifica los nombres de las cookies del sitio).

### Crawl4AI

Establece `CRAWL4AI_COOKIES_JSON` en `.env` como un arreglo JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Cuando esto está configurado, `fetch_url` cambia automáticamente del punto de conexión `/md` a `/crawl` con `browser_config.cookies` (el punto `/md` no admite inyección de cookies).

### Campos del objeto de cookie

| Campo | Requerido | Descripción |
|---|---|---|
| `name` | Sí | Nombre de la cookie |
| `value` | Sí | Valor de la cookie |
| `domain` | No | Alcance del dominio (por ejemplo, `.x.com`). Recomendado para mayor exactitud. |
| `path` | No | Alcance de la ruta. Por defecto es `/` si se omite. |

> **Nota:** Los valores de las cookies son confidenciales; trátalos como contraseñas. Otorgan acceso completo a la sesión de tu cuenta. No confirmes `.env` en el control de versiones.

---

## Orden de Motores y Variables de Entorno

| Variable | Predeterminado | Descripción |
|---|---|---|
| `CRAWL4AI_BASE_URL` | Sin establecer | Habilita Crawl4AI cuando está configurado. Usa `http://crawl4ai:11235/` desde Docker Compose, o `http://localhost:11235/` cuando TomoriBot se ejecuta directamente en tu máquina. |
| `CRAWL4AI_TOKEN` | Sin establecer | Token portador opcional. Debe coincidir con `CRAWL4AI_API_TOKEN` en el contenedor de Crawl4AI cuando está habilitado. |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | Lista de motores separados por comas. `safe_http` siempre se agrega como la reserva final; el nombre heredado `mcp_fetch` sirve como alias. Las entradas de Crawl4AI se ignoran donde no se permite la recuperación desde redes privadas (producción sin habilitación explícita). |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Tiempo de espera por solicitud de motor para Crawl4AI y los sidecars de recuperación de URL. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Caracteres máximos devueltos por una llamada de recuperación antes de que se requiera una continuación. |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | Cuánto tiempo se almacena en caché el resultado del sondeo de salud de Crawl4AI antes de volver a verificarlo. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Habilitación explícita solo para producción. Fuera de producción (`RUN_ENV` != `production`), la protección SSRF se relaja automáticamente, por lo que las recuperaciones de localhost, redes privadas o internas y el envío a Crawl4AI funcionan sin configuración. Establece `true` solo para permitir recuperaciones en redes privadas en una implementación de producción de confianza. |
| `FETCH_URL_FILTER_MODE` | `fit` | Modo de filtro `/md` de Crawl4AI. `fit` mantiene el markdown más limpio para el uso del modelo; `fetch_url(..., raw=true)` lo anula por solicitud. |
