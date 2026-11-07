---
title: "Memoria a largo plazo"
sidebar:
  order: 1
aiGenerated: false
---

Las memorias a largo plazo son datos breves que TomoriBot conserva hasta que alguien los elimina.
Sobreviven a `/refresh` y a los reinicios. Ella también recuerda mediante
[Documentos](/features/knowledge/memory/documents/),
[Lorebooks](/features/knowledge/memory/lorebooks/) y
[Memoria a corto plazo](/features/knowledge/memory/short-term-memory/); `/memories` tiene una pestaña para cada uno.
Para la personalidad y el comportamiento, consulta
[Múltiples personas](/features/chatting-personality/multiple-personas/).

## Memorias personales y del servidor
<!-- anchor: personal-vs-server-memories -->

Las memorias personales son datos sobre ti. Te siguen a través de los servidores y se usan cuando
participas en una conversación. Las memorias del servidor contienen información para todos en ese servidor.

Cada persona tiene sus propias memorias personales y del servidor. Una memoria personal agregada en la página
Global de `/personal memories` se aplica a todas las personas. Gestiona las memorias personales con
`/personal memories` y las memorias del servidor con `/memories`.

Los servicios de proxy de mensajes compatibles permiten que TomoriBot mantenga memorias personales
independientes para identidades de proxy verificadas. La cuenta anfitriona de Discord controla la privacidad
y la autorización. Consulta [Compatibilidad con proxy de mensajes](/features/integrations/message-proxy-support/)
para ver la configuración y las limitaciones.

## Guardar memorias

Puedes guardar memorias tú mismo, o TomoriBot puede decidir guardarlas durante una conversación. Cuando ella
guarda una, publica un embed confirmando lo que aprendió. Sin esa confirmación, la información permanece
en el historial de conversación en lugar de la memoria a largo plazo.

Si quieres que guarde algo, pídele que lo recuerde o agrégalo tú mismo. Los administradores del servidor
pueden desactivar el guardado automático en `/config` > `Permisos`.

## Límites de memoria
<!-- anchor: how-many-memories -->

Cada persona puede almacenar 100 memorias personales y 100 memorias del servidor por defecto. Las memorias
personales globales cuentan para el límite personal de cada persona. Quienes se autoalojan pueden cambiar los límites
con `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` y `MAX_MEMORY_LENGTH`.

:::tip
Prefiere más memorias cortas en lugar de menos memorias largas. Una memoria que usa un `MAX_MEMORY_LENGTH` elevado
se envía completa cada vez que está activa, mientras que las ranuras adicionales en `MAX_PERSONAL_MEMORIES` y
`MAX_SERVER_MEMORIES` no cuestan nada hasta que se llenan. Los textos de referencia largos pertenecen a un
[documento](/features/knowledge/memory/documents/), el cual se busca en lugar de enviarse completo.
:::

### Decaimiento de memoria

Con un modelo de incrustación configurado, una memoria que pasa 7 días contados de conversación sin coincidir
con la charla entra en reposo: permanece guardada pero sale del prompt habitual hasta que un mensaje posterior la
trae de vuelta. Cuando la lista está llena, un guardado automático puede olvidar una memoria en reposo, pero nunca
una memoria personal Global ni una que alguien haya agregado o editado con `/memories` o `/personal memories`.
Consulta [Decaimiento de memoria](/features/knowledge/memory/memory-decay/).

Para instrucciones que siempre deben aplicarse, usa
[atributos de persona](/features/chatting-personality/multiple-personas/#attributes), el prompt de la persona
o una [entrada de lorebook Siempre activa](/features/knowledge/memory/lorebooks/).

## Controlar cuándo se activan las memorias
<!-- anchor: controlling-when-memories-activate -->

Las memorias activas se incluyen cuando su propietario y alcance coinciden con la conversación. Las memorias en
reposo regresan mediante búsqueda cuando son relevantes. Las restricciones de canal delimitan dónde se aplican,
y las memorias personales también pueden usar etiquetas de palabras clave.

### Etiquetas de memorias personales
<!-- anchor: keyword-tags -->

Las memorias personales pueden llevar etiquetas de palabras clave o `#canal`. Activa el etiquetado en `/config` >
`Comportamiento` > `Memoria avanzada`. Cuando está activado, una memoria personal etiquetada aparece solo cuando
una de sus palabras clave está en la conversación, y una no etiquetada permanece activa. Una etiqueta `#canal` la
limita a ese canal. Usa `/tool prompt snapshot` para ver qué memorias están activas.

Las memorias del servidor ya no usan etiquetas de palabras clave. El lore creado pertenece a
[Lorebooks](/features/knowledge/memory/lorebooks/), donde las palabras clave y Siempre activa se configuran por entrada.

### Canales

Las memorias del servidor y los documentos pueden limitarse a canales seleccionados y a sus hilos. Las memorias personales
usan una etiqueta `#canal`. Las entradas de lorebook también admiten una selección de canales.

Las etiquetas `#canal` antiguas de memorias del servidor y documentos se convirtieron en selecciones de canales. Si un
canal etiquetado ya no existe, el elemento permanece activo en todos los canales; `/memories` identifica estos
elementos para que puedas elegir canales nuevos.

## Condicionamiento
<!-- anchor: conditioning -->

El condicionamiento orienta el comportamiento de una persona en un servidor. Las recompensas y castigos otorgados
a una persona con un motivo se convierten en condicionamiento sobre el cual ella puede actuar. Las interacciones sin
un motivo se contabilizan pero no aparecen en su prompt. Revisa o borra el condicionamiento con `/conditioning`.

Las interacciones juguetonas también permiten que las personas recompensen o castiguen a usuarios y a otras personas.
Las interacciones con usuarios no guardan condicionamiento; las interacciones con personas pueden motivarlas a responder.
Los administradores del servidor pueden desactivar la herramienta en `/config` > `Plugins` > `Herramientas disponibles`.

## Privacidad

Para conocer qué almacena TomoriBot y cómo exportarlo o eliminarlo, consulta
[Manejo de datos](/features/knowledge/data-handling/) y `/legal privacy-policy`. Puedes optar por no participar
en la memoria con `/personal config`.
