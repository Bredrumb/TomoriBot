---
title: "NovelAI"
sidebar:
  order: 4
aiGenerated: true
---

NovelAI conecta modelos de texto (`GLM 4.6`, `Xialong`, `Kayra`, `Erato`) y generación de imágenes de anime. Puedes usar NovelAI para ambos, o combinar su generación de imágenes con otro proveedor de chat.

## Modelos de texto y suscripción
<!-- anchor: text-models-and-subscription -->

`GLM 4.6` es el modelo de texto predeterminado. `Xialong` y `Erato` requieren una suscripción activa a Opus. Al seleccionar `Xialong`, se comprueba tu clave guardada del servidor o personal; si lo seleccionas antes de agregar una clave, la comprobación se ejecuta al agregar la clave. La suscripción de la clave utilizada determina el espacio de contexto permitido. Los administradores del servidor pueden comprobar la cuota de generación de Opus con `/novelai usage`.

La [guía de formato de chat](https://docs.novelai.net/en/text/chatformat/) de NovelAI describe el enfoque de estilo historia utilizado para `Kayra` y `Erato`; `GLM 4.6` y `Xialong` utilizan plantillas de chat independientes. El filtrado y el pulido a continuación son las adaptaciones de TomoriBot.

## Preajustes de muestreo
<!-- anchor: sampling-presets -->

Cambiar de modelo de texto carga `Carefree-Kayra`, `Erato-Shosetsu` o `Default-Xialong` para el modelo seleccionado; `GLM 4.6` utiliza sus propios valores predeterminados. El cambio restablece la temperatura, top-k, top-p y min-p, y habilita esos muestreadores tanto para cambios de modelo del servidor como personales. Cambia los preajustes o muestreadores en `/config` > `Modelos` > `Muestreadores de texto y parámetros`; las modificaciones posteriores permanecen activas, y reemplazar una clave en el mismo modelo las conserva.

## Contexto y configuración
<!-- anchor: context-and-settings -->

Las configuraciones omitidas se mantienen guardadas en `/config` > `Comportamiento` > `Comportamiento general` para otros proveedores.

| Contenido o configuración | Manejo de NovelAI |
|---|---|
| Atributos de la persona, diálogos de ejemplo, conversación y memorias | Se conservan, incluidas las memorias personales y a corto plazo visibles. Los filtros de privacidad y de etiquetas de memoria siguen aplicándose. |
| Prompts del sistema, de persona y de canal; notas de contexto; reglas del humanizador; condicionamiento; instrucciones de SillyTavern | Omitidos. Xialong utiliza el prompt del sistema de NovelAI; GLM, Kayra y Erato no tienen bloque del sistema. |
| Estado, información de hora/canal/servidor, documentos e inventarios de emojis/stickers/sprites | Omitidos. |
| Avisos de herramientas de memoria | Omitidos, incluidos los avisos generados antes de un ajuste personal o un modelo de respaldo. |
| Metadatos de ATTG y estrellas de calidad | ATTG significa Autor, Título, Etiquetas y Género. Xialong coloca los metadatos primero en su información persistente y utiliza 4 estrellas de forma predeterminada. Erato utiliza las estrellas configuradas; Kayra omite las estrellas. |
| Prellenados de respuesta | Se conservan cuando los controles de prellenado lo permiten. |
| Herramientas y medios | Sin llamadas a herramientas de modelos de texto ni entrada de imágenes/videos. Los comandos de barra y los comandos independientes de generación de imágenes siguen estando disponibles. |
| Límites de tokens | Se cuentan localmente reservando espacio para las respuestas. La longitud de respuesta configurada tiene prioridad sobre la del preajuste y puede reducirse para ajustarse. |

Las etiquetas de interlocutores externos conocidos y las líneas aisladas de `---` o `***` detienen la salida, incluso con la configuración compartida de detención de interlocutor desactivada. Los nombres, alias y etiquetas de sprites de la persona que responde siguen estando permitidos. La protección local preserva el código; las secuencias literales de detención de la API aún pueden coincidir dentro del código generado.

## Recorte de contexto
<!-- anchor: context-trimming -->

Las memorias utilizan hasta el 20% de la ventana de contexto, eliminando primero las entradas más antiguas. Si el prompt aún no cabe, TomoriBot lo recorta en este orden:

| Orden | Contenido eliminado | Contenido protegido |
|---|---|---|
| 1 | Diálogos de ejemplo adicionales | Un intercambio de ejemplo disponible |
| 2 | Memorias, las entradas más antiguas primero | Sin mínimo |
| 3 | Historial de conversación antiguo | Hasta dos intercambios de historial recientes |

Los atributos de la persona, los metadatos de ATTG y el turno actual también permanecen protegidos. La generación falla si el contexto protegido no puede caber. El recorte deja las memorias y los mensajes guardados sin cambios.

`/tool prompt snapshot` muestra el prompt final, los recuentos de tokens, el límite de respuesta y el informe de recorte.

## Pulido de texto y entrega en Discord
<!-- anchor: text-polishing-and-discord-delivery -->

El pulido cambia únicamente la copia del historial, las memorias y los diálogos de ejemplo enviados a los cuatro modelos de NovelAI, antes del conteo de tokens. El texto guardado y los demás proveedores no cambian; la gramática no se reescribe.

- **El texto se escribe con mayúsculas correctamente**: los inicios de oraciones y líneas en alfabeto latino se ponen en mayúscula; los nombres de personas conocidos usan sus mayúsculas y minúsculas configuradas.
- **Las líneas de prosa reciben puntuación**: se añaden puntos finales ausentes mientras la puntuación existente, los saltos de línea y las líneas en blanco se mantienen.
- **La prosa formateada se pule**: `*kisses juno*` se convierte en `*Kisses Juno.*`. Las negritas, subrayados, tachados y spoilers siguen las mismas reglas; el énfasis dentro de una línea mantiene sus mayúsculas y minúsculas excepto para los nombres.
- **El código y el marcado se conservan**: el código, las URL, las menciones, el formato de Discord, las listas, los encabezados, las citas, las tablas y los separadores conservan su contenido o estructura.
- **Se respetan los inicios y finales que no son prosa**: las líneas que comienzan con bloques de código, URL, menciones, emojis o letras no latinas omiten el formato de oraciones. Los finales con emojis, kaomojis, código o enlaces no reciben un punto adicional.
- **Las memorias a largo plazo usan contenido sin formato**: las etiquetas de propietario añadidas, los ID de base de datos y los prefijos de etiquetas se omiten; los nombres resueltos se conservan.
- **Se eliminan las anotaciones de historial generadas**: se omiten las referencias de respuesta, los metadatos de reacciones y los avisos administrativos. Los gestos se convierten en acciones; las escenas y los resúmenes pierden su envoltorio del sistema. El texto literal del usuario que contiene `System:` se conserva.
- **Los prellenados se mantienen exactos**: los prellenados de respuesta explícitos y los fragmentos de continuación no se modifican.
- **La entrega en Discord sigue tu configuración**: el humanizador sigue controlando las mayúsculas, la puntuación y la división de mensajes. El historial posterior se vuelve a pulir; la puntuación perdida no se puede recuperar con exactitud.

## Generación de imágenes
<!-- anchor: image-generation -->

Asigna un modelo a la ranura `Imagen NovelAI` en `/config` > `Modelos` > `Cambiar modelos`. Los miembros pueden generar imágenes directamente con `/novelai generate image`, o pedirlo en el chat cuando el proveedor de texto activo admita llamadas a herramientas.

El preajuste `Default + Image Generation Expert` utiliza etiquetas de estilo imageboard para NovelAI, con descripciones breves cuando sea necesario para interacciones o ubicación de texto. Para escenas con múltiples personajes, TomoriBot mantiene el escenario compartido y las indicaciones de cámara separados de la apariencia y las acciones de cada personaje.

Para un diálogo legible, pídele a TomoriBot que incluya el diálogo exacto. La herramienta de imagen de NovelAI coloca el diálogo del personaje en una sección final `Text:` automáticamente. V4 y V4.5 admiten texto en inglés; V5 también admite japonés y chino. El texto en letreros o pantallas se puede describir en el prompt del escenario compartido. Mantén breve el texto solicitado y evita `no text` entre las etiquetas positivas. La ubicación y la tipografía (incluida la escritura vertical en japonés) son sugerencias y no garantías.
