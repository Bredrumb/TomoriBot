---
title: "Natural Nudges"
description: "Permite que tus personas de TomoriBot inicien conversaciones cuando un canal de Discord quede en silencio y se unan a aquellas que coincidan con sus intereses, a un ritmo adaptado a la actividad de tu servidor."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges permite que TomoriBot hable sin haber sido mencionada, de dos maneras:

- **Intervenciones espontáneas**: cuando un canal se queda en silencio, una de tus personas elige algo que hacer, como saludar a alguien, retomar una conversación, plantear un nuevo tema o interpretar una breve escena con otra persona, publicándolo con su propia voz.
- **Intervenciones activas**: cuando los miembros hablan sobre algo que le gusta a una persona, esa persona se une a la charla.

Las intervenciones están pensadas para sentirse como un amigo que pasa a saludar:

- **El ritmo sigue al servidor**: los servidores que hablan con TomoriBot todos los días reciben cerca de una intervención espontánea al día; los servidores que rara vez le hablan no reciben ninguna, ni tampoco intervenciones activas.
- **Espera un momento natural**: una intervención espontánea solo comienza en un canal que haya estado en silencio entre una y tres horas, durante el horario en el que tu servidor suele estar despierto.
- **Guarda silencio si nadie responde**: cada intervención espontánea sin respuesta hace que la siguiente espere más tiempo, y tras tres consecutivas sin respuesta se detiene hasta que alguien vuelva a hablarle.
- **Ante la duda, no dice nada**: si alguien publica primero, el canal se vuelve concurrido o nada encaja, la intervención se descarta.

Natural Nudges solo funciona en servidores, nunca en mensajes directos (MD).

## Intervenciones activas
<!-- anchor: active-nudges -->

Una intervención activa ocurre cuando una persona se une a una conversación que ya está en marcha porque trata sobre algo que le gusta a esa persona. Así es como se produce:

1. Mientras los miembros conversan en un canal apto, TomoriBot cuenta sus mensajes. Los hilos cuentan como parte de su canal principal, y el conteo se reinicia cada vez que habla una persona.
2. Cada cierto tiempo (más pronto en servidores activos y con mayor frecuencia para las intervenciones activas), lee los últimos cinco mensajes y evalúa si la conversación trata realmente sobre los intereses de alguna de tus personas. Una mención pasajera no cuenta.
3. La persona con ese interés responde. Si varias personas comparten el mismo interés, suele participar la que haya estado más callada últimamente, mientras que una persona que acaba de hablar cede el turno. De vez en cuando otra persona toma el turno en su lugar, con mayor frecuencia una con la que el servidor hable poco.
4. La respuesta llega entre 15 y 45 segundos después, con la personalidad habitual de la persona. Si otra persona habla antes, los miembros cambian de tema o el canal se vuelve concurrido, no dice nada.

Existe como máximo una intervención activa por canal (incluidos hilos) por hora, además de un límite diario para todo el servidor. Una persona necesita tener intereses en su página de Intervenciones para participar, y las personas en silencio nunca lo hacen.

## Intervenciones espontáneas
<!-- anchor: idle-nudges -->

