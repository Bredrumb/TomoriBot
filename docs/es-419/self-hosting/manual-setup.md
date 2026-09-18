---
title: "Instalación manual"
aiGenerated: true
sidebar:
  order: 2
---

:::note
Los usuarios que quieran usar Docker Compose deben omitir este asistente; consulta
[Docker Compose](/es-419/self-hosting/docker-compose/) para la ruta de instalación en contenedores.
:::

Este es el procedimiento de instalación manual para usuarios técnicos que prefieren no usar el
asistente guiado. Si quieres la ruta asistida, usa en su lugar el
[asistente de instalación](/es-419/self-hosting/setup-wizard/), ya que crea `.env`, genera un `CRYPTO_SECRET`
seguro, configura PostgreSQL y ejecuta la instalación por ti.

## Requisitos previos

- [Bun](https://bun.sh/)
- Node.js v20+ (usado para las herramientas de MCP)
- PostgreSQL instalado de forma nativa, o ejecutado en un contenedor de Docker (consulta el paso 2)

El esquema de PostgreSQL, `pgcrypto`, las semillas y las migraciones se inicializan automáticamente al
arrancar el bot.

## 1. Instala

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. Configura

Crea tu archivo de entorno a partir del ejemplo y completa los valores requeridos:

```sh
cp .env.example .env
```

Requeridos:

- `DISCORD_TOKEN`: el token de tu bot de Discord (habilita los intents privilegiados `GuildMembers`,
  `MessageContent` y `GuildPresences`).
- `CRYPTO_SECRET`: una clave de cifrado de 32 caracteres (usada para cifrar las claves de API
  almacenadas).
- Conexión a PostgreSQL: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, `POSTGRES_DB`.

:::note[¿No tienes PostgreSQL nativo?]
Ejecuta solo la base de datos en un contenedor y luego apunta los valores `POSTGRES_*` a ella:

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

Luego establece `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432`, y el usuario/contraseña/base de datos
de arriba. La imagen `pgvector/pgvector` incluye la extensión de RAG preinstalada; cámbiala por
`postgres:16` si no necesitas memoria de documentos/RAG. Esto solo ejecuta la base de datos en Docker y
el bot sigue ejecutándose en el Bun del host. Para un bot y una base de datos completamente en
contenedores, usa [Docker Compose](/es-419/self-hosting/docker-compose/) en su lugar.
:::

El ajuste opcional vive en `.env.optional.example`. Copia los valores que quieras personalizar (límites,
tiempos de espera, interruptores de funciones, URLs de sidecars, etc.).

## 3. Ejecuta

```sh
bun run dev
```

Cuando veas `TomoriBot up and running!`, ve a Discord y ejecuta `/setup` en tu servidor para conectar un
proveedor de IA e inicializar el bot. El comando abre un panel de lista de verificación guiada, y no se
escribe nada hasta que presiones **Finalizar configuración**; consulta
[El comando `/setup`](/es-419/self-hosting/setup-wizard/#el-comando-setup) para los pasos y la
[Guía rápida](/es-419/introduction/quickstart/) para el lado dentro de Discord.

Usa `bun run launch` en lugar de `bun run dev` si quieres que los sidecars opcionales (SearXNG, Crawl4AI,
TTS/STT local) se inicien junto al bot:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # ver todos los indicadores
```

## Extras opcionales (la "instalación completa" manual)

La ruta **Instalación completa** del [asistente de instalación](/es-419/self-hosting/setup-wizard/) agrega
cuatro extras livianos encima de la instalación base. Ninguno es necesario para ejecutar el bot, pero
cada uno desbloquea una función. Si estás instalando a mano, agrega el que quieras:

### `pgvector` : memoria de documentos/RAG

RAG (subidas de documentos y recuerdo entre canales) almacena incrustaciones en una columna `vector`, lo
que necesita la extensión [pgvector](https://github.com/pgvector/pgvector). Instálala para tu versión
mayor de PostgreSQL:

```sh
# Debian/Ubuntu, por ejemplo para PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

Luego habilítala una vez en tu base de datos. Conéctate con `psql` usando los valores `POSTGRES_*` de tu
`.env`; te pedirá `POSTGRES_PASSWORD`:

:::note[Windows]
No existe un paquete de pgvector prediseñado para PostgreSQL nativo en Windows. Instalarlo implica
compilarlo desde el código fuente contra tu versión exacta de PostgreSQL con Visual Studio C++ y `nmake`
(consulta las [instrucciones para Windows](https://github.com/pgvector/pgvector#windows) de pgvector). La
ruta más simple en Windows es ejecutar la base de datos en el contenedor `pgvector/pgvector` que se
muestra arriba en [Configura](#2-configura), que incluye la extensión preinstalada.
:::

```sh
# psql nativo / del host (sustituye tu propio POSTGRES_USER y POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# O bien, si la base de datos se ejecuta en el contenedor de Docker del paso 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

Una vez conectado, ejecuta:

```sql
CREATE EXTENSION vector;
```

Sin pgvector el bot sigue funcionando, pero las funciones de RAG quedan completamente no disponibles.
Esta extensión también se requiere en la base de datos de destino antes de restaurar una copia de
seguridad; consulta [Migración segura](/es-419/self-hosting/safe-migration/) para más detalles.

### `pg_cron` : trabajos de limpieza programados

`pg_cron` impulsa el mantenimiento periódico opcional de la base de datos (limpieza de filas de
enfriamiento/recordatorio). Docker Compose de este repositorio ya lo configura.

:::caution[No es necesario para recordatorios ni activadores]
`pg_cron` es **puramente de mantenimiento**, ya que solo limpia filas obsoletas. La entrega de
recordatorios y los activadores aleatorios se ejecutan en la propia aplicación, así que esas funciones
funcionan con o sin `pg_cron`.
:::

Para un PostgreSQL autogestionado, encuentra tu archivo de configuración activo:

```sql
SHOW config_file;
```

Habilita la extensión en `postgresql.conf`; agrégala a `shared_preload_libraries` si ya lista otras
bibliotecas:

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

Reinicia PostgreSQL y luego:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Recursos del tokenizador : sesgo de logit según el modelo

El sesgo de logit (penalizaciones de repetición de emojis/palabras) necesita recursos de tokenizador
locales:

```sh
bun run setup:tokenizers
```

Algunas familias (por ejemplo, Gemma) están restringidas y requieren un
[token de HuggingFace](https://huggingface.co/settings/tokens) después de aceptar su licencia:

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

Sin este paso, el sesgo de logit se deshabilita silenciosamente y todo lo demás funciona con
normalidad.

El respaldo seguro de `fetch_url` se ejecuta en el proceso y no necesita ningún paquete de Python.
`web_search` de DuckDuckGo/IAsk se incluye con `bun install --frozen-lockfile`, así que tampoco necesita
instalación adicional.

## Mantenimiento, actualización y copias de seguridad

Una vez instalado, los scripts del lado del host (`bun run update`, `bun run backup`,
`bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, …) y los procedimientos de
actualización y copia de seguridad viven todos en la página de
[Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/). Si estás por descargar una
nueva versión, comienza con [Migración segura](/es-419/self-hosting/safe-migration/).
