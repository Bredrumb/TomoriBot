---
title: Monitoreo local con Grafana
sidebar:
  order: 7
---

Puedes monitorear tu instancia local de TomoriBot con paneles de Grafana usando un perfil de Docker
Compose incluido.

Para iniciar TomoriBot y Grafana juntos en tu máquina:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Esto hará lo siguiente:
- Lanzará TomoriBot con PostgreSQL (en el puerto 15432 para la base de datos)
- Lanzará Grafana en el puerto 3000 con una fuente de datos de PostgreSQL autoconfigurada
- Aprovisionará el panel **TomoriBot Overview**
- Conectará ambos servicios en la misma red de Docker

Accede a Grafana en [http://localhost:3000](http://localhost:3000):
- **Usuario**: `admin`
- **Contraseña**: se establece mediante `GRAFANA_PASSWORD` en `.env` (por defecto `admin` si no se
  establece)

## El panel aprovisionado

**TomoriBot Overview** aparece automáticamente y no necesita configuración. Sus paneles cubren la
memoria del proceso, el número de entradas de caché, los errores por hora, el uso de tokens por modelo,
la actividad por hora, los comandos principales, las configuraciones regionales de los usuarios, una nube
de emociones y qué preajustes y modelos están en uso.

Cada panel lee únicamente tablas que existen en cualquier instalación, así que el mismo panel funciona
tanto en autoalojamiento como en una implementación en la nube.

Algunos paneles permanecen vacíos hasta que su fuente se activa:

| Panel | Necesita |
|---|---|
| Memoria del proceso, entradas de caché | Filas de `metric_samples`, escritas cada `CACHE_METRICS_INTERVAL_MS`. El recolector solo se ejecuta cuando `RUN_ENV=production`, así que una instancia de desarrollo no muestra nada aquí. |
| Errores por hora por tipo | `ERROR_DB_LOGGING_ENABLED` (activado por defecto). Una línea plana durante un incidente sospechado también puede significar que el disyuntor del repositorio está abierto, no que los errores cesaron. |
| Niveles de memoria y swap del host, presión del host (PSI) y tasa de entrada de swap | Un host Linux. Estos leen `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` y `/sys/block/zram0`, así que permanecen vacíos en macOS y Windows. La serie de zram también necesita un dispositivo de swap zram; un host sin uno igual reporta memoria y PSI. |

## Editar y conservar los cambios

Los paneles permanecen editables en la interfaz, lo cual importa durante un incidente. Las ediciones
viven solo en el contenedor y se reemplazan desde el disco en el siguiente reinicio, así que exporta el
JSON de un panel y confírmalo en `docker/grafana/dashboards/` para conservar un cambio.

Agregar tu propio panel significa colocar un archivo JSON en ese mismo directorio. Haz referencia a la
fuente de datos por su uid fijo `tomoribot-postgres`: Grafana asigna un uid aleatorio cuando una fuente
de datos no declara ninguno, y un panel que apunta a un uid aleatorio muestra paneles vacíos en lugar de
un error.
