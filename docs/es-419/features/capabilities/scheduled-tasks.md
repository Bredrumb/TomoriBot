---
title: "Tareas programadas"
sidebar:
  order: 2
---

Configura recordatorios para ti o programa anuncios recurrentes sin salir del chat. Pregúntale directamente al bot y ella creará la programación por ti. Las tareas programadas pertenecen a la persona activa.

Los recordatorios notifican al usuario objetivo cuando se activan, mientras que las tareas automáticas son acciones que la persona realiza por su cuenta a la hora programada.

## Crear una tarea

Dile qué programar en el chat:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
on the 31st of every month, remind me to pay rent
```

Ella analiza la hora solicitada y la recurrencia. Los recordatorios mencionan al usuario objetivo cuando se activan. Las tareas son acciones silenciosas que la persona lleva a cabo cuando llega el momento.

Una programación puede repetirse cada pocas horas o cada pocos meses. Una mensual mantiene el mismo día y hora. En un mes que no tenga ese día, se ejecuta el último día del mes (el 30 de abril para el 31) y vuelve al 31 el mes siguiente.

## Zonas horarias

Las horas absolutas (como "a las 14:30" o "el viernes a las 8 p.m.") utilizan la zona horaria del servidor (`/config` > `Comportamiento` > `Comportamiento general`) de forma predeterminada. Si configuras tu propia zona horaria con `/personal config`, el bot convierte tu hora local automáticamente. "recuérdamelo a las 9 a. m." significa tus 9:00 a. m., incluso si el servidor está en otra zona horaria. Los tiempos relativos (como "en 2 horas") no dependen de zonas horarias y siempre son seguros.

Cuando un recordatorio se dirige a un usuario cuya zona horaria personal difiere de la del servidor, la confirmación muestra ambos relojes: la hora del servidor y la hora local del destinatario. Si una hora está mal etiquetada, corrígela con un mensaje de seguimiento o `/scheduled-task edit`.

## Administrar tareas

Dos comandos de barra te permiten revisar y ajustar las programaciones existentes:

- `/scheduled-task edit`: cambia el contenido de una tarea, la próxima hora de activación, el intervalo de repetición (en horas o meses) o el objetivo del recordatorio. Establece el intervalo en `0` para que una tarea recurrente sea de una sola vez.
- `/scheduled-task remove`: elimina un recordatorio o tarea.

Ambos comandos abren un selector que enumera tus programaciones existentes por persona, hora, canal y recurrencia.

:::tip
Los miembros con `Gestionar servidor` ven todas las programaciones del servidor, y las entradas de otros miembros muestran a su creador. Todos los demás solo ven las suyas.

Pedirle a TomoriBot en el chat que elimine una programación sigue la misma regla: puedes eliminar las que tú creaste o las que te recuerdan a ti, y los miembros con `Gestionar servidor` pueden eliminar cualquiera.
:::

Un servidor puede almacenar hasta 100 recordatorios y tareas pendientes a la vez. Cuando esté lleno, TomoriBot te avisará en lugar de agregar otro; elimina los anteriores con `/scheduled-task remove` para liberar espacio.

## Cómo se entregan

Los recordatorios solo se marcan como completos después de que la entrega se realiza correctamente. Si se interrumpe la entrega, TomoriBot vuelve a intentarlo automáticamente sin alterar el cronograma recurrente.

Si la entrega falla repetidamente y alcanza el límite de reintentos, TomoriBot publica una advertencia con el contenido programado y el ID de la tarea. Los recordatorios de usuario fallidos hacen ping al objetivo para que no se pierda el recordatorio, mientras que las tareas automáticas fallidas no envían ping. Luego se eliminan las programaciones únicas, mientras que las programaciones recurrentes permanecen activas para la próxima aparición y se pueden administrar con `/scheduled-task edit` o `/scheduled-task remove`.

---

Para obtener más capacidades, consulta [Herramientas y extensiones](/features/capabilities/tools-and-extensions/built-in-tools/).
