---
title: "Herramientas integradas"
sidebar:
  order: 0
---

Las herramientas dependen de que el proveedor activo y el modelo admitan llamadas a herramientas. Muchas están protegidas detrás de un indicador de función (`/config` > Permisos), un permiso de Discord, una capacidad del modelo o una clave de API opcional.

:::tip
Si una capacidad no parece estar disponible, pregúntale por qué. Puede informar los indicadores de función del servidor y si el modelo activo admite llamadas a herramientas, lo que generalmente indica la configuración que se debe ajustar.
:::

| Herramienta | Macro de prompt | Requiere | Qué hace |
|---|---|---|---|
| Revisar capacidades | `{capabilities_tool}` | - | Comprueba las capacidades actuales del chat, comandos o configuraciones antes de responder. |
| Crear / actualizar memoria a largo plazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Guarda o reemplaza un hecho estable del servidor o una preferencia de usuario. |
| Actualizar memoria a corto plazo | `{short_term_memory_tool}` | - | Guarda memoria de trabajo temporal para el canal actual o el arco de la historia. |
| Crear / actualizar tarea | `{task_tool}` / `{task_update_tool}` | - | Programa o edita recordatorios y tareas automáticas (consulta [Tareas programadas](/features/capabilities/scheduled-tasks/)). |
| Mensaje multicanal | `{cross_channel_tool}` | - | Actúa en otro canal o hilo, con informe opcional. |
| Crear hilo | `{create_thread_tool}` | `thread_creation_enabled` + permisos de hilo | Abre un hilo público y publica su mensaje inicial. |
| Lanzar dados | - | `dice_rolling_enabled` | Lanza dados públicamente y usa el resultado obtenido en el juego de rol. |
| Seleccionar sticker | `{sticker_tool}` | `sticker_usage_enabled` | Añade un sticker coincidente del servidor o una expresión personalizada a una respuesta. |
| Administrar mensaje | `{manage_message_tool}` | `manage_message_enabled` | Fija, edita o elimina mensajes recientes (fijar necesita `Administrar mensajes`). |
| Bloquear / desbloquear usuario | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silencio/bloqueo de un usuario en el ámbito de la persona (no toca las memorias). |
| Interactuar con mensaje reciente | `{message_interaction_tool}` | - | Reacciona o envía una respuesta breve a un mensaje reciente. |
| Ver foto de perfil | `{profile_picture_tool}` | modelo de visión o `vision_llm` | Inspecciona el avatar de un usuario o de la persona. |
| Leer documento | `{document_tool}` | - | Extrae texto de un PDF o cualquier archivo de texto UTF-8: código fuente (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` y cualquier adjunto no binario. |
| Revelar metadatos del mensaje | `{message_metadata_tool}` | - | Anota turnos recientes con identificadores y marcas de tiempo para una selección precisa. |
| Procesar video de YouTube | `{youtube_tool}` | modelo con soporte de video | Analiza un enlace específico de YouTube bajo demanda. |
| Analizar imagen | `{image_analysis_tool}` | `vision_llm` configurado | Delega la comprensión de imágenes a un modelo de visión independiente. |
| Generar imagen / imagen de anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + proveedor compatible | Genera o edita imágenes (consulta [Generación de medios](/features/capabilities/media-generation/image-generation/)). |
| Búsqueda de etiquetas Danbooru | `{tag_search_tool}` | `danbooru_enabled` | Convierte nombres de personajes, apodos y conjeturas de etiquetas en etiquetas exactas de Danbooru (consulta [Búsqueda de etiquetas Danbooru](/features/capabilities/tools-and-extensions/danbooru/)). |
| Búsqueda de arte Danbooru | `{booru_post_search_tool}` | `danbooru_enabled` | Publica hasta 4 imágenes existentes de Danbooru para 1 o 2 etiquetas (consulta [Búsqueda de arte y lectura de publicaciones](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)). |
| Lectura de publicaciones Danbooru | - | `danbooru_enabled` | Lee las etiquetas agrupadas de una publicación de Danbooru a partir de su ID o enlace. |
| Generar mensaje de voz | `{voice_message_tool}` | clave de ElevenLabs + voz de persona + `voice_message_enabled` | Envía una respuesta de voz hablada en Discord. |

### Bloques de prompt condicionales
<!-- anchor: conditional-prompt-blocks -->

Usa [macros de herramientas](/features/prompt-macros/#tool-macros) para insertar nombres de funciones en
las instrucciones guardadas. Usa [bloques condicionales](/features/prompt-macros/#conditional-prompt-blocks)
para incluir esas instrucciones solo cuando una herramienta o capacidad esté disponible.
