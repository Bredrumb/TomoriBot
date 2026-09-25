---
title: "Dentro del prompt"
sidebar:
  order: 2
aiGenerated: true
---

Cada vez que activas a TomoriBot, se ensambla lo siguiente y se envía a tu modelo de texto
configurado como el prompt/contexto principal, en este orden:

| Bloque | ¿Opcional? | Comandos | Qué es |
|---|---|---|---|
| [`Prompt del sistema`](/es-419/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > Motor > General | Instrucciones básicas en la parte superior del contexto. |

> **Texto predeterminado del prompt del sistema** (se usa solo mientras no haya un prompt del sistema del servidor configurado):
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| Bloque | ¿Opcional? | Comando | Qué es |
|---|---|---|---|
| **Prompt de canal (agregar)** | *(Opcional)* | `/config` > Canales > Excepciones de canal | Varía por canal, se agrega justo después del prompt del sistema. El modo *reemplazar* de la misma página ocupa el lugar del prompt del sistema anterior en lugar de añadir uno nuevo. |
| **Prompt de persona** | *(Opcional)* | `/config` > Persona > Avanzado | Un prompt escrito específicamente para la persona activa, separado del prompt del sistema. |
| [**Atributos de la persona**](/es-419/features/chatting-personality/multiple-personas/#attributes) | | `/config` > Persona > Identidad y personalidad | Los rasgos de personalidad y patrones de habla de la persona activa. |
| **Información del servidor** | | *(ninguno, viene de Discord)* | El nombre del servidor, su descripción y el canal en el que está, obtenidos directamente de Discord. |
| [**Bloqueos persona-usuario**](/es-419/features/capabilities/tools-and-extensions/#herramientas-integradas) | *(Opcional)* | `/moderation` para revisar/limpiar; controlado por `/config` > Permisos (Bloqueo de usuarios) | Restricciones activas de silencio/bloqueo que esta persona mantiene contra usuarios específicos. |
| [`Memorias del servidor`](/es-419/features/knowledge/memory/#personal-vs-server-memories) | | `/memories` | Los datos a largo plazo guardados para este servidor. |
| [**Emojis del servidor**](/es-419/features/chatting-personality/behavior-tweaking/#capacidades-lo-que-puede-hacer) | *(Opcional)* | `/config` > Permisos (Uso de emojis) (solo interruptor), inicializa con `/expressions initialize` | Los emojis personalizados presentes en el servidor. |
| [**Stickers del servidor**](/es-419/features/chatting-personality/behavior-tweaking/#capacidades-lo-que-puede-hacer) | *(Opcional)* | `/config` > Permisos (Uso de stickers) (solo interruptor), inicializa con `/expressions initialize` | Los stickers personalizados presentes en el servidor. |
| [**Sprites de la persona**](/es-419/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Opcional)* | `/config` > Persona > Sprites | Sprites de expresión nombrados configurados para la persona, si tiene alguno. |
| [**Participantes de la conversación**](/es-419/features/knowledge/memory/#personal-vs-server-memories) | *(Opcional)* | `/personal memories` (controlado por `/config` > Permisos (Personalización)) | Las personas en la conversación, sus apodos y menciones, y las memorias personales guardadas sobre cada una. Se carga cuando la persona es dueña de un mensaje en el contexto, o si se menciona su nombre/alias. También incluye el canal actual y la hora local como pie de página, usando `/config` > Motor > General. |
| [`Memoria a corto plazo`](/es-419/features/knowledge/memory/#short-term-memory-stm) | | `/config` > Persona > Memorias; `/memories` para borrar entradas; controlado por `/config` > Permisos (Memoria a corto plazo) | Contiene resúmenes y mensajes recientes de distintos canales |
| [`Documentos`](/es-419/features/knowledge/memory/#document-knowledge-base-rag) | *(Opcional)* | `/memories` | Fragmentos relevantes extraídos de la base de conocimiento mediante RAG. |
| [**Condicionamiento**](/es-419/features/knowledge/memory/#conditioning) | *(Opcional)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, gestionado mediante `/conditioning remove` | Incentivos de comportamiento acumulados para esta persona en este servidor. |
| [`Diálogos de muestra`](/es-419/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Opcional)* | `/config` > Persona > Identidad y personalidad | Ejemplos de cómo habla esta persona, si hay alguno configurado. |
| [**Mensajes recientes**](/es-419/features/chatting-personality/behavior-tweaking/#ajuste-de-generación) | | `/config` > Motor > General | La conversación real, hasta esta cantidad de mensajes (80 por defecto). Tu nota de contexto y cualquier nota de reencuentro se inyectan en línea dentro de este bloque, en una profundidad configurable, en lugar de como un bloque separado propio. |

Las filas marcadas como *(Opcional)* no aportan nada (y no cuestan tokens) cuando no hay nada que decir, por ejemplo, si no coincidió ningún documento, o el servidor no tiene emojis personalizados.

Los mensajes recientes son la parte más grande y frágil: es una ventana que avanza mientras las personas hablan. Todo lo anterior a ellos se reconstruye a partir de ajustes guardados y es estable.

`/tool prompt snapshot` vuelca el paquete exacto de una persona a un archivo. Es la fuente de
verdad de qué memorias están activas en ese momento, si coincidió algún documento, y cuánto de
la conversación realmente cupo.

`/tool estimate cost` desglosa ese mismo paquete por tamaño, lo cual es útil para averiguar qué
está consumiendo tu contexto antes de subir cualquier límite.

### ¿Dónde se definen las herramientas?

Para cada proveedor que TomoriBot admite de forma nativa, los esquemas de herramientas se envían
a través del campo `tools` propio del proveedor, así que depende del proveedor/motor de
inferencia configurado.

### ¿Por qué TomoriBot olvida?

Este orden explica casi cualquier pregunta de "¿por qué no lo recuerda?":

| Qué pasó | Por qué |
|---|---|
| Olvidó algo de más temprano hoy | Salió del límite de mensajes desplazándose hacia atrás. Solo estuvo en **Mensajes recientes**; si Tomori no lo guarda como memoria a largo plazo, se olvidará una vez que quede fuera de la ventana de mensajes. |
| Olvidó algo en otro canal | **Mensajes recientes** es por canal. Solo `Memorias del servidor`, **Participantes de la conversación** y `Memoria a corto plazo` cruzan entre canales. La memoria a corto plazo remedia esto cargando mensajes recientes de otros canales, pero no vuelca todo. |
| `/refresh` la hizo olvidar | Refresh corta los **Mensajes recientes** y limpia la `Memoria a corto plazo` de este canal, pero no debería eliminar la memoria a largo plazo. Elimina el embed de refresh para quitar el corte. |
| Olvidó algo después de un reinicio | **Mensajes recientes** nunca sobrevive a los reinicios |

Si quieres que algo sobreviva a todo lo anterior, tiene que convertirse en una **memoria a largo
plazo**. Consulta [Memoria](/es-419/features/knowledge/memory/#long-term-memory).

## Consejos y trucos

- `/config` > Motor > General amplía la ventana de conversación (20-100 mensajes). Más
  contexto, más tokens por respuesta.
- `/config` > Motor > General inyecta un recordatorio breve a una profundidad elegida. Como se
  ubica bajo en el paquete, cerca de los mensajes recientes, es más probable que actúe según él
  que según algo en el prompt del sistema. Este es el mejor lugar para animarla a guardar
  memorias con más frecuencia.
- `/personal memories` y `/memories` escriben directamente en `Memorias del servidor` y
  **Participantes de la conversación**, lo cual es una de las formas garantizadas de hacer
  permanente el conocimiento en el contexto de TomoriBot.
