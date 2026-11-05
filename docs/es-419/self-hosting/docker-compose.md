---
title: "Docker Compose"
sidebar:
  order: 3
aiGenerated: true
---

Docker Compose ejecuta TomoriBot y PostgreSQL juntos en contenedores. Es la tercera opción de instalación junto con el [asistente de configuración](/es-419/self-hosting/setup-wizard/) y la [configuración manual](/es-419/self-hosting/manual-setup/): selecciónela cuando desee ejecutar todo en Docker sin instalar Bun o PostgreSQL en su sistema host. Omite el asistente de configuración interactivo y configura la conexión de la base de datos automáticamente.

:::caution[Host tools for updates]
`bun run update --docker` necesita los hosts Bun y Git para realizar cambios en el código. La copia de seguridad de su base de datos se ejecuta dentro del contenedor de la aplicación. También puede ejecutar copias de seguridad y restauraciones manuales a través de Compose; consulte [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
:::

## 1. Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores requeridos de `.env`

Comience desde el archivo de ejemplo:

```sh
cp .env.example .env
```

Establece estas variables requeridas en `.env`:

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | Su token de bot Discord (habilite los intents privilegiados `GuildMembers`, `MessageContent` y `GuildPresences`). |
| `CRYPTO_SECRET` | Una clave de cifrado de 32 caracteres que se utiliza para cifrar las claves API almacenadas. |
| `POSTGRES_PASSWORD` | La contraseña de la base de datos. Todos los demás valores de `POSTGRES_*` se configuran automáticamente. |

Genere un valor aleatorio de 32 caracteres para `CRYPTO_SECRET` usando Docker, luego cópielo en `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Genere una contraseña separada para `POSTGRES_PASSWORD`. Puede copiar configuraciones de sintonización opcionales desde `.env.optional.example`.

:::note[Database connection is automatic]
No configure `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` o `POSTGRES_DB` en `.env`; Compose los configura automáticamente.
:::

En Linux, cree los directorios bind-mount en el host y asigne la propiedad al UID 1001 antes de iniciar los contenedores. Docker crea puntos de montaje faltantes como raíz, lo que impide que el contenedor del bot guarde copias de seguridad, registros o cargas:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Compila y ejecuta

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Para inicios posteriores, `docker compose up` por sí solo es suficiente a menos que cambie el código o las dependencias. Una vez que el bot se conecte a Discord, ejecute `/setup` en cualquier canal del servidor para agregar su clave de proveedor de IA. Consulta el [Inicio rápido](/es-419/introduction/quickstart/) para conocer las opciones de configuración en Discord.

Redacte los pines `RUN_ENV=development` en su definición de servicio para que funcionen los secretos de `.env` y los puntos finales HTTP locales. La comprobación del estado del contenedor informa si el proceso del bot se está ejecutando; no prueba la conectividad de la puerta de enlace Discord.

## Configuración opcional de shards en un solo host

Deja `SHARD_COUNT` y `SHARD_IDS` sin definir para el comportamiento predeterminado: un solo proceso es dueño de todos los shards recomendados por Discord al iniciar. Las instalaciones pequeñas normalmente reciben un solo shard. Este modo no usa leases de shards ni escucha de invalidación de caché. Varios shards pueden compartir el mismo proceso.

Para ejecutar cuatro shards en el servicio existente, añade `SHARD_COUNT=4` a `.env` y deja `SHARD_IDS` sin definir. Añade esta anulación de servicio en `compose.override.yaml` para permitir que el apagado acotado termine de forma limpia:

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

Vuelve a crear el servicio con `docker compose up -d --build tomoribot`. Si un script invoca `docker stop` o proporciona su propio tiempo de espera para detener Compose, permite al menos 40 segundos allí también. La selección automática no cambia la cantidad de shards mientras se ejecuta; modificar el total requiere un reinicio coordinado.

Los subconjuntos estáticos opcionales requieren un servicio independiente por grupo con el mismo `SHARD_COUNT` explícito y `SHARD_IDS` disjuntos, por ejemplo `0,1` y `2,3` con un total de `4`. Asigna a los servicios nombres estables distintos, nombres de contenedor distintos y los puertos de verificación de estado publicados que correspondan. La aplicación deriva etiquetas de métricas estables para cada grupo. Mantén una sola base de datos, ejecuta la inicialización puntual existente `bun run src/db/initializeCli.ts` con credenciales de gestión de esquema antes del inicio del gateway, y define `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false` en cada proceso de gateway. No inicies el servicio original dueño de todos los shards junto con estos grupos. Detén los procesos anteriores antes de cambiar el total o la partición.

El modo de subconjuntos rechaza un puente de Matrix completamente configurado. Los límites por usuario para turnos y subidas siguen siendo por proceso, así que evalúa si ese margen multiplicado es aceptable antes de habilitar un segundo proceso. Las instalaciones que usan la facturación para supporters exclusiva de la rama release también requieren admisión compartida de gasto y coordinación de conciliación antes de atender solicitudes financiadas desde varios procesos. Consulta [sharding y propiedad de procesos](/architecture/subsystems/sharding/) para conocer los límites de seguridad y estado.

## 4. Servidores locales opcionales (perfiles de Compose)

Ejecuta servidores auxiliares locales opcionales con perfiles de Compose para que solo inicie lo que necesita:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Al habilitar SearXNG, configure `SEARXNG_BASE_URL=http://searxng:8080/` en `.env`. De lo contrario, déjelo sin configurar. Establece `SEARXNG_SECRET` en un valor aleatorio independiente para la firma de solicitudes de SearXNG.

Consulta [SearXNG](/es-419/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/es-419/self-hosting/local-endpoints/setup-crawl4ai/) y [Monitoreo local](/es-419/self-hosting/local-monitoring/) para la configuración específica del servidor.

## Mantenimiento, actualización y copias de seguridad.

Utilice `bun run update --docker` para actualizaciones de respaldo en implementaciones de Compose. Para realizar una copia de seguridad o restaurar su base de datos de Compose, consulte [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
