---
title: "Herramientas y extensiones"
sidebar:
  order: 1
---

TomoriBot es agéntica: además de chatear, puede usar **herramientas** para buscar en la web, leer
documentos, generar medios, establecer recordatorios, actuar en otros canales y más. Decide cuándo
usarlas según la conversación. Esta página cubre las herramientas integradas, cómo ampliarla con
servidores MCP y cómo mantener ligeras las declaraciones de herramientas con el modo de
herramientas deliberado.

## Herramientas integradas

Las herramientas dependen de que el proveedor y modelo activos admitan llamadas a herramientas, y
muchas están controladas por una marca de función (un interruptor de `/config` > Permisos), un
permiso de Discord, una capacidad del modelo o una clave de API opcional.

| Herramienta | Macro del prompt | Requiere | Qué hace |
|---|---|---|---|
| Revisar capacidades | `{capabilities_tool}` | Ninguno | Comprueba las capacidades, comandos o ajustes actuales antes de responder. |
| Crear o actualizar memoria a largo plazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Guarda o reemplaza un dato estable del servidor o una preferencia del usuario. |
| Actualizar memoria a corto plazo | `{short_term_memory_tool}` | Ninguno (no en NovelAI) | Guarda memoria de trabajo temporal para el canal o arco narrativo actual. |
| Crear o actualizar tarea | `{task_tool}` / `{task_update_tool}` | Ninguno | Programa o edita recordatorios y tareas propias (consulta [Tareas programadas](/es-419/features/capabilities/scheduled-tasks/)). |
| Mensaje entre canales | `{cross_channel_tool}` | Ninguno (no en NovelAI) | Actúa en otro canal o hilo, con un informe opcional. |
| Crear hilo | `{create_thread_tool}` | `thread_creation_enabled` + permisos de hilo | Abre un hilo público y publica su mensaje inicial. |
| Seleccionar sticker | `{sticker_tool}` | `sticker_usage_enabled` | Añade a una respuesta un sticker del servidor que coincida. |
| Administrar mensaje | `{manage_message_tool}` | `manage_message_enabled` | Fija, edita o elimina mensajes recientes (fijar requiere `Manage Messages`). |
| Bloquear o desbloquear usuario | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silencia o bloquea a un usuario para una persona (no toca las memorias). |
| Interactuar con mensaje reciente | `{message_interaction_tool}` | Ninguno | Reacciona a un mensaje reciente o le envía una respuesta corta. |
| Consultar foto de perfil | `{profile_picture_tool}` | modelo de visión o `vision_llm` | Inspecciona el avatar de un usuario o de la persona. |
| Leer documento | `{document_tool}` | Ninguno | Extrae texto de un PDF o de **cualquier** archivo de texto UTF-8: código fuente (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` y cualquier adjunto no binario. |
| Mostrar metadatos del mensaje | `{message_metadata_tool}` | Ninguno | Anota turnos recientes con identificadores y marcas de tiempo para dirigir acciones con precisión. |
| Procesar video de YouTube | `{youtube_tool}` | modelo compatible con video | Analiza bajo demanda un enlace específico de YouTube. |
| Analizar imagen | `{image_analysis_tool}` | `vision_llm` configurado | Delega la comprensión de imágenes a un modelo de visión separado. |
| Generar imagen / imagen anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + proveedor compatible | Genera o edita imágenes (consulta [Generación de medios](/es-419/features/capabilities/media-generation/)). |
| Generar mensaje de voz | `{voice_message_tool}` | clave de ElevenLabs + voz de persona + `voice_message_enabled` | Envía una respuesta de voz hablada de Discord. |

:::note[Para autores de prompts]
Al personalizar el prompt del sistema o las instrucciones de una persona, referencia las
herramientas mediante sus **macros del prompt** de la tabla anterior en lugar de codificar sus
nombres: las macros se expanden a los nombres correctos al ensamblar el contexto y se degradan de
forma controlada cuando una herramienta no está disponible. `{pin_tool}` y
`{timestamp_refresh_tool}` siguen funcionando como alias de compatibilidad para
`{manage_message_tool}` y `{message_metadata_tool}`. Las herramientas de búsqueda web y URL de
abajo también tienen macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`,
`{news_search_tool}`, `{url_fetch_tool}` y `{url_metadata_tool}`; se resuelven dinámicamente con
el mejor motor disponible, incluidos reemplazos MCP del servidor.
:::

### Bloques de prompt condicionales

El texto de prompt que admite las macros de herramientas anteriores también admite condicionales
con alcance:

```text
{{if capability:self_teaching}}
Usa {memory_tool} cuando valga la pena recordar un detalle.
{{else}}
No prometas guardar memorias a largo plazo.
{{/if}}
```

Usa `capability:<name>` para un ajuste de TomoriBot activado, o `tool:<function_name>` cuando el
texto solo deba aparecer si esa herramienta exacta está disponible para el proveedor y modelo
activos. Usa `tool_family:url_fetch` cuando esté disponible el lector de URL integrado o un
reemplazo MCP del servidor. Antepón `!` a una condición para invertirla. Los bloques pueden
anidarse y pueden contener un `{{else}}`; no se admiten expresiones generales `and`/`or`.

Los nombres de capacidades admitidos son `tool_use`, `self_teaching`, `personal_memories`,
`emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`,
`image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` y
`time_awareness`.

Las condiciones de herramienta reflejan la compatibilidad del proveedor y modelo, la
configuración del servidor, los backends configurados, los reemplazos MCP y la lista permitida
actual del modo de herramientas deliberado. No evitan ni predicen las comprobaciones de permisos
de Discord que se realizan cuando una herramienta se ejecuta. Los nombres de capacidad
desconocidos se evalúan como falsos y quedan registrados; los bloques mal formados se omiten. Los
mensajes de chat sin procesar, la salida del modelo y los resultados de herramientas nunca se
tratan como plantillas condicionales.

## Búsqueda web y lectura de URL

El modelo ve una sola herramienta unificada `web_search(query, category)`. Detrás, un distribuidor
dirige cada llamada por una cadena de motores y devuelve el primer éxito:

**Brave → SearXNG → DuckDuckGo → IAsk**

- **Brave** se ejecuta primero cuando hay una clave de API de Brave configurada (establécela con
  `/providers`); añade búsqueda de imágenes, videos y noticias. ⚠️ Establece un límite de uso de
  $5 en el panel de Brave para evitar cargos inesperados.
- **DuckDuckGo** es el predeterminado cuando no hay clave establecida, y pasa a **IAsk** en caso de
  límites de frecuencia o resultados vacíos.
- **SearXNG** y **Crawl4AI** son sidecars opcionales con autoalojamiento que desbloquean más
  categorías y obtención de páginas renderizadas por navegador; consulta
  [Autoalojamiento](/es-419/self-hosting/).

Para leer una página específica, usa `fetch_url`. No está disponible en NovelAI.

## Servidores MCP

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) la amplía con herramientas
externas que registras tú mismo.

