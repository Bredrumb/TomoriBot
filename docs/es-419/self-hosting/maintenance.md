---
title: "Mantenimiento y copias de seguridad"
sidebar:
  order: 5
aiGenerated: true
---

Administra tu instancia autoalojada de TomoriBot mediante scripts de mantenimiento CLI para actualizar el código, realizar o restaurar copias de seguridad de datos, rotar claves de cifrado e inspeccionar variables de entorno. Ejecuta estos comandos desde la terminal de tu host o entorno Docker. Para exportaciones y eliminaciones de datos dentro de Discord, consulta [Manejo de datos](/features/knowledge/data-handling/).

TomoriBot aplica las migraciones de base de datos pendientes al iniciar. Algunas pueden eliminar datos y no se revierten automáticamente, así que realiza una copia de seguridad antes de actualizar o cambiar de rama.

## Scripts de mantenimiento

| Comando | Descripción |
|---|---|
| `bun run setup` | Abre el asistente de configuración para la instalación base y los módulos opcionales. |
| `bun run update` | Hace una copia de seguridad primero, luego descarga el código más reciente e instala las dependencias. |
| `bun run backup` | Crea un paquete en `backups/` con el volcado de tu base de datos y los metadatos de versiones de cifrado requeridos. Los secretos se mantienen separados. |
| `bun run restore-backup` | Restaura la base de datos utilizando claves de cifrado aprovisionadas por separado (`--latest` o `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta SOLO personas (con memorias del servidor) en todos los servidores; se reimporta mediante `/persona import`. |
| `bun run nuke-db` | Elimina todas las tablas (inicia el bot después para reinicializar). |
| `bun run purge-commands` | Borra todos los comandos de barra de Discord registrados. |
| `bun run rotate-keys --bot-stopped` | Vuelve a cifrar todos los campos cifrados con la versión de clave actual. |
| `bun run env-doctor` | Comprobación de solo lectura de tu configuración: enumera las entradas de `.env` que nada lee (solo nombres, nunca valores) y dónde se usa cada variable. |

`bun run backup` en el host necesita `pg_dump`, y `bun run restore-backup` en el host necesita `psql` en tu PATH. `bun run update` necesita `pg_dump` para su copia de seguridad. La ruta de actualización con `--docker` ejecuta la copia de seguridad en el contenedor, por lo que necesita Bun, Git y Docker en el host, pero ninguna herramienta de PostgreSQL en el host.

Para avatares locales, conserva los webhooks administrados de TomoriBot: eliminarlos impide que el bot edite mensajes de webhook más antiguos.

## Copias de seguridad de la base de datos y claves de recuperación
<!-- anchor: database-backups-and-recovery-keys -->

Los paquetes de base de datos contienen datos privados y un inventario de las versiones de cifrado requeridas. No contienen `.env` ni archivos multimedia. Protege el paquete y conserva cada clave de cifrado requerida por separado; sin una clave antigua, las credenciales cifradas con ella no se pueden recuperar.

Para restaurar una copia de seguridad confiable:

1. Detén todas las instancias del bot. Configura la base de datos de destino, el token de Discord y las claves de cifrado originales.
2. Instala `psql` y las extensiones de base de datos requeridas, incluyendo `pgvector`. La cuenta de la base de datos debe poder habilitar `pgcrypto`, o un administrador debe habilitarlo primero.
3. Ejecuta `bun run restore-backup --latest` o `bun run restore-backup --from backups/<bundle-directory>`. Revisa el destino y confirma las solicitudes. La restauración comprueba las claves antes de ejecutar SQL destructivo.
4. Ejecuta `bun run audit-keys` y `bun run rotate-keys --dry-run` antes de reiniciar. Si las credenciales necesitan migración, ejecuta `bun run rotate-keys --bot-stopped` y audita nuevamente. Si la restauración falla, mantén el bot detenido: las declaraciones SQL anteriores ya pueden haber modificado la base de datos.

Haz una copia de seguridad del directorio local `data/` por separado, incluyendo avatares, muestras de voz y `data/custom-expressions/`. Restaura los archivos en las mismas rutas. Para expresiones en GCS o S3, haz una copia de seguridad de los objetos en `custom-expressions/` y restaura sus claves en el mismo bucket configurado. Las expresiones vinculadas dependen de sus hosts externos.

En entornos que no son de producción, el inicio crea una copia de seguridad de la base de datos cuando la versión del bot cambia o la última copia de seguridad tiene al menos `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` de antigüedad (24 horas por defecto). Conserva `TOMORI_AUTO_BACKUP_MAX` copias de seguridad (5 por defecto); establece `TOMORI_AUTO_BACKUP_ENABLED=false` para desactivar esto. Estas copias de seguridad no incluyen archivos multimedia ni claves de cifrado.

Los paquetes más antiguos pueden contener secretos en `config.env`. La restauración no lo carga; revísalo en privado y proporciona las claves requeridas a través de tu fuente habitual de secretos.

## Rotación de claves de cifrado
<!-- anchor: rotating-encryption-keys -->

1. Haz una copia de seguridad de la base de datos y conserva todas las claves existentes en un almacenamiento protegido. Prueba la recuperación en una base de datos desechable antes de retirar cualquier clave.
2. Genera una nueva clave con `openssl rand -base64 32`. Agrégala a la fuente de secretos del bot como `CRYPTO_SECRET_V<version>` y selecciónala con `CRYPTO_SECRET_CURRENT`. Conserva las versiones anteriores; `CRYPTO_SECRET` es V1.
3. Detén todas las instancias del bot y los procesos que escriben credenciales. Usa la misma fuente de secretos y configuración de base de datos que el bot; los scripts de producción también necesitan `RUN_ENV=production`.
4. Ejecuta `bun run audit-keys` y `bun run rotate-keys --dry-run`. Ambos deben tener éxito antes de continuar.
5. Ejecuta `bun run rotate-keys --bot-stopped`, luego `bun run audit-keys`. Si cualquiera de los dos falla, mantén el bot detenido y todas las versiones de claves disponibles mientras solucionas la falla.
6. Prueba una base de datos desechable restaurada con la clave actual conservada. Prueba las copias de seguridad anteriores con sus claves archivadas antes de eliminar versiones antiguas de la fuente activa de secretos. Conserva las claves archivadas mientras existan sus copias de seguridad, luego reinicia el bot.

`--bot-stopped` registra tu confirmación; no puede detectar otra instancia en ejecución ni borrar su caché de credenciales.

## Actualización

Detén el bot en ejecución primero, luego usa el actualizador que realiza una copia de seguridad previa:

```sh
bun run update
```

El actualizador realiza una copia de seguridad de la base de datos, descarga el código e instala las dependencias. Usa `--build` si ejecutas desde `dist/`. Para Compose, consulta [Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups). Haz una copia de seguridad de los archivos multimedia y las claves de cifrado por separado.

Usa una base de datos independiente para probar ramas: volver atrás no deshace las migraciones. Si una migración falla, mantén el bot detenido, revisa los registros y sigue los pasos de recuperación anteriores antes de regresar a la versión previa. Registra el commit actual con `git rev-parse HEAD` antes de actualizar para facilitar la recuperación.

### Cambios de entorno

Ejecuta `bun run env-doctor` para encontrar configuraciones no utilizadas en `.env`. Los enfriamientos de comandos usan `COMMAND_COOLDOWN_SCALE` (`1` por defecto; `0` desactiva los enfriamientos).

Los servidores locales de TTS ya no autentican solicitudes con las configuraciones anteriores de token de portador. Revisa [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access) antes de exponerlos fuera de tu máquina. Cada motor usa su propia configuración de puerto.

## Copias de seguridad y restauración

```sh
bun run backup
bun run restore-backup --latest
# O elige un paquete:
bun run restore-backup --from backups/<bundle-directory>
```

Los paquetes se almacenan en `backups/` o `TOMORI_BACKUP_DIR`. Sigue los [pasos de recuperación](#database-backups-and-recovery-keys) antes de restaurar. `bun run backup:personas` exporta personas y memorias del servidor para `/persona import`; no puede restaurar una base de datos.

## Copias de seguridad con Docker Compose

Docker Compose admite copias de seguridad automáticas al inicio dentro del contenedor de la aplicación. Los paquetes se escriben en el directorio `backups/` del host porque Compose lo monta dentro del contenedor.

Para una copia de seguridad manual con Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Para una restauración con Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

## Reinstalación limpia

`bun run nuke-db` elimina todas las tablas; iniciar el bot después reinicializa el esquema, las semillas y las migraciones desde cero. Úsalo junto con una copia de seguridad reciente de `bun run backup` cuando quieras una base limpia desde la que aún puedas revertir: nunca lo ejecutes sin una copia de seguridad actual.
