---
title: "Macros de prompt"
sidebar:
  order: 5.5
---

Las macros de prompt insertan nombres actuales, herramientas disponibles y otros valores cuando TomoriBot prepara una
respuesta. Usa un bloque condicional para incluir una instrucción solo cuando aplique.

## Macros de nombres
<!-- anchor: names -->

Usa macros de nombres en prompts guardados, atributos, diálogos de muestra, lorebooks y memorias.
En una nota de contexto, usa `{@userId}`.

| Macro | Qué inserta | Ejemplo |
| --- | --- | --- |
| `{bot}`, `{char}` | El nombre de la persona activa. | `Eres {char}.` se convierte en `Eres Lilya.` cuando Lilya está activa. |
| `{user}` | La persona que activó la respuesta. En prompts compartidos, atributos, lorebooks y memorias del servidor, se convierte en `User`. En una memoria personal, nombra a la persona que la memoria describe. | En un diálogo de muestra, `Hi, {user}!` se convierte en `Hi, Mirri!` cuando Mirri activa la respuesta. |
| `{user_formatted}` | El nombre del usuario que activó la respuesta con el prefijo y sufijo que usa la persona activa. | El preajuste en inglés de Lilya cambia `Hi, {user_formatted}!` a `Hi, Mirri-senpai!` para Mirri. |
| `{user_term}` | El término de tratamiento de la persona activa para el usuario que activó la respuesta. | El preajuste en inglés de Rose usa `fam` (neutro), `bro` (masculino) o `sis` (femenino). |
| `{@123456789012345678}` | El apodo del usuario de Discord con ese ID, incluso cuando otra persona activó la respuesta. | Con `Navigator` guardado como su apodo, `Ask {@123456789012345678}.` se convierte en `Ask Navigator.` |

Las macros de nombres aceptan llaves simples o dobles e ignoran mayúsculas y minúsculas. Por ejemplo, `{{char}}` y `{CHAR}`
funcionan igual. En un prompt del sistema o de persona compartido, usa `{user_formatted}` o `{user_term}` para referirte
a la persona que activó la respuesta. Estas dos macros permanecen tal como están escritas en los prellenados de respuesta.
Configura un término de tratamiento neutro en `Hábitos de nombramiento` de la persona antes de usar `{user_term}` en su texto.

### Referirse a un usuario específico de Discord
<!-- anchor: refer-to-a-specific-discord-user -->

