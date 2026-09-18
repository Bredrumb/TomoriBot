---
title: "Ajuste del comportamiento"
sidebar:
  order: 3
---

El comportamiento de TomoriBot, **lo que puede hacer y cómo genera sus respuestas**, se controla desde
`/config` > Permisos y `/config`, además de la personalidad ([Múltiples personas](/es-419/features/chatting-personality/multiple-personas/))
y el conocimiento ([Memoria](/es-419/features/knowledge/memory/)). Esta página reúne los controles más importantes.
Todos los comandos están en la [Referencia de comandos](/en/features/command-reference/).

## Capacidades: lo que puede hacer

`/config` > Permisos activa y desactiva sus funciones: generación de imágenes, uso de stickers, creación
de hilos, administración de mensajes, bloqueo de usuarios, autoaprendizaje, mensajes de voz y más. Cada
interruptor es la marca de función que habilita la herramienta correspondiente (consulta [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/)).
Desactiva algo y no podrá hacerlo, sin importar lo que le pida un usuario.

## Ajuste de generación

- `/config` > Modelos > Muestreadores y parámetros de texto: parámetros de muestreo (temperatura, top-p, …), creatividad y aleatoriedad. Una temperatura más alta produce mayor variedad.
- `/config` > Motor > General: qué tan humanas se leen sus respuestas. La opción `scope` aplica el grado a todo el servidor (`Global`, el valor predeterminado) o a una sola persona (`Persona`). Es útil cuando una persona debe escribir de forma casual con grado 3 y otra como una novela. La opción "Heredar" de una persona elimina su excepción.
- `/config` > Motor > General: cuántos mensajes recientes incorpora como contexto por activación. Súbelo para obtener más consciencia conversacional o bájalo para reducir el costo de tokens.

## Prompt del sistema

El prompt del sistema está por encima de la persona y determina el comportamiento general:

- `/config` > Motor > General: establece una instrucción de sistema personalizada de hasta 16.000 caracteres.
- `/config` > Motor > General: elige entre prompts del sistema preestablecidos.
- `/config` > Motor > General: restablécelo al valor predeterminado. La confirmación muestra el prompt que acaba de quitar, para que puedas copiarlo si lo eliminaste por accidente.

Cuando hay un [preajuste de SillyTavern](/es-419/features/integrations/sillytavern-support/) activo, el prompt del sistema de respaldo integrado se reemplaza, pero el personalizado que establezcas aquí se sigue enviando.

## Salida sin censura

TomoriBot **no tiene un filtro de contenido propio**. No es un sistema de moderación ni añade barreras de
seguridad sobre el modelo. Lo que devuelve el proveedor subyacente es lo que dice. Por eso `/nsfw jailbreaks`
no "desbloquea" nada dentro de TomoriBot. Solo sirve para sortear filtros del **proveedor** más estrictos de lo que quieres.

Activa tres técnicas independientes, todas desactivadas por defecto:

- **Inyección de prompt**: añade al contexto un bloque de instrucciones de jailbreak para orientar al modelo y evitar rechazos innecesarios.
- **Espacios Unicode**: cambia los espacios normales por espacios Unicode parecidos para que los filtros de palabras o tokens no detecten ciertas frases, tanto en el texto enviado al modelo como en su respuesta.
- **Sanitizar**: ofusca un conjunto de palabras sensibles por el mismo motivo, tanto en la solicitud como en la respuesta.

Ninguna cambia lo que el modelo *puede* hacer. Solo reduce la frecuencia con que un filtro demasiado
entusiasta bloquea una respuesta normal. Algunas opciones tienen restricción de edad. Consulta [Comandos con restricción de edad](/es-419/features/setup-administration/age-restricted-commands/).

## Apariencia y hora

- `/config` > Persona > Identidad y personalidad: cómo se llama a sí misma.
- `/config` > Motor > General: la zona horaria del servidor, usada para respuestas y recordatorios conscientes de la hora.

---

¿Buscas controles de administración y costos (cuotas, listas permitidas, BYOK) en lugar de comportamiento?
Están en [Moderación del servidor](/es-419/features/setup-administration/server-moderation/).
