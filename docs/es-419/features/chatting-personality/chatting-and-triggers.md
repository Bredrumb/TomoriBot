---
title: "Chat y activadores"
sidebar:
  order: 1
---

TomoriBot solo responde cuando algo la activa. Esta página explica las formas de activarla, cómo chatear
sin manos con la activación automática y cómo evitar activaciones accidentales con el modo de activación deliberada.

## Cómo activarla

Por defecto, responde cuando tú:

- **La mencionas**: `@TomoriBot`
- **Respondes** a uno de sus mensajes (incluido el mensaje de webhook de una persona)
- **Usas una palabra de activación**: cualquier palabra sencilla que hayas registrado, dicha en cualquier parte del mensaje
- **Usas `/respond`**: solicita una respuesta manualmente

Las palabras de activación son la forma más cómoda. Una vez registrada una palabra, basta con mencionarla
para activarla. En un mensaje directo, solo salúdala. No necesitas un activador.

### Administrar palabras de activación

Los administradores del servidor usan `/config` > Persona > Activadores para añadir o eliminar palabras de
activación de la persona seleccionada. Los miembros comunes pueden consultar la página, pero los controles
de modificación están desactivados.

## Expresiones y reacciones

Cuando responde, puede usar los emojis y stickers personalizados de tu servidor y reaccionar a mensajes:

- Los emojis personalizados se usan naturalmente en la conversación con la sintaxis `:name:` sin distinguir mayúsculas de minúsculas.
- Los stickers pueden acompañar las respuestas. También puede añadir reacciones con emojis.
- Ejecuta `/expressions initialize` para registrar los emojis y stickers de tu servidor y que los use con precisión.

## Canales de roleplay

Los canales de roleplay suprimen el uso de emojis personalizados y stickers en sus respuestas. Allí las
personas también pueden usar `/tool delete turn` para eliminar su último turno sin el permiso Administrar servidor.

Configura los canales desde la página Reglas de canal en `/config`.

## Consciencia situacional

Además del texto del mensaje, recibe una instantánea del contexto de Discord cada vez que responde. Así
puede hablar de *dónde* y *cuándo* ocurre la conversación, no solo de lo que se dijo. Este contexto incluye:

- **Dónde está**: el nombre y la descripción del servidor actual (o que es un mensaje directo) y el canal actual.
- **La hora actual**: la hora local del servidor y una aproximación del momento del día, según `/config` > Motor > General, además de la hora local de cada persona si configuró `/personal config`.
- **Quién participa en la conversación**: nombres visibles, cómo mencionarlos, etiquetas de apariencia física y recordatorios pendientes.
- **Qué está haciendo alguien (presencia)**: la actividad de Discord de un usuario: lo que está **jugando**, **transmitiendo**, **escuchando** (por ejemplo, una canción y artista de Spotify), **viendo** o su estado personalizado.

La presencia depende de la privacidad: solo se comparte para usuarios con el nivel de privacidad **Mínimo**
(el valor predeterminado; consulta `/personal config`) y cuando el bot tiene activada la intención de Discord
**Guild Presences**. Los usuarios que aumentan su privacidad o las instancias con autoalojamiento que no
tienen esa intención simplemente no mostrarán su actividad.

## Activación automática (chat sin manos)

La activación automática le permite unirse a la conversación sin que la mencionen.

- `/server autotrigger channels`: establece los canales donde responde sin una mención.
- `/server autotrigger threshold`: establece cuántos mensajes se acumulan antes de que intervenga.
- `/config` > Comportamiento > Activador: añade una activación automática probabilística basada en un temporizador a un canal.
- `/config` > Comportamiento > Activador: elimina una activación aleatoria existente.
- ~~`/natres`: tiempos humanos para respuestas autónomas~~ por implementar

Úsalo en un canal de chat dedicado donde quieras que se sienta como una participante y no como una asistente invocada.

## Modo de activación deliberada

Si las personas dicen mucho el nombre de una persona en conversaciones normales, las palabras de activación
simples pueden activarla por accidente. El **modo de activación deliberada (DTM)** lo evita al hacer que las
palabras de activación simples dejen de contar como un activador explícito.

Cuando DTM está activado:

- `@{trigger}` (la palabra de activación con el prefijo de una mención) sigue funcionando
- Las menciones de Discord siguen funcionando
- Las respuestas siguen funcionando
- `/respond` sigue funcionando
- **Las palabras de activación simples ya no la activan**

Esto obliga a invocarla deliberadamente en lugar de activarla por accidente.

### Control del servidor y personal

- `/server dtm`: los administradores del servidor cambian el comportamiento general.
- `/personal config`: cada usuario lo cambia para sí mismo, con tres modos:
  - **off**: siempre permite palabras de activación simples
  - **follow**: usa la configuración del servidor
  - **on**: siempre exige una invocación deliberada

En `/help`, elige **Comportamiento** y luego **Modo de activación deliberada** para ver el mismo resumen en Discord.

:::note
No confundas el **modo de activación deliberada** (esta página, controla *cómo se activa*) con el **modo de
herramientas deliberado**, que controla *qué herramientas se exponen al modelo* en un turno. Comparten la
abreviatura "DTM", pero no tienen relación. Consulta [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::
