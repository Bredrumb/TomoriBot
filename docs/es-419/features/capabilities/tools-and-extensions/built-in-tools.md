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

:::note[Para creadores de prompts]
Al personalizar su prompt del sistema o las instrucciones de persona, haz referencia a las herramientas mediante sus **macros de prompt** de la tabla anterior en lugar de escribir nombres fijos de herramientas, ya que las macros se expanden a los nombres correctos al ensamblar el contexto y se degradan de forma controlada cuando una herramienta no está disponible.
`{pin_tool}` y `{timestamp_refresh_tool}` siguen funcionando como alias de compatibilidad para `{manage_message_tool}` y `{message_metadata_tool}`. Las herramientas de búsqueda web y URL también tienen macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` y `{url_metadata_tool}`. Estas se resuelven dinámicamente al mejor motor disponible, incluidos los reemplazos por MCP del servidor.
:::

### Bloques de prompt condicionales

El texto de prompt que admite las macros de herramientas anteriores también admite condicionales con ámbito:

```text
{{if capability:self_teaching}}
Usa {memory_tool} cuando valga la pena recordar un detalle.
{{else}}
No prometas guardar memorias a largo plazo.
{{/if}}
```

Usa `capability:<nombre>` para una opción habilitada de TomoriBot, o `tool:<nombre_función>` cuando el texto deba aparecer solo si esa herramienta exacta está disponible para el proveedor y modelo activos. Usa `tool_family:url_fetch` cuando esté disponible el lector de URL integrado o un reemplazo por MCP del servidor. Antepón un signo `!` a una condición para invertirla. Los bloques se pueden anidar y pueden contener un `{{else}}`; las expresiones generales `and`/`or` no son compatibles.

Los nombres de capacidad admitidos son `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` y `time_awareness`.

Las condiciones de herramientas reflejan la compatibilidad de proveedor/modelo, la configuración del servidor, los backends configurados, los reemplazos MCP y la lista de permitidos actual del modo de herramientas deliberado. No omiten ni predicen las comprobaciones de permisos de Discord que se realizan al ejecutar una herramienta. Los nombres de capacidad desconocidos se evalúan como falsos y se registran; los bloques mal formados se omiten. Los mensajes de chat sin procesar, la salida del modelo y los resultados de herramientas nunca se tratan como plantillas condicionales.
