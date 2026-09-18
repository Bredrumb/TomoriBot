---
title: "Tareas programadas"
sidebar:
  order: 2
---

TomoriBot puede establecer recordatorios y programar tareas para después, puntuales o recurrentes. La
forma más fácil es **pedírselo**. Ella crea la tarea mediante su herramienta `create_task`.
Las tareas programadas son específicas de cada persona.

Cada persona mantiene sus tareas propias pendientes en el contexto cuando responde, sin importar
qué miembros aparecen en la conversación reciente. Los recordatorios dirigidos a personas son más
selectivos: la persona destinataria debe estar presente o mencionada en el contexto activo, y el
recordatorio debe pertenecer a la persona activa.

## Crear una tarea

Solo díselo en el chat:

```text
recuérdame enviar el informe a las 14:30
cada viernes a las 8 p. m., publica un recordatorio de que empieza la noche de juegos
```

Ella interpreta la hora y la recurrencia y la programa. Los recordatorios **mencionan a la persona
destinataria** al activarse. Las tareas son acciones propias silenciosas que la persona ejecuta a la hora programada.

## Zonas horarias

Las horas absolutas ("a las 14:30", "el viernes a las 8 p. m.") se interpretan por defecto en la **zona
horaria del servidor** (`/config` > Motor > General). Si estableciste una zona horaria personal con
`/personal config`, la IA ve tu hora local en el contexto y etiqueta tus horas con tu desplazamiento UTC
al crear la tarea. El bot hace la conversión de forma determinista, así que "recuérdame a las 9 a. m."
significa tus 9 a. m., aunque el servidor esté en otro continente. Las horas relativas ("en 2 horas")
no dependen de la zona horaria y siempre son seguras.

Cuando un recordatorio tiene como destinataria a una persona cuya zona horaria personal difiere de la
del servidor, el embed de confirmación muestra **ambos relojes** (la hora del servidor y la hora local de
la persona destinataria), para que una hora mal etiquetada sea visible de inmediato y puedas corregirla
con otro mensaje o con `/scheduled-task edit`.

## Administrar tareas

Dos comandos de barra te permiten revisar y ajustar programas existentes:

- `/scheduled-task edit`: cambia el contenido, la próxima hora de activación, el intervalo de recurrencia o si es un recordatorio. Establece el intervalo en `0` para desactivar la recurrencia.
- `/scheduled-task remove`: elimina un recordatorio o una tarea.

Ambos abren un selector con tus programas existentes (persona, hora, canal y recurrencia), así que no
necesitas recordar los identificadores.

## Cómo se entregan

Los recordatorios se entregan mediante un programador dentro de la aplicación y solo se marcan como
completados **después de que la entrega tiene éxito**. Si una entrega se interrumpe o se vacía la cola
del canal, se reintenta automáticamente. Los retrasos de reintento no cambian la cadencia recurrente original.

Los intentos automáticos no publican un mensaje de error cada vez. Si la entrega sigue fallando después
del límite de reintentos, TomoriBot publica una advertencia con el contenido programado sin cambios y su
identificador. Los recordatorios humanos fallidos mencionan a la persona destinataria para que no se pierdan;
las tareas propias fallidas no mencionan a nadie. Los programas puntuales se eliminan, mientras que los
recurrentes siguen activos para la siguiente ocurrencia original y se pueden administrar con
`/scheduled-task edit` o `/scheduled-task remove`. Para conocer los detalles de ejecución, consulta la
[descripción general de la arquitectura](/en/architecture/#runtime-extensions).

---

La programación es una de varias capacidades agénticas. Consulta [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/) para conocer el panorama completo.
