---
title: "Asistente de configuración"
aiGenerated: false
sidebar:
  label: "Asistente de configuración"
  order: 1
---

:::note
Los usuarios que quieran usar Docker Compose deben omitir este asistente; consulta
[Docker Compose](/self-hosting/docker-compose/) para la ruta de instalación en contenedores.
:::

`bun run setup` es la ruta de autoalojamiento recomendada para instalaciones locales basadas en Bun. El comando instala las dependencias desde `bun.lock` antes de cargar el asistente, incluso en una clonación limpia. El asistente crea tu `.env`, genera un `CRYPTO_SECRET`, solicita el token de tu bot de Discord y configura PostgreSQL. Es seguro volver a ejecutarlo; los valores existentes de `.env` se conservan a menos que elijas reconfigurarlos.

## Qué tener listo

- **[Bun](https://bun.sh/)** para ejecutar el bot y el propio asistente.
- **Un token de bot de Discord** con los intents privilegiados `GuildMembers`, `MessageContent` y `GuildPresences` habilitados.
- **PostgreSQL instalado.** TomoriBot almacena todo en PostgreSQL. No necesitas configurarlo a mano, ya que el asistente lo hace por ti: utilizará PostgreSQL si ya lo tienes instalado, o ejecutará uno por ti en [Docker](https://www.docker.com/) si no lo tienes. Solo asegúrate de tener alguno de los dos instalado antes de comenzar. TomoriBot inicializa su esquema, semillas, migraciones, `pgcrypto` y el esquema de RAG automáticamente en el primer inicio.

## Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Ejecuta el asistente

Ejecuta el asistente de configuración con:

```bash
bun run setup
```

Una vez que ejecutes el comando, elegirás una de dos rutas:

| Ruta | Úsala cuando | Qué hace |
|---|---|---|
| Instalación completa | Deseas la configuración recomendada con extras ligeros. | Ejecuta la instalación base y luego intenta los extras indicados abajo. |
| Instalación base | Solo deseas el bot funcional mínimo. | Crea y configura `.env`, el token de Discord, PostgreSQL y las dependencias. |

### Extras de la instalación completa

La instalación completa ejecuta primero la instalación base y luego intenta instalar los extras indicados abajo. Si alguno falla, muestra el comando o la guía para completarlo manualmente y continúa:

| Extra | Propósito |
|---|---|
| `pgvector` | Búsqueda vectorial para la memoria de documentos/RAG. |
| `pg_cron` | Limpieza programada opcional de filas de enfriamiento y recordatorios. |
| Recursos del tokenizador | Recursos de tokenizador locales para el sesgo de logit según el modelo. |

Para instalar cualquiera de estos manualmente, consulta los [extras de la instalación manual](/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Después de la configuración

```bash
bun run dev                          # solo el bot
bun run launch --searxng --crawl4ai  # bot + servidores locales (consulta bun run launch --help)
```

Cuando el bot esté en línea, ejecuta `/setup` en Discord. Te guiará para conectar un proveedor de IA o tu punto final personalizado.

## Actualización

Usa el comando de actualización con copia de seguridad previa: `bun run update`

Esto ejecuta `bun run backup`, luego `git pull --rebase --autostash` y finalmente `bun install --frozen-lockfile`. Agrega `--build` si ejecutas desde `dist/`, o `--docker` para una implementación con Compose. Detalles completos en la página de [Mantenimiento y copias de seguridad](/self-hosting/maintenance/).
