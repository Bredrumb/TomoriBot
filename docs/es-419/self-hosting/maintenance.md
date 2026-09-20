---
title: "Mantenimiento y copias de seguridad"
sidebar:
  order: 5
---

Operación diaria de una instancia autoalojada: los scripts de mantenimiento, cómo actualizar y cómo
hacer copias de seguridad y restaurar tu base de datos. Estas son operaciones del lado del host: las
ejecutas desde una terminal, no desde Discord. Para los flujos de exportar/importar/eliminar por usuario
dentro de Discord, consulta en su lugar
[Manejo de datos](/es-419/features/knowledge/data-handling/).

Si estás por hacer `git pull` de una nueva versión, lee primero
[Migración segura](/es-419/self-hosting/safe-migration/): cubre cómo hacer una copia de seguridad *antes*
de que el ejecutor de migraciones de arranque toque tu esquema.

## Scripts de mantenimiento

| Comando | Descripción |
|---|---|
| `bun run setup` | Abre el asistente de instalación para la instalación base y los módulos opcionales. |
| `bun run update` | Hace una copia de seguridad primero, luego descarga el código más reciente e instala las dependencias. |
| `bun run backup` | Crea un paquete en `backups/` con el volcado de tu base de datos y tu `.env`: contiene todos tus datos. |
| `bun run restore-backup` | Restaura `.env` y la base de datos a partir de un paquete (`--latest` o `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta SOLO personas (con memorias de servidor) en todos los servidores; se reimporta mediante `/persona import`. |
| `bun run nuke-db` | Elimina todas las tablas (inicia el bot después para reinicializar). |
| `bun run purge-commands` | Borra todos los comandos de barra de Discord registrados. |
| `bun run rotate-keys` | Vuelve a cifrar todos los campos cifrados con la versión de clave actual. |

`bun run backup` y `bun run update` requieren las herramientas de cliente de PostgreSQL (`pg_dump`,
`psql`) en tu PATH.

## Actualización

Detén primero el bot en ejecución y luego usa el actualizador con copia de seguridad primero:

```sh
bun run update
```

Esto ejecuta `bun run backup`, luego `git pull --rebase --autostash`, luego
`bun install --frozen-lockfile`. El paquete de la copia de seguridad se escribe en `backups/` e incluye
tanto el volcado de la base de datos como `.env`. Agrega `--skip-backup` para omitir la copia de
seguridad previa a la actualización. Alternativa manual:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

¿Ejecutas desde `dist/`? Usa `bun run update --build`. ¿Ejecutas Docker Compose? Usa
`bun run update --docker`.

## Copias de seguridad y restauración

`bun run backup` crea un paquete con marca de tiempo en `backups/` (o en tu `TOMORI_BACKUP_DIR` si lo
sobrescribiste en `.env`) que contiene toda tu base de datos de PostgreSQL más `.env`. Restaura el
paquete más reciente con:

```sh
bun run restore-backup --latest
```

O restaura un paquete específico:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` es una exportación más acotada: solo preajustes de persona y memorias de
servidor por persona, en todos los servidores. **Debe** reimportarse manualmente mediante
`/persona import` y **no puede** usarse con `restore-backup` (eso causaría conflictos de clave
primaria).

TomoriBot también hace **copias de seguridad automáticas de inicio** en entornos que no son de
producción, y una restauración completa requiere que la extensión `pgvector` esté presente en la base de
datos de destino. Ambas se cubren en detalle en
[Migración segura](/es-419/self-hosting/safe-migration/), junto con un procedimiento manual de
`pg_dump`/`pg_restore` si prefieres manejar las herramientas directamente.

## Copias de seguridad con Docker Compose

Docker Compose admite copias de seguridad automáticas de inicio dentro del contenedor de la aplicación.
Los paquetes se escriben en el directorio `backups/` del host porque Compose lo monta dentro del
contenedor.

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

Los scripts del lado del host, como `bun run backup`, `bun run update` y `bun run nuke-db`, no se
ejecutan automáticamente a través de Docker. Para ejecutar scripts del host contra la base de datos de
Compose en su lugar, ejecútalos en el host con Bun y las herramientas de cliente de PostgreSQL
instaladas, y establece:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Reinstalación limpia

`bun run nuke-db` elimina todas las tablas; iniciar el bot después reinicializa el esquema, las semillas
y las migraciones desde cero. Úsalo junto con una copia de seguridad reciente de `bun run backup` cuando
quieras una base limpia desde la que aún puedas revertir; nunca lo ejecutes sin una copia de seguridad
actual.

## Ver también

- [Migración segura](/es-419/self-hosting/safe-migration/): hacer copias de seguridad antes de descargar,
  y el prerrequisito de restauración con `pgvector`
- [Manejo de datos](/es-419/features/knowledge/data-handling/): exportar/importar/eliminar por usuario
  dentro de Discord
- [Asistente de instalación](/es-419/self-hosting/setup-wizard/): la instalación guiada con `bun run setup`
