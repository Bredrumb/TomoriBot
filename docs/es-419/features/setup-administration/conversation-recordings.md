---
title: "Grabaciones de conversaciones"
description: "Guarda extractos alrededor de los mensajes de tu servidor y exporta o elimina tus grabaciones en privado."
sidebar:
  order: 5
---

Las grabaciones de conversaciones son una función opcional que guarda extractos alrededor de los mensajes de tu propio servidor únicamente para tu uso personal, reemplazando las identidades estructuradas de Discord por marcadores de posición antes del almacenamiento (el texto libre y los enlaces externos aún pueden identificar a personas).

**De forma predeterminada, TomoriBot no guarda tus mensajes, la grabación es opcional por usuario únicamente para su uso personal y comienza solo después de confirmar el comando `/record`. TomoriBot no crea personas automáticamente, no realiza llamadas a proveedores de IA ni alimenta ninguna canalización de entrenamiento con estos extractos.**

## Para qué se utiliza

- Conservar archivos personales de los mensajes de tu propio servidor y del contexto circundante.
- Revisar conversaciones pasadas con marcas de tiempo, orden de mensajes y enlaces de respuestas.
- Revisar tu propio estilo de escritura para redactar notas de personas o prompts fuera de línea.
- Exportar transcripciones estructuradas en Markdown o JSON para tu propio uso fuera de línea.

## Iniciar y detener la grabación

- **`/record start`**: Elige una duración y si deseas guardar solo tus mensajes o incluir los mensajes circundantes, y luego confirma. Evita `Hasta detenerse (no recomendado)` a menos que planees detenerlo manualmente.
- **Sesiones activas**: Puedes tener una grabación activa por servidor. Ejecutar `/record start` mientras está activa abre sus ajustes: los cambios de contexto solo se aplican a los extractos nuevos; cambiar la duración establece una nueva finalización a partir de ahora, mientras que mantener la misma duración conserva la finalización actual.
- **`/record stop`**: Detiene la recolección y conserva los extractos guardados.
- **`/record data`**: Abre tus grabaciones y ajustes para el servidor actual.
- **Alcance**: No disponible en mensajes directos. Los administradores del servidor no pueden ver, exportar ni eliminar tus grabaciones.

## Qué se guarda

- **Activadores**: Tras la activación, cada mensaje real que envíes puede guardar un extracto que finaliza con ese mensaje (incluso cuando Tomori no responda). Los mensajes de personificación no activan la grabación.
- **Contexto**: Hasta 10 mensajes aptos anteriores en el mismo canal o hilo desde una ventana reciente delimitada (pueden ser anteriores a la activación).
- **Modos**: `Solo mis mensajes` guarda únicamente tus mensajes. `Incluir mensajes circundantes` también puede guardar a otros miembros, bots y webhooks, incluso si nunca iniciaron una grabación.
- **Canales aptos**: Canales e hilos del servidor donde tanto tú como el bot puedan ver y leer el historial, incluidos canales restringidos e hilos privados. Los miembros con privacidad Total se omiten. La privacidad del canal y los ajustes de contexto entre canales no excluyen tus grabaciones.
- **Vacíos y duplicados**: Los extractos son instantáneas superpuestas con marcas de tiempo, orden y enlaces de respuesta. El mismo mensaje puede aparecer en varios extractos. El tiempo de inactividad, los eventos perdidos o los permisos faltantes dejan vacíos (sin relleno retrospectivo).
- **Embeds**: Guarda títulos, descripciones, campos, nombres de autor y pies de página de los embeds como texto del mensaje, con el mismo reemplazo de identidad que el texto común.
- **Archivos adjuntos**: Guarda el recuento de imágenes, videos, audios y archivos (los tipos desconocidos cuentan como archivos). Los bytes de archivos multimedia, nombres de archivo, URLs de archivos adjuntos, OCR y descripciones generadas de archivos multimedia no se guardan.

### Marcadores de posición legibles para identidades

- Las menciones estructuradas, canales y roles usan marcadores de posición estables de sesión (`[SELF]`, `[PARTICIPANT_1]`, `[CHANNEL_1]`, `[ROLE_1]`).
- Los nombres y apodos conocidos exactos y únicos se reemplazan sin distinción entre mayúsculas y minúsculas antes de guardar (lo que puede reemplazar palabras comunes que coincidan con un nombre). Los nombres compartidos se omiten y no se realiza una búsqueda en todo el servidor.
- Los emojis personalizados de Discord se convierten en `:name:`; los emojis Unicode se mantienen como están. Los enlaces a mensajes de Discord se convierten en un marcador genérico; las URLs externas se mantienen como están.
- El reemplazo se realiza según el mejor esfuerzo: el texto libre y las URLs externas aún pueden identificar a personas. El texto escrito que se parezca a un marcador de posición se mantiene como texto literal.

## Exportar y eliminar

- **Exportar**: En `/record data`, elige un rango de tiempo y Markdown o JSON. Los rangos relativos finalizan cuando envías la solicitud; `Todo el tiempo` incluye todos los extractos guardados. Los extractos se seleccionan según la hora de su mensaje final.
- **Entrega**: Los archivos llegan en una respuesta privada (guárdalos antes de que venza). Los nombres de archivo incluyen la hora de exportación en UTC y un ID corto de exportación; los archivos divididos también incluyen números de parte. Las exportaciones grandes se dividen entre extractos completos; reduce el rango si un rango o extracto supera los límites de tamaño. Los extractos guardados siguen siendo exportables incluso si luego pierdes acceso al canal de origen.
- **IDs de JSON**: Cada exportación asigna identificadores opacos nuevos (los mensajes compartidos conservan el mismo ID entre archivos divididos; los mensajes con texto idéntico reciben identificadores diferentes). No se exportan identificadores de Discord ni identificadores almacenados.
- **Eliminar**: Usa `Eliminar registros del servidor` para elegir un rango de tiempo, incluido `Todo el tiempo`, y luego confirma. Los rangos de tiempo finalizan cuando envías la selección; los mensajes grabados después permanecen guardados. Eliminar no detiene una grabación activa, y detener no elimina los registros guardados.

## Privacidad y retención

- **Acceso del operador e IA**: El operador del bot almacena las grabaciones en su base de datos y puede tener acceso a la infraestructura. La grabación no realiza llamadas a proveedores de IA ni inicia flujos de trabajo de entrenamiento o personificación.
- **Cuota**: 100 MiB de contenido lógico de transcripción en todos los servidores (los mensajes compartidos cuentan por extracto). Cuando se llena, los extractos completos más antiguos en todos tus servidores se expulsan primero.
- **Retención**: El vencimiento automático por antigüedad está desactivado a menos que el operador configure `RECORD_RETENTION_DAYS`, lo cual hace vencer extractos enteros (incluidos los existentes) según la hora de su mensaje final.
- **Ediciones y eliminaciones**: Las ediciones de origen observadas actualizan el texto almacenado y el recuento de archivos adjuntos; las eliminaciones observadas y las exclusiones de privacidad posteriores eliminan las copias almacenadas. Los eventos fuera de línea o inaccesibles no se pueden observar, y los archivos descargados o las copias de seguridad no se ven afectados. Consulta la [Política de privacidad](/legal/privacy-policy/) y el [mantenimiento de grabaciones](/self-hosting/maintenance/#conversation-recording-storage).
