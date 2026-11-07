---
title: "Decaimiento de memoria"
sidebar:
  order: 2
aiGenerated: false
---

Imagina las [memorias a largo plazo](/features/knowledge/memory/long-term-memory/) de una persona como notas sobre un escritorio. Ella vuelve a leer cada nota del escritorio antes de cada respuesta, por lo que un escritorio lleno hace que cada respuesta sea más larga y costosa. El decaimiento de memoria traslada a un cajón las notas que nadie ha necesitado en un tiempo. No se tiran a la basura: cuando la conversación toca una nota del cajón, ella la vuelve a sacar. Esta documentación llama a las notas del escritorio *activas* y a las notas del cajón *en reposo*.

El decaimiento requiere un modelo de incrustación (embedding); consulta [Proveedores y modelos](/features/setup-administration/providers-and-models/). Sin uno, cada memoria permanece activa.

## Cómo una memoria entra en reposo y regresa

1. Cada memoria tiene un contador de días sin usar. Comienza en 0.
2. En cada respuesta, TomoriBot ejecuta una búsqueda. Convierte el mensaje más reciente en una incrustación (una lista de números que describe su significado; consulta [Cómo funciona la búsqueda](/features/knowledge/memory/documents/#how-search-works)) y la compara con cada memoria que pueda usar en esa conversación.
3. Hasta 3 de las coincidencias más cercanas, entre memorias personales y del servidor, cuentan como usadas si son una coincidencia razonable. Sus contadores vuelven a 0.
4. Cualquier otra memoria en esa búsqueda suma un día. Esto ocurre como máximo una vez al día (UTC), sin importar cuántos mensajes se envíen.
5. A los 7 días contados, la memoria entra en reposo. Ya no se envía con cada respuesta, pero permanece guardada y disponible para búsquedas.
6. Cuando un mensaje posterior coincide con una memoria en reposo, ella la agrega a esa respuesta y su contador se restablece, por lo que vuelve a estar activa.

Estar activa es diferente de estar en uso. Una memoria permanece activa solo mientras siga siendo una de las principales coincidencias para algún mensaje.

Solo cuentan los días en que la búsqueda tiene éxito. Un día sin conversación, o una respuesta donde la búsqueda falla, no cambia nada, por lo que ninguna memoria entra en reposo simplemente porque pase el tiempo.

### Ejemplo

Una memoria del servidor, "El gato de Juno se llama Mochi":

| Días de chat | Qué sucede | Contador | Estado |
|---|---|---|---|
| El día que se guarda | Guardada | 0 | Activa |
| Los siguientes 6 días de chat | Charlas sobre videojuegos; Mochi nunca sale en el tema | 6 | Activa |
| Una semana tranquila | Nadie habla | 6 | Activa, pausada |
| El siguiente día de chat | Otra charla sin Mochi | 7 | En reposo |
| Un día de chat posterior | Juno pregunta "¿cómo está Mochi?" | 0 | Recordada para esa respuesta, luego activa |

## Qué conversaciones cuentan

Las memorias del servidor envejecen en los días en que la persona habla en ese servidor. Las memorias personales se buscan únicamente cuando su propietario participa en la conversación, por lo que envejecen solo en esos días. Bau visita el servidor una vez al mes, por lo que las memorias de Bau necesitan 7 visitas donde nunca salgan a colación antes de entrar en reposo, y los días concurridos de los usuarios habituales no las desgastan.

Las memorias ocultas por ajustes de privacidad, listas de bloqueo, límites de canal o etiquetas nunca se buscan, por lo que no envejecen ni regresan.

## Cuando la memoria está llena

Cada persona almacena 100 memorias del servidor y 100 memorias personales por defecto. Cuando TomoriBot guarda una memoria nueva en una lista llena, olvida una memoria en reposo para hacer espacio. Una memoria que nunca tuvo coincidencias sale primero, seguida de la que coincidió hace más tiempo. La confirmación muestra lo que se guardó y lo que se olvidó, respetando la configuración de visibilidad de avisos de memoria del servidor.

Ella nunca olvida:

- una memoria personal Global
- una memoria que alguien haya agregado o editado con `/memories` o `/personal memories`

Las memorias importadas no están protegidas. Para proteger una, edítala y guárdala una vez con `/memories` o `/personal memories`. Una memoria protegida aún puede entrar en reposo y regresar mediante búsqueda; la protección solo evita que sea olvidada.

Si ninguna memoria califica, o la búsqueda no está disponible para esa respuesta, el guardado se rechaza.

## Las instrucciones pertenecen a otro lugar

Una memoria como "Responde siempre a Juno en español" rara vez coincide con lo que la gente dice, por lo que puede entrar en reposo y dejar de aplicarse. Coloca las instrucciones que siempre deben aplicarse en los [atributos de persona](/features/chatting-personality/multiple-personas/#attributes), en el prompt de la persona o en una [entrada de lorebook Siempre activa](/features/knowledge/memory/lorebooks/).

## Costo y almacenamiento en caché del prompt

La búsqueda representa una solicitud de incrustación por respuesta, compartida con la búsqueda de [documentos](/features/knowledge/memory/documents/). Las memorias recordadas se colocan cerca del final del prompt, junto a los documentos, para que el inicio del prompt permanezca idéntico entre respuestas. Los proveedores ofrecen descuentos por inicios de prompt repetidos, por lo que el recuerdo conserva ese descuento. El inicio solo cambia en una respuesta posterior a que una memoria pase de activa a en reposo o viceversa.

## Desactivar el decaimiento

Quienes se autoalojan pueden configurar `MEMORY_DECAY_ENABLED=false` para desactivar el decaimiento en toda la instalación. Cada memoria permanecerá activa, nada se olvidará para hacer espacio y una lista llena rechazará nuevos guardados. La búsqueda de documentos seguirá funcionando. El decaimiento también requiere la extensión de base de datos `pgvector`; consulta [Instalación manual](/self-hosting/manual-setup/#pgvector--documentrag-memory).