### Añadir un MCP en línea

Cualquier servidor MCP alojado públicamente con un endpoint HTTPS funciona. Como ejemplo, usa
[Smithery.ai](https://smithery.ai):

1. Crea una cuenta y genera una clave de API desde tu perfil.
2. Abre un MCP en el catálogo y copia su **URL de conexión** (por ejemplo, `https://youtube.run.tools`).
3. Abre `/config` > Plugins > Servidores MCP, elige **+ Añadir MCP**, pega la URL de conexión en
   **URL**, pega tu clave de Smithery en **Token de autenticación** y elige el **Tipo de
   servidor** requerido. **Propósito general** está seleccionado por defecto.

Si un servidor no necesita autenticación, deja vacío **Token de autenticación**. Tu token de
autenticación se cifra en reposo y nunca vuelve a mostrarse. Abre la misma página de Config para
revisar el estado configurado, activar o desactivar un servidor, o eliminarlo con confirmación
explícita. Eliminarlo lo desconecta de inmediato y libera un espacio. Cada fila guardada también
muestra los nombres de herramientas acotados de su último descubrimiento exitoso. **Ninguna
descubierta** es un resultado conocido de cero herramientas; **Descubrimiento desconocido**
identifica una fila heredada o un servidor que aún no tiene una instantánea exitosa. Abrir la
superficie de administración de MCP solo lee metadatos guardados y no contacta al servidor
remoto.

### Servidores MCP locales

Los servidores MCP locales **solo son compatibles con instancias con autoalojamiento**: el bot
público alojado requiere HTTPS y bloquea direcciones locales o privadas. Si ejecutas tu propia
instancia, consulta
[Configuración: servidor MCP local](/es-419/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Agrega solo servidores MCP de confianza]
Un servidor MCP malicioso puede hacerle **inyección de prompt** con instrucciones ocultas,
**exfiltrar** los datos que los usuarios entregan a sus herramientas, o devolver **resultados
dañinos o falsos** que ella transmitirá a tu servidor. Trata los servidores MCP como extensiones
del navegador: si tienes dudas, no lo agregues. Revisa siempre las herramientas descritas por un
MCP antes de añadirlo.
:::

## Modo de herramientas deliberado

Cada herramienta declarada se añade al prompt. El **modo de herramientas deliberado** mantiene las
declaraciones de herramientas fuera de los turnos de chat normales, salvo que el mensaje parezca
necesitar realmente una herramienta: esto reduce el tamaño del prompt y ayuda a que los modelos
pequeños o locales respondan más rápido.

- Primero comprueba si el mensaje tiene **intención de uso de herramienta**. Los activadores
  integrados cubren solicitudes comunes (recordatorios, búsqueda web, actualizaciones de memoria,
  mensajes entre canales, generación de imágenes/video/voz, análisis de medios, creación de hilos,
  acciones sobre mensajes). Las preguntas sobre su modelo actual, sus herramientas, sus ajustes o
  por qué una capacidad no está disponible exponen juntas la revisión de capacidades y el acceso a
  la documentación oficial. El texto de seguimiento también funciona, como "hazlo de nuevo pero
  más enojada" después de una solicitud de mensaje de voz.
- Los administradores del servidor pueden añadir **frases de activación personalizadas** literales
  con `/server trigger add`; por ejemplo, asociar `pic`, `img` o `pfp` con la generación de
  imágenes.
- Los activadores integrados leen frases en inglés. Otros idiomas llegan a las mismas herramientas
  mediante la lista de palabras clave de cada idioma. Se comprueba la lista de cada idioma
  incluido en cada mensaje, sin importar cuál sea tu configuración de idioma, así que un servidor
  bilingüe funciona en ambos idiomas.
- Las frases personalizadas en japonés, chino o coreano también coinciden dentro de palabras más
  largas, porque esos idiomas no separan las palabras con espacios. Una frase que termina en `*`
  coincide con cualquier palabra que comience con ella: `remind*` cubre `reminder` y `reminding`.

### Controles

- `/server dtm`: los administradores del servidor lo activan o desactivan.
- `/personal config`: los usuarios lo ajustan para sí mismos.
- Con un canal de registros de pensamiento configurado (`/server thought-logs`), las llamadas de
  herramientas exitosas en modo deliberado se registran allí junto con el activador que expuso la
  herramienta.

El modo de herramientas deliberado solo decide qué herramientas se *muestran* al modelo: el
modelo aún debe elegir llamar a una. En `/help`, elige **Comportamiento** y luego **Modo de
herramientas deliberado** para ver el resumen de Discord.

:::note
El **modo de herramientas deliberado** (esta sección) no está relacionado con el **modo de
activación deliberada**, que controla cómo se activa *ella*; consulta
[Chat y activadores](/es-419/features/chatting-personality/chatting-and-triggers/#modo-de-activación-deliberada).
Ambos se abrevian como "DTM" en Discord.
:::

## Actualizaciones estructuradas de información del usuario

La herramienta integrada `update_user_info` gestiona solicitudes explícitas para cambiar el
apodo, prefijo, sufijo, identidad de género, pronombres, estilo de trato o desfase UTC numérico
de un usuario registrado. Usa el mismo resolutor de nombres, alias, menciones e ID de Discord con
detección de colisiones que otras herramientas personales. Un objetivo omitido significa la
persona humana que activó el turno; `all` y `everyone` nunca son objetivos comodín.

Cada campo es su propio parámetro opcional, así que un cambio se expresa pasando el campo. La
eliminación es una lista `clear` de nombres de campo, lo que mantiene una sola regla para los
campos de texto, enumeración y numéricos por igual; una cadena vacía se pliega en una eliminación
en lugar de rechazarse. No hay parámetro de alcance ni de acción, porque el alcance sigue al
campo:

| Campos | Almacenado | Efecto |
|---|---|---|
| apodo, prefijo, sufijo | por linaje de persona | solo la persona que hizo el cambio se dirige a ellos de forma distinta |
| identidad de género, pronombres, estilo de trato, zona horaria | una vez por usuario | todas las personas leen el mismo valor |

Esa división sigue al almacenamiento y no a la preferencia: los campos de identidad tienen un
único espacio por usuario y no tienen equivalente por persona. El aviso de éxito etiqueta las
filas con alcance de persona con el nombre de la persona, así que la diferencia es visible en
lugar de implícita. Una fila sin etiqueta es global, lo que no necesita explicación propia porque
lo global es el caso esperado.

El contexto de participante nombra el prefijo y el sufijo de cada usuario por separado de su
apodo, así que una solicitud para quitar un título se resuelve como un cambio de afijo en lugar
de una reescritura de apodo. Un afijo eliminado se guarda como una supresión explícita, así que la
eliminación no puede deshacerla una capa de menor precedencia que aún proporcione un valor.

Cuando se envía un apodo con un afijo que ya está resuelto, el afijo redundante se elimina
comparándolo con el valor resuelto; el apodo nunca se divide por espacios en blanco para adivinar
un límite. Una actualización informa la forma de trato resultante siempre que ese nombre
realmente haya cambiado, así que un cambio de estilo de trato es visible en el mismo turno aunque
ningún campo de nombre haya aparecido en él, mientras que una edición de pronombre o zona horaria
no repite un nombre que nada tocó.

Cada campo se valida antes de una única escritura atómica. La privacidad restrictiva bloquea
adiciones y cambios, pero sigue permitiendo eliminar valores. La herramienta no puede editar los
términos de trato específicos de una persona. El interruptor de Actualizaciones de información del
usuario, activado por defecto en `/config` > Permisos, controla tanto la exposición de la
herramienta como la defensa contra invocaciones obsoletas. La opción manual `/personal config`
sigue disponible cuando está desactivada.
