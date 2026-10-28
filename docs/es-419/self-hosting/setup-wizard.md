---
title: "Asistente de instalación"
sidebar:
  label: "Asistente de instalación"
  order: 1
aiGenerated: false
---

:::note
Los usuarios que quieran usar Docker Compose deben omitir este asistente; consulta
[Docker Compose](/es-419/self-hosting/docker-compose/) para la ruta de instalación en contenedores.
:::

`bun run setup` es la ruta de autoalojamiento recomendada para instalaciones locales basadas en Bun. Crea tu `.env`, genera un `CRYPTO_SECRET`, te pide el token de tu bot de Discord, configura PostgreSQL e instala las dependencias exactas de `bun.lock` de forma interactiva, así que solo sigue las indicaciones. Es seguro
volver a ejecutarlo; los valores existentes de `.env` se conservan a menos que elijas reconfigurarlos.

## Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Elige una ruta

Una vez que ejecutes el comando, elegirás una de dos rutas:

```bash
bun run setup
```


| Ruta | Úsala cuando | Qué hace |
|---|---|---|
| Instalación completa | Quieres la configuración recomendada con extras livianos. | Ejecuta la instalación base y luego intenta los cuatro extras siguientes. |
| Instalación base | Solo quieres el bot mínimo funcional. | Crea/configura `.env`, el token de Discord, PostgreSQL y las dependencias. |



## Qué tener listo

- [Bun](https://bun.sh/) para ejecutar el bot y el propio asistente.
- Un token de bot de Discord con los intents privilegiados `GuildMembers`, `MessageContent` y
  `GuildPresences` habilitados.
- Una base de datos. TomoriBot almacena todo en PostgreSQL. No necesitas configurarla a mano, ya
  que el asistente lo hace por ti: usará PostgreSQL si ya lo tienes instalado, o ejecutará uno por ti
  en [Docker](https://www.docker.com/) si no lo tienes. Solo asegúrate de tener alguno de los dos
  instalado antes de empezar.

:::caution
- El PostgreSQL de Docker incluido solo ejecuta la base de datos en Docker. El bot en sí, las
  copias de seguridad de inicio, `bun run backup` y `restore-backup` siguen ejecutándose mediante Bun
  y las herramientas de cliente de PostgreSQL del host. Si prefieres ejecutar todo en Docker, usa
  [Docker Compose](/es-419/self-hosting/docker-compose/) en su lugar.
:::

Si `psql` falta o el aprovisionamiento falla, el asistente imprime el SQL para ejecutar a mano. De
cualquier forma, TomoriBot inicializa su esquema, semillas, migraciones, `pgcrypto` y el esquema de RAG
automáticamente en el primer arranque.

## Extras de la instalación completa

La instalación completa ejecuta primero la instalación base y luego intenta instalar los extras de
abajo. Si alguno falla, imprime el comando o la guía para terminarlo a mano y continúa:

| Extra | Propósito |
|---|---|
| `pgvector` | Búsqueda vectorial para la memoria de documentos/RAG. |
| `pg_cron` | Limpieza opcional programada de filas de enfriamiento/recordatorio. |
| Recursos del tokenizador | Recursos de tokenizador locales para el sesgo de logit según el modelo. |

Para instalar cualquiera de estos a mano, consulta los
[extras de la instalación manual](/es-419/self-hosting/manual-setup/#extras-opcionales-la-instalación-completa-manual).

## Después de la instalación

```bash
bun run dev                          # solo el bot
bun run launch --searxng --crawl4ai  # bot + servidores locales (ver bun run launch --help)
```

Cuando el bot esté en línea, ejecuta `/setup` en Discord. Te guiará para conectar un proveedor de IA;
consulta la [Guía rápida](/introduction/quickstart/) para ver lo que solicita cada paso.

## Actualización

Usa el comando de actualización con copia de seguridad primero: `bun run update`

Esto ejecuta `bun run backup`, luego
`git pull --rebase --autostash`, luego `bun install --frozen-lockfile`. Agrega `--build` si ejecutas
desde `dist/`, o `--docker` para una implementación con Compose. Los detalles completos están en la
página de [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