Las intervenciones espontáneas esperan hasta que un canal haya estado en silencio por un tiempo, durante las horas en las que tu servidor suele estar despierto. Hay 28 intervenciones integradas en cuatro categorías. Puedes ajustarlas y añadir las tuyas para todo el servidor en `/nudge-studio`, y cada persona puede tener sus propias intervenciones espontáneas (consulta [Intervenciones espontáneas de persona](#persona-idle-nudges)).

| Categoría | Qué hace | Requisitos | Notas |
|---|---|---|---|
| <a id="ping-user"></a>Mencionar usuario | Saluda a un miembro o comparte algo que le pueda gustar. | Conversación reciente con esta persona en este servidor, una memoria y permiso para mencionar. Privacidad total, listas negras de personalización y bloqueos de persona excluyen a los miembros. | Se favorece a los contactos frecuentes; las menciones recientes reducen las posibilidades de repetición. Desactívalo en `/personal config` > `Privacidad` > `Pings de personas`. |
| Reanudar tema | Retoma una conversación que quedó pendiente. | Una conversación inconclusa. | N/A |
| Iniciar tema | Plantea algo nuevo, a menudo sobre los intereses de la persona. | Sin requisitos de categoría adicionales. | N/A |
| <a id="play-scene"></a>Interpretar escena | Inicia un breve intercambio entre dos o tres personas. | Otra persona autorizada a intervenir en ese canal. | Las personas habladoras se unen con más frecuencia; las silenciosas nunca lo hacen. Si un miembro publica, la escena se detiene y una persona le responde. Las escenas sorpresa no mencionan a su objetivo. |

### Elegir y crear intervenciones espontáneas

Abre `/nudge-studio` (requiere `Administrar servidor`) para explorar cada categoría. El punto de color muestra si una intervención está activada, si le falta un requisito o si está desactivada. Cada fila termina con su origen: `Integrada`, `Personalizada del servidor` o `Para <persona>` en caso de pertenecer a una persona. Las categorías con más de 12 filas continúan en páginas siguientes.

`Alternar disponibilidad...` elige qué personas pueden usar una intervención:

- **Todas marcadas:** cualquier persona en el canal puede usarla, incluidas las que añadas más adelante.
- **Algunas marcadas:** solo esas personas pueden usarla. Las personas nuevas quedan fuera hasta que las marques.
- **Ninguna marcada:** la intervención queda desactivada.

Una intervención que pertenece a una persona tiene una sola casilla de verificación, `Disponible para <persona>`, ya que solo su dueña puede usarla. Desmarcarla la desactiva sin eliminarla.

Limitar una intervención del servidor a una sola persona no la traslada a la página de esa persona. Sigue siendo una intervención del servidor, y solo las entradas propias de la persona viajan con su tarjeta de persona.

Debajo de la lista puedes añadir hasta 25 intervenciones propias para todo el servidor. Elegir una intervención del servidor o de una persona la abre para edición, y esa misma entrada se puede editar en la página de `Intervenciones` de la persona. Las nuevas intervenciones creadas aquí son siempre intervenciones del servidor. `Eliminar intervenciones` enumera las editables en la página actual, y desmarcar una la elimina. Cada una incluye:

- **Nombre**: la etiqueta que se muestra en el panel.
- **Instrucción**: lo que la persona se propone hacer. Escribe `{persona}` donde va su nombre, `{partner}` para la otra persona en una escena y `{target}` para el miembro involucrado.
- **Propósito oculto** (opcional): la pequeña meta personal que la persona mantiene tras su mensaje inicial.
- **Requisitos**: lo que debe cumplirse antes de ejecutarse, como un recuerdo reciente o una herramienta disponible. Una herramienta seleccionada en Requisitos ya está incluida, por lo que se quita de la lista de herramientas recomendadas al guardar.
- **Herramientas recomendadas**: herramientas que se alienta a la persona a usar cuando las tiene disponibles. La intervención se ejecuta igualmente sin ellas.

### Intervenciones espontáneas de persona
<!-- anchor: persona-idle-nudges -->

Una persona puede tener intervenciones espontáneas que correspondan a su carácter, como Rose revisando un atuendo de cosplay o Aphel recomendando un álbum. Se suman a las intervenciones integradas y del servidor y no las reemplazan.

Abre `/config` > `Persona` > `Intervenciones`. `Intervenciones espontáneas` se ubica debajo de `Intereses`:

- `Selecciona o añade una intervención espontánea...` añade una con `+ Añadir <categoría>` o edita una existente. Las cuatro categorías están disponibles, con los mismos campos que una intervención del servidor. Una persona admite hasta 20, independientemente de las 25 del servidor.
- `Alternar disponibilidad...` activa o desactiva entradas individuales para esta persona.
- `Eliminar intervenciones espontáneas` elimina las entradas que desmarques.
- `Restaurar intervenciones del preajuste` aparece para una persona que sigue un preajuste oficial y tiene su propia copia de la lista.

Cómo funcionan:

- Solo la persona propietaria las inicia. En una escena, la propietaria lidera y cualquier otra persona autorizada a intervenir puede unirse como compañera.
- Siguen los mismos requisitos, horas de silencio, nivel de frecuencia y límite diario que cualquier otra intervención espontánea. Más entradas le dan a una persona más de dónde elegir, pero no hacen que hable más a menudo.
- Los intereses guían las intervenciones activas. Las intervenciones espontáneas de persona guían únicamente las intervenciones espontáneas.

Los preajustes oficiales incluyen intervenciones espontáneas. Una persona que sigue su preajuste lee esa lista a medida que el preajuste se actualiza. La primera vez que añades, editas o eliminas una entrada, la persona obtiene su propia copia de toda la lista, y las actualizaciones posteriores del preajuste ya no la modificarán. Activar o desactivar una entrada no crea una copia. `Restaurar intervenciones del preajuste` reemplaza la lista de la persona con la lista actual del preajuste y mantiene sus intereses, locuacidad y las opciones de activación de las entradas que aún existan. `Resincronizar con preajuste` en `Identidad y personalidad` también restablece la lista y las opciones de activación.

Las tarjetas de persona (`/persona export`) incluyen las intervenciones espontáneas de la persona, ya sea del preajuste o de su propia copia, e importar la tarjeta las restaura. Las opciones de activación son locales del servidor y no se exportan, por lo que las entradas importadas comienzan activadas. Las intervenciones del servidor nunca van en una tarjeta. Una tarjeta más antigua que aún coincida con un preajuste oficial sigue las intervenciones espontáneas actuales de dicho preajuste. Otras tarjetas antiguas se importan sin intervenciones espontáneas de persona.

### Mencionar a un usuario
<!-- anchor: ping-user -->

Este tipo de intervención espontánea menciona a un miembro por su nombre, por lo que solo elige a personas que la persona realmente conoce:

- **Hablaron con esta persona recientemente**: solo se pueden elegir miembros que hayan iniciado una conversación con esa persona en este servidor en los últimos 14 días. Haber sido mencionado o nombrado en una charla no cuenta, y tener cercanía con la misma persona en otro servidor tampoco cuenta.
- **La persona los conoce**: el miembro tiene un recuerdo con esta persona de los últimos 30 días, o un recuerdo a corto plazo (STM) reciente con ella.
- **No han optado por no participar**: cualquiera puede desactivar Menciones de personas para sí mismo en `/personal config` > Privacidad. Los miembros con privacidad Completa, los miembros en la lista negra de personalización del servidor y los miembros bloqueados por la persona nunca son seleccionados.

Entre esos miembros, los más cercanos son elegidos con mayor frecuencia: cada mensaje enviado a esa persona en este servidor en los últimos 14 días, y cada canal en el que hayan conversado recientemente, suma a sus probabilidades. Alguien a quien una persona mencionó en los últimos tres días tiene menos probabilidades de ser elegido de nuevo. La mención se dirige únicamente a ese miembro individual; una intervención de mención nunca menciona roles, `@everyone` ni a nadie más. Cualquier respuesta en el canal cuenta como contestación.

### Interpretar escena
<!-- anchor: play-scene -->

Una escena es un breve diálogo entre personas, de dos a cuatro mensajes de duración. La persona que toma la iniciativa abre la escena y elige a un compañero (a veces dos) de entre las otras personas autorizadas en ese canal. Las personas más habladoras se unen con mayor frecuencia, y las personas en silencio nunca lo hacen.

- **Los miembros son lo primero**: cuando cualquiera publica en el canal durante la escena, los mensajes restantes de la escena se descartan y la persona que estaba a punto de hablar le responde, como cuando alguien se une a una conversación. Si nombraron o mencionaron a una persona en particular, esa persona responde en su lugar.
- **Los planes se mantienen en privado**: las personas pueden tramar una sorpresa inofensiva para alguien que conocen, pero la escena no menciona a ese miembro.

### Propósitos ocultos

Junto con su mensaje de apertura, cada intervención espontánea le asigna a la persona una pequeña meta privada, como "averigua a quién más le gusta este anime". La meta se mantiene vinculada sobre la apertura y solo esa persona la ve, por lo que continúa persiguiendo el objetivo en sus respuestas posteriores. En una escena cada persona recibe su propia meta, que las demás nunca ven. Una vez que el mensaje de apertura sale del contexto que la persona recuerda, la meta desaparece. Los propósitos nunca solicitan datos personales, dinero ni nada fuera del chat. Los miembros autorizados para ver la instantánea del prompt pueden consultarlos.

## Configuración

Natural Nudges está activado de manera predeterminada y no requiere configuración previa. En cuanto los usuarios de un servidor comiencen a hablar con TomoriBot con regularidad, las intervenciones espontáneas y activas comenzarán en los canales donde conversan con ella.

Para cambiar su funcionamiento, abre `/config` > Plugins > Natural Nudges (requiere Gestionar servidor):

- **Intervenciones espontáneas** e **Intervenciones activas**: activa o desactiva cada modalidad por separado.
- **Canales**: funciona de manera automática con los canales donde los usuarios hablaron con TomoriBot en los últimos 14 días (excepto canales de rol). Puedes seleccionar canales específicos manualmente o limpiar la lista para volver al modo automático. Un canal donde otros bots publiquen con frecuencia nunca queda en silencio, por lo que se ignora automáticamente.
- **Selección de modelos**: elige los dos modelos de IA que utiliza Natural Nudges. Los modelos gratuitos de Google están sujetos a los términos de uso gratuito de Google, que permiten que Google utilice las conversaciones que se les envían.
  - **Planificador de intervenciones espontáneas**: planifica las intervenciones espontáneas. Por defecto es el modelo de chat del servidor. No todos los modelos pueden realizar esta tarea; si el tuyo no puede, el panel lo indicará y te permitirá elegir otro.
  - **Verificador de intervenciones activas**: revisa las conversaciones periódicamente para ver si coinciden con algún interés. Se ejecuta con mucha más frecuencia que el planificador, por lo que un modelo pequeño y económico es el más adecuado. Por defecto TomoriBot elige uno automáticamente: un modelo de decisiones (un modelo pequeño optimizado para responder preguntas de opción única) si el servidor cuenta con una clave de OpenRouter, Gemma 4 31B si cuenta con una clave de Google, o en su defecto el Planificador de intervenciones espontáneas. Puedes seleccionar cualquiera de ellos manualmente, incluidos modelos de decisiones personalizados.

El panel muestra qué tan activo es el servidor, cuántas intervenciones espontáneas esperar cada semana y con qué frecuencia revisa las conversaciones para intervenciones activas.

### Frecuencia

- **Frecuencia**: establece el ritmo por separado para intervenciones espontáneas y activas: Raras, Suaves (por defecto), Normales o Frecuentes. Incluso en nivel Frecuentes, permanecerá en silencio en un servidor que rara vez le habla a TomoriBot.
- **Límites diarios**: se adaptan al nivel de frecuencia: Raras permite 1 intervención espontánea y 1 activa al día; Suaves 3 de cada una; Normales 5 intervenciones espontáneas y 6 activas; Frecuentes 8 intervenciones espontáneas y 10 activas.
- **Límites de comprobación**: evitan que las intervenciones activas agoten la cuota de la clave de IA: TomoriBot revisa las conversaciones como máximo 10 veces al día en Raras, 20 en Suaves, 40 en Normales y 60 en Frecuentes. Tras una comprobación sin coincidencias, ese canal espera más tiempo antes de la siguiente, desde 10 minutos hasta 3 horas. Si el proveedor de IA indica que la clave alcanzó su límite, las intervenciones activas se pausan por 3 horas.

### Casos en que permanece desactivado

- **Las estadísticas de uso están desactivadas**: TomoriBot evalúa qué tan activo es un servidor a partir de sus estadísticas de uso. Si quien aloja tu bot las desactivó, las intervenciones nunca iniciarán.
- **Los miembros pagan con sus propias claves (BYOK)**: si tu servidor hace que cada miembro use su propia clave de IA, ninguna clave cubre un mensaje que nadie solicitó expresamente, por lo que Natural Nudges permanece desactivado.

## Configuración de personas

Cada persona tiene su propia página de **Intervenciones** en `/config` > Persona:

- **Locuacidad**: con qué frecuencia esta persona es la que interviene. Las personas en silencio nunca inician intervenciones espontáneas ni participan en las activas; las tímidas hablan menos y las habladoras con más frecuencia.
- **Intereses**: hasta 8 temas que a la persona le gusta plantear y sobre los que le gusta opinar, cada uno con una breve descripción y ejemplos (por ejemplo, **anime de mechas**: ficción sobre robots gigantes tripulados, como Gundam).
- **Intervenciones espontáneas**: hasta 20 intervenciones que solo esta persona usa, descritas en [Intervenciones espontáneas de persona](#persona-idle-nudges).

Los preajustes oficiales vienen con estos ajustes. `/persona generate` sugiere intereses para nuevas personas; `Generar intereses` añade nuevos a través de tu modelo de texto actual. Las exportaciones de personas incluyen los tres.

## Cuándo se activan las intervenciones

### Heat
<!-- anchor: heat -->

Heat marca el ritmo tanto de las intervenciones espontáneas como de las comprobaciones activas para todo el servidor, entre miembros y personas. La configuración de Natural Nudges muestra el Heat medido, tu ajuste guardado y el Heat usado para las intervenciones de un total de 50.

#### TLDR: Más mensajes para TomoriBot = Más Heat = Más intervenciones automáticas

#### Actividad y decaimiento

El Heat medido es un promedio diario ponderado de interacciones durante los últimos 30 días. Los turnos ordinarios de conversación y los turnos de `/punish` humanos aportan una vez; los turnos de `/reward` humanos aportan tres veces más. Las intervenciones generadas y las interacciones juguetonas entre personas no aportan nada.

El peso de una interacción se reduce a la mitad cada tres días:

$$
w(d) = 2^{-d/3}
$$

Aquí, `d` es el número de días transcurridos, según días UTC: la actividad de hoy tiene peso 1, la de hace tres días tiene peso 0.5 y la de hace seis días tiene peso 0.25. La actividad deja de calcularse tras 30 días. Con `E_d` como el total ponderado de interacciones de cada día, el Heat medido `A` es:

$$
A = \frac{\sum_{d=0}^{29} E_d \cdot w(d)}{\sum_{d=0}^{29} w(d)}
$$

Una actividad constante de 10 interacciones ponderadas cada día genera aproximadamente 10 de Heat medido. Tu ajuste guardado `Δ` se suma tras este promedio y el resultado se limita a 0-50:

$$
H = \min(50, \max(0, A + \Delta))
$$

La actividad medida no tiene límite superior, por lo que el Heat de un servidor activo decae desde su valor completo. Ambos modos necesitan un Heat medido y un Heat efectivo de al menos 1. Un ajuste altera el ritmo una vez que la actividad medida alcanza ese mínimo. La pausa de 14 días sin chat directo se sigue aplicando con cualquier valor de Heat.

#### Tiempos de espera espontáneos y comprobaciones activas

Para un Heat efectivo `H` de al menos 1, tu nivel de frecuencia proporciona los siguientes valores:

| Frecuencia | Divisor espontáneo D | Límite diario espontáneo C | Multiplicador activo M |
|---|---|---|---|
| `Rare` | 175 | 1 | 2 |
| `Gentle` | 25 | 2 | 1 |
| `Normal` | 15 | 3 | 0.6 |
| `Lively` | 8 | 6 | 0.35 |

Las intervenciones espontáneas estimadas por día `R` aumentan con el Heat hasta alcanzar el límite diario:

$$
R = \min\left(\frac{H}{D}, C\right)
$$

El intervalo base es de `16 / R` horas. Cada intervalo recibe un multiplicador aleatorio entre 0.5 y 1.5, y cada invitación consecutiva sin respuesta triplica el siguiente intervalo. Tres invitaciones sin respuesta pausan las intervenciones espontáneas hasta que alguien hable de nuevo con TomoriBot. Los canales silenciosos, el horario activo, los prerrequisitos y la decisión del planificador siguen determinando si una intervención debida se inicia realmente.

Para las comprobaciones activas, el Heat altera la cantidad de mensajes humanos necesarios en un canal. Primero se calcula una escala de intervalo `s`, con el aporte de Heat limitado entre 0.5 y 4:

$$
s = M \cdot \min\left(4, \max\left(0.5, \frac{15}{H}\right)\right)
$$

El objetivo de mensajes de una comprobación se elige al azar entre `max(1, round(15 × s))` y `max(1, round(40 × s))`, inclusive. El redondeo usa el mensaje entero más cercano, redondeando las mitades hacia arriba. Los hilos comparten el contador de su canal principal. Los enfriamientos y límites diarios siguen aplicándose, y el comprobador solo invita a una persona a hablar cuando la conversación coincide con un interés. Estas fórmulas controlan los tiempos; una comprobación puede no producir respuesta.

Por ejemplo, con ambas frecuencias en `Gentle`:

| Heat efectivo | Intervenciones espontáneas estimadas por semana | Mensajes humanos entre comprobaciones activas |
|---|---|---|
| Menos de 1 | 0 | Sin comprobaciones |
| 5 | Aprox. 1.4 | 45-120 |
| 15 | Aprox. 4.2 | 15-40 |
| 30 | Aprox. 8.4 | 8-20 |
| 45 | Aprox. 12.6 | 8-20 |
| 50 | Hasta 14 | 8-20 |

Las comprobaciones activas alcanzan su intervalo más rápido con Heat 30. Las intervenciones espontáneas alcanzan sus límites diarios con Heat 50 para `Gentle`, 45 para `Normal` y 48 para `Lively`. `Rare` alcanza unas dos intervenciones espontáneas estimadas por semana con Heat 50, con a lo sumo una por día. Su estimación semanal es una guía de ritmo; los tiempos aleatorios y las verificaciones de idoneidad afectan la entrega real. Un Heat superior a 50 no añade velocidad de programación.

## Qué se almacena

Los ajustes, intervenciones personalizadas, intereses e intervenciones espontáneas de persona se guardan con la configuración de tu servidor. El historial de intervenciones, incluido si alguien respondió y a quién se mencionó, se conserva durante 30 días. Los propósitos se conservan hasta 90 días.

- **Configuración del servidor:** `/reset` restaura los ajustes de intervención y elimina las intervenciones personalizadas. Las exportaciones e importaciones de configuración incluyen los ajustes y las intervenciones personalizadas, excluyendo la lista de canales específicos del servidor. Las intervenciones espontáneas de persona permanecen con su persona tras un restablecimiento y viajan en su tarjeta de persona. `/persona default` y eliminar una persona quitan sus intervenciones espontáneas.
- **Configuración personal:** tu elección de `Pings de personas` sobrevive a `/reset personal config`, se incluye en `/export personal config` y se borra con `/personal nuke`.
