---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose compila y ejecuta TomoriBot **junto con** PostgreSQL como contenedores. Es la
tercera ruta de instalación junto al [asistente de instalación](/es-419/self-hosting/setup-wizard/) y la
[instalación manual](/es-419/self-hosting/manual-setup/): elígela cuando prefieras ejecutar todo en Docker en
lugar de instalar Bun y PostgreSQL en el host. **No** usa el asistente de instalación; la conexión a la
base de datos se configura automáticamente por ti.

:::caution[Los scripts del lado del host aún necesitan herramientas del host]
Ejecutar el bot y la base de datos en Docker no pone en contenedores los scripts de mantenimiento.
`bun run backup`, `bun run restore-backup`, `bun run update`, `bun run rotate-keys` y similares
siguen ejecutándose mediante Bun del host y las herramientas de cliente de PostgreSQL del host. Consulta
[Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/) para los procedimientos específicos de Compose.
:::

## 1. Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores requeridos de `.env`

Comienza desde el archivo de ejemplo:

```sh
cp .env.example .env
```

Luego establece como mínimo:

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | El token de tu bot de Discord (habilita los intents privilegiados `GuildMembers`, `MessageContent` y `GuildPresences`). |
| `CRYPTO_SECRET` | Una clave de cifrado de 32 caracteres usada para cifrar las claves de API almacenadas. |
| `POSTGRES_PASSWORD` | La contraseña de la base de datos. Cualquier otro valor `POSTGRES_*` se configura automáticamente. |

A diferencia del asistente de instalación, Compose no generará `CRYPTO_SECRET` por ti: establécelo tú
mismo (cualquier cadena de 32 caracteres). Los valores de ajuste opcionales se pueden copiar de
`.env.optional.example`.

:::note[La conexión a la base de datos es automática]
El servicio de PostgreSQL de Compose se ejecuta en modo de desarrollo (sin SSL) en la red interna de
Docker, y la imagen incluida ya tiene `pgvector` y `pg_cron` configurados, así que la memoria de
documentos/RAG y la limpieza programada funcionan desde el primer momento. No establezcas
`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` ni `POSTGRES_DB` para Compose; se gestionan por ti.
:::

## 3. Compila y ejecuta

```sh
docker compose build   # la primera vez, o después de cambios en el código/dependencias
docker compose up      # bot + base de datos
```

Para inicios posteriores, `docker compose up` solo es suficiente a menos que hayas cambiado el código o
las dependencias. Cuando el bot esté en línea, ejecuta `/setup` en Discord para agregar la clave de tu
proveedor de IA; consulta la [Guía rápida](/es-419/introduction/quickstart/) para el lado dentro de Discord.

## 4. Servidores locales opcionales (perfiles de Compose)

Los servidores locales son opcionales mediante perfiles de Compose, así que solo ejecutas lo que necesitas:

```sh
# SearXNG (búsqueda web privada) + Crawl4AI (obtención renderizada por navegador)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Consulta [SearXNG](/es-419/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/es-419/self-hosting/local-endpoints/setup-crawl4ai/),
y [Monitoreo local](/es-419/self-hosting/local-monitoring/) para los detalles de cada servidor.

## Mantenimiento, actualización y copias de seguridad

Usa `bun run update --docker` para el procedimiento de actualización con copia de seguridad primero en
una implementación con Compose. Hacer copias de seguridad y restaurar la base de datos de Compose
(incluyendo ejecutar scripts del host contra ella) se cubre en la página de
[Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/). Antes de descargar una nueva
versión, comienza con [Migración segura](/es-419/self-hosting/safe-migration/).