Activa el `Modo desarrollador` y copia el ID de usuario de la persona. Consulta la
[guía de Discord para copiar ID](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
Coloca el número después de `@` entre llaves simples, como en
`Treat {@123456789012345678} as the ship's navigator.`

TomoriBot usa el apodo de la persona para la persona activa, luego su apodo global desde
`/personal config` > `Perfil`, y después su nombre de usuario de Discord. Si el servidor desactiva las memorias
personales, la persona está en lista negra o su privacidad está configurada en `Completo`, usa su nombre de usuario
de Discord. Si no puede resolver un nombre, la macro permanece tal como está escrita.

El chat en vivo conserva la macro tal como está escrita, incluido el chat citado literalmente en la memoria a corto plazo o
copiado a un preajuste con `{{input}}` o `{{lastChatMessage}}`. Un atributo compartido mediante el perfil público de una
persona también la conserva tal como está escrita cuando otra persona lo lee.

### Menciones y enlaces de Discord

Las menciones de usuario (`<@userId>` y `<@!userId>`) usan el apodo global guardado de la persona cuando las memorias
personales están activadas. Recurren al apodo del servidor o al nombre de usuario, incluso para usuarios en lista negra.
Usa `{@userId}` para resolver un apodo específico de una persona.

Una mención de canal (`<#channelId>`) o un enlace a un canal o mensaje de Discord proporciona una etiqueta de canal legible
cuando TomoriBot puede resolver el canal. Una mención de rol (`<@&roleId>`) se convierte en un nombre como
`@Raid Guides` si el rol existe en el servidor actual. Las menciones de rol sin resolver permanecen tal como están escritas.

## Opciones aleatorias

Usa `{{random: north, south}}` o `{{random::north::south}}` para elegir una opción durante el ensamblaje
del prompt. La forma de dos puntos dobles puede incluir comas dentro de una opción. Ambas formas también aceptan
llaves simples.

## Macros de herramientas
<!-- anchor: tool-macros -->

Usa una macro de herramienta para insertar el nombre de función disponible para el proveedor y modelo actuales.
Una macro integrada sin herramienta disponible se expande a `an unavailable tool`. Coloca la instrucción en un
[bloque condicional](#conditional-prompt-blocks) para omitirla cuando la herramienta no esté disponible.
Para ver qué puede hacer cada herramienta y qué ajustes la habilitan, consulta
[Herramientas integradas](/features/capabilities/tools-and-extensions/built-in-tools/).

### Macros de herramientas integradas

| Macro | Nombre de función para condiciones `tool:` | Ejemplo de instrucción permanente |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Usa {capabilities_tool} para comprobar qué puedes hacer aquí antes de prometer una función como stickers o mensajes de voz.` |
| `{memory_tool}` | `create_long_term_memory` | `Guarda preferencias duraderas de los miembros, como sus juegos de fiesta favoritos, con {memory_tool} para poder usarlas en futuras charlas.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Usa {memory_update_tool} para revisar la memoria existente cuando un miembro corrija una preferencia guardada o un moderador cambie un evento recurrente.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `En las pausas de escena de rol, usa {short_term_memory_tool} para registrar dónde se detuvo el grupo, qué pistas encontraron y qué planean hacer después.` |
| `{task_tool}` | `create_task` | `Programa recordatorios de noches de juego y encuestas con {task_tool} cuando los miembros los soliciten. Confirma la hora programada después.` |
| `{task_update_tool}` | `update_task` | `Usa {task_update_tool} para reprogramar el recordatorio existente cuando un miembro cambie su hora o frecuencia de repetición.` |
| `{cross_channel_tool}` | `cross_channel_message` | `Cuando te pidan publicar resultados de eventos, publícalos en #announcements con {cross_channel_tool} e informa aquí de vuelta.` |
| `{create_thread_tool}` | `create_thread` | `Cuando los miembros pidan explícitamente un hilo de discusión con spoilers, usa {create_thread_tool} y abre con una pregunta sobre el episodio.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebra victorias de incursiones con {sticker_tool} cuando el servidor tenga un sticker que encaje con el momento.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Fija guías y resúmenes de eventos con {manage_message_tool} cuando un moderador lo pida.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Usa {message_interaction_tool} para reaccionar con 🎉 a nuevos anuncios de resultados de torneos.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Usa {conditioning_interaction_tool} para abrazos de victoria solicitados tras grandes triunfos.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `Cuando los miembros pidan comentarios sobre un avatar, inspecciona el avatar con {profile_picture_tool} antes de opinar sobre el diseño.` |
| `{document_tool}` | `read_file` | `Usa {document_tool} para leer los PDF de reglas adjuntos antes de responder preguntas sobre puntuación o elegibilidad.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Usa {message_metadata_tool} cuando los miembros pregunten por la hora exacta de envío o las reacciones en una encuesta o anuncio reciente.` |
| `{gif_tool}` | `process_gif` | `Usa {gif_tool} para inspeccionar un GIF de reacción adjunto cuando su movimiento importe para la conversación.` Disponible solo en desarrollo. |
| `{youtube_tool}` | `process_youtube_video` | `Usa {youtube_tool} cuando los miembros pregunten por un movimiento específico mostrado en una guía de YouTube enlazada.` |
| `{image_analysis_tool}` | `analyze_image` | `Al ayudar con una captura de pantalla de error, lee el error visible con {image_analysis_tool} antes de sugerir una solución.` |
| `{image_generation_tool}` | `generate_image` | `Para banners de eventos solicitados, usa {image_generation_tool} y deja espacio para el título del evento.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Usa {anime_image_generation_tool} para arte de rol estilo anime solicitado. Mantén los atuendos establecidos de los personajes.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resuelve apodos de personajes y escrituras alternativas con {tag_search_tool} antes de buscar arte de fans.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `Cuando los miembros pidan explorar arte de fans de anime existente, publica una pequeña selección con {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Envía resúmenes de misiones y recapitulaciones dramáticas con {voice_message_tool} cuando los jugadores pidan escucharlos en voz alta.` |
| `{block_user_tool}` | `block_user` | `Usa {block_user_tool} para aplicar un silencio de persona cuando un moderador pida impedir que un miembro te active durante un tiempo determinado.` |
| `{unblock_user_tool}` | `unblock_user` | `Usa {unblock_user_tool} para levantar antes un silencio de persona cuando un moderador lo pida.` |
| `{user_info_tool}` | `update_user_info` | `Guarda el apodo o título honorífico solicitado de un miembro para esta persona con {user_info_tool}.` |

`{pin_tool}` y `{timestamp_refresh_tool}` son alias de compatibilidad.

### Macros de búsqueda y URL

Estas macros pueden seleccionar una herramienta MCP del servidor en lugar de la función integrada. Si ninguna está
disponible, insertan una descripción de la herramienta.

| Macro | Qué selecciona |
| --- | --- |
| `{web_search_tool}` | Una herramienta de búsqueda web o la integrada `web_search`. |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | Una herramienta de búsqueda para el tipo de medio solicitado, recurriendo a la búsqueda web. |
| `{url_fetch_tool}` | Un lector de URL o el integrado `fetch_url`. |
| `{url_metadata_tool}` | Una herramienta MCP que puede inspeccionar una URL, o la integrada `fetch_url`. |

## Bloques de prompt condicionales
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| Condición | Cuándo aparece su rama |
| --- | --- |
| `{{if tool:<function_name>}}` | La herramienta exacta está disponible para el proveedor y modelo. |
| `{{if capability:<name>}}` | La capacidad nombrada está habilitada. |
| `{{if tool_family:url_fetch}}` | El lector de URL integrado o un reemplazo MCP del servidor está disponible. |

Antepón `!` a la condición, como en `{{if !capability:time_awareness}}`, para comprobar su ausencia.
Usa como máximo un `{{else}}` por bloque y cierra cada bloque con `{{/if}}`. Anida bloques hasta
32 niveles. Usa bloques anidados para múltiples requisitos.

Los nombres de capacidad admitidos son `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`,
`sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`,
`video_generation`, `voice_message`, `user_blocking`, `short_term_memory` y `time_awareness`.
`tool_use` es falso cuando el modelo activo no puede llamar herramientas.

Las condiciones de herramientas verifican las herramientas disponibles cuando se ensambla el prompt, incluidas
las restricciones del modo de herramientas deliberado. Los permisos de Discord se verifican cuando la herramienta
se ejecuta. Los nombres de capacidad desconocidos se evalúan como falsos y generan una advertencia. TomoriBot
omite bloques mal formados y deja las etiquetas condicionales tal como están escritas si el anidamiento supera el límite.

## Macros de preajustes de SillyTavern
<!-- anchor: sillytavern-preset-macros -->

Estas macros adicionales funcionan dentro de los nodos de preajustes de SillyTavern. Los nodos de preajuste también aceptan
las macros de identidad, opción aleatoria y herramienta descritas arriba.

| Macro | Qué inserta |
| --- | --- |
| `{{user}}`, `<USER>` | El miembro que activó la respuesta. |
| `{{char}}`, `{{bot}}`, `<BOT>` | El nombre de la persona activa. |
| `{{personality}}` | Los atributos de la persona. |
| `{{description}}` | El prompt de la persona. |
| `{{scenario}}` | Vacío. Los escenarios de tarjetas importadas pasan a ser atributos de persona. |
| `{{mesExamples}}` | Diálogos de muestra. |
| `{{lastChatMessage}}`, `{{input}}` | El mensaje más reciente del usuario en el historial de chat proporcionado. |
| `{{time}}`, `{{date}}`, `{{weekday}}` | Hora, fecha o día de la semana del servidor en inglés, como `3:45 PM`, `October 28, 2026` o `Wednesday`. |
| `{{isotime}}`, `{{isodate}}` | Hora del servidor en `HH:mm` o fecha en `YYYY-MM-DD`. |
| `{{model}}`, `{{provider}}` | Los ID de modelo y proveedor configurados. Las elecciones aleatorias por turno y los modelos de respaldo dejan estos valores sin cambios. |
| `{{char_version}}` | Vacío. TomoriBot no almacena versión de tarjeta. |
| `{{roll:2d6}}` | La suma de una tirada de dados, hasta 100 dados y 1,000 caras por dado. |
| `{{// notes}}` | Vacío. Úsalo para comentarios en el preajuste. |
| `{{trim}}` | Elimina los espacios en blanco iniciales y finales del nodo. |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | Establece o agrega texto a una variable compartida entre los nodos del preajuste. |
| `{{getvar::key}}` | El valor de la variable, o vacío si no está definida. |

`<USER>` y `<BOT>` son tokens de compatibilidad que distinguen entre mayúsculas y minúsculas. Las cinco macros de fecha y hora
usan una misma lectura del reloj y el desplazamiento UTC fijo del servidor. Cambia el desplazamiento del servidor cuando cambie
el horario de verano. Las cinco quedan vacías cuando `Mejor conciencia del tiempo` está desactivada. Colócalas en nodos
tardíos o inyectados por profundidad para mantener el texto anterior elegible para el almacenamiento en caché del prompt.

### Condicionales de preajuste
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

Un nombre simple como `description` significa `{{description}}`. Puedes colocar una macro de valor directamente
en la condición, como en `{{#if {{input}}}}`. TomoriBot ignora mayúsculas, minúsculas y espacios alrededor cuando
evalúa el valor. El texto vacío, `false` y `0` son falsos. Las macros de valor no reconocidas cuentan como vacías.

Estos bloques pueden anidarse con las [condiciones de herramientas y capacidades](#conditional-prompt-blocks).
Cierra `#if` con `{{/if}}` y `#unless` con `{{/unless}}`. Un bloque de preajuste sin cerrar termina al
final de su nodo. TomoriBot descarta etiquetas de cierre sueltas y etiquetas `{{else}}`, y omite bloques con
un segundo `{{else}}` o un cierre que no coincide. El límite de 32 niveles también aplica a bloques mixtos.

Las condiciones de preajuste ven las declaraciones de variables anteriores en el orden de nodos, incluso antes en el
mismo nodo. Las declaraciones dentro de una rama de preajuste omitida no tienen efecto. Un `{{getvar::key}}`
fuera de una condición ve el valor final después de que TomoriBot recorre los nodos habilitados. Las condiciones de
herramientas y capacidades se ejecutan después de la asignación de variables.

## Verificar una macro

Ejecuta `/tool prompt snapshot` para la persona y el canal que quieras comprobar. Abre la exportación y
busca la instrucción renderizada. Usa `/context` para ver qué partes del prompt ocupan
espacio. Consulta [Inspeccionar el prompt](/features/knowledge/inside-the-prompt/#inspecting-the-prompt).
