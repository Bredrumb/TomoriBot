---
title: "Configuración: SearXNG (Sidecar)"
sidebar:
  order: 3
---

Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.

La herramienta `web_search` enruta a través de una cadena de motores de búsqueda: **Brave → SearXNG → DuckDuckGo → IAsk**. Al ejecutar nuestra propia instancia de SearXNG, evitamos los límites de velocidad de un solo motor y los fallos de extracción, y desbloqueamos categorías exclusivas de SearXNG: `science`, `it`, `files` y `music`.

Elige una ruta de configuración de SearXNG:

### A. Docker Compose (cuando TomoriBot se ejecuta en Docker)

Usa esta ruta si ejecutas TomoriBot con la pila de Docker Compose del repositorio. Luego, ejecuta con el perfil `searxng`:

```sh
docker compose --profile searxng up -d
```
Esto inicia el servicio `searxng` junto a TomoriBot (el bot lo alcanza en `http://searxng:8080/` automáticamente).

Si ejecutas TomoriBot directamente con `bun run dev`, usa la ruta independiente a continuación en su lugar.

Si usas producción, establece `SEARXNG_SECRET` en `.env` a cualquier cadena de más de 32 caracteres (tiene un valor predeterminado automático en desarrollo).

---

### B. Docker independiente (al ejecutar `bun run dev`)
Primero, establece `SEARXNG_BASE_URL=http://localhost:8080/` en `.env` para que el bot sepa dónde conectarse.

Luego, en lugar de ejecutar TomoriBot directamente con `bun run dev`, usa `bun run launch --searxng`. Esto maneja el ciclo de vida del contenedor automáticamente y espera a que el contenedor esté en buen estado antes de iniciar el bot:

```sh
bun run launch --searxng
```

Si prefieres administrar el contenedor tú mismo, mantén `SEARXNG_BASE_URL=http://localhost:8080/` en `.env` y ejecuta:

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:rw" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  -v "${PWD}/servers/searxng:/etc/searxng:rw" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng:latest
```

Luego ejecuta `bun run dev` una vez que el contenedor esté en buen estado (`docker ps` muestra `(healthy)`).

---

### C. Sin SearXNG
Deja `SEARXNG_BASE_URL` sin establecer. La cadena recurre a `Brave → DuckDuckGo → IAsk`.

Cuando no se configura ningún sidecar de SearXNG, el esquema de `web_search` ensamblado ya no anuncia categorías exclusivas de SearXNG. Las categorías comunes (`text`, `image`, `video`, `news`) aún aparecen cuando Brave está configurado, y la búsqueda solo de texto aparece cuando solo está disponible la alternativa de MCP de DuckDuckGo/IAsk.

---

## Ajuste de resultados de imágenes

Los resultados de imágenes de SearXNG son validados por HEAD, comprimidos opcionalmente y publicados como archivos adjuntos de Discord (UX idéntica a las imágenes de Brave). Si todas las URL candidatas fallan la validación, SearXNG devuelve un listado de texto de enlaces de imágenes en lugar de un fallo total.

| Variable | Predeterminado | Descripción |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (máx. 10) | Cuántas imágenes válidas se envían a Discord. Anulado por el argumento `count` del LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Grupo de URL candidatas cuando el LLM no especifica `count`. Cuando se especifica `count`, el grupo es `count × 3` (con un tope de 30) para absorber los fallos de protección contra hotlinks. |
| `WEB_SEARCH_TIMEOUT_MS` | Ninguno | Tiempo de espera de la solicitud por motor. |

*(Consulta `.env.optional.example` para todos los ajustes configurables).*
