---
title: "Dentro del prompt"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot agrupa instrucciones y memorias arriba de la conversación, y luego coloca la información cambiante
cerca de los mensajes más recientes. [NovelAI](/features/integrations/novelai/) usa una estructura independiente, y
los [preajustes de SillyTavern](/features/integrations/sillytavern-support/) pueden reorganizar los bloques iniciales.

| Posición | Qué recibe TomoriBot | Dónde gestionarlo |
|---|---|---|
| Parte del sistema | Prompts del sistema, de canal y de persona; atributos de persona; orientación sobre herramientas; información del servidor; restricciones persona-usuario; memorias del servidor; emojis, stickers y sprites; entradas de lorebook Always On; condicionamiento. | `/config`, `/memories`, `/moderation`, `/expressions` y `/conditioning` |
| Arriba de la conversación | Perfiles de participantes, alias, memorias personales, recordatorios y tareas de la persona; memoria a corto plazo más antigua del mismo canal en su posición predeterminada; definiciones de herramientas de texto cuando sean necesarias. | `/personal memories`, `/memories` y `/config` |
| Ejemplos y conversación | Diálogos de muestra, seguidos de los mensajes recientes de este canal. | `/config` > Persona > Identidad y personalidad; Comportamiento > Comportamiento general |
| Justo arriba de los cuatro turnos de diálogo más recientes | Memoria a corto plazo reciente o que contiene contenido de otros canales, entradas de lorebook activadas por palabras clave o por probabilidad, documentos recuperados, presencia de participantes y la hora actual con la línea del canal. | `/memories` y `/config` |
| Entre los mensajes recientes | Notas de contexto a la profundidad elegida, además de recordatorios de herramientas y de reconocimiento del tiempo. | `/config` > Comportamiento > Comportamiento general; Persona > Avanzado; Canales > Excepciones de canal |

Un turno de diálogo agrupa mensajes consecutivos de una persona o persona del bot. Cuatro turnos de diálogo pueden contener
muchos mensajes. En una conversación corta, TomoriBot cuenta hacia atrás en diálogos de muestra adyacentes donde
estén disponibles. La memoria a corto plazo puede ubicarse más cerca del mensaje más reciente si configuraste una profundidad menor.
Los bloques opcionales vacíos no cuestan tokens.

Los mensajes recientes crecen dentro de un rango y luego descartan los mensajes más antiguos en un lote. El lote es el 30% de tu
límite de mensajes, redondeado hacia abajo a un número par. Con el límite predeterminado de 80, el lote es de 24: una ventana
completa mantiene su mensaje inicial mientras llegan nuevos mensajes, y luego avanza 24 cuando superaría los
80. Un intercambio típico de dos mensajes deja 58 mensajes después de ese avance. Las conversaciones cortas,
las actualizaciones y el espacio disponible del modelo pueden dejar menos mensajes.

Una nota de contexto ubicada antes del grupo de información cambiante se desplaza a través del historial más antiguo en
cada respuesta del bot y hace que el almacenamiento en caché del prompt sea menos eficaz. Mantenerla cerca del mensaje más reciente
evita esa alteración adicional de la caché.

:::tip
Algunos modelos usan la información cerca del principio o del final de un prompt largo de manera más confiable que la información en el medio. Para los proveedores que usan notas de contexto, prueba colocar una instrucción cerca del mensaje más reciente. El efecto depende del modelo y de la tarea. Consulta [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) y [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

`/tool prompt snapshot` vuelca el paquete exacto de una persona en un archivo. Es la verdad fundamental sobre qué recuerdos están actualmente activos, si un documento coincide y qué parte de la conversación realmente encaja.

`/context` dibuja el mismo paquete como una cuadrícula de colores de la ventana contextual del modelo, un color por cada grupo de bloques de arriba, para que puedas ver de un vistazo qué lo llena y cuánto espacio queda. Un círculo marca un grupo más pequeño que un cuadrado. También muestra el costo de entrada estimado por respuesta y cuántos tokens de entrada informó el proveedor para la última respuesta real.

`/tool estimate cost` desglosa el mismo paquete por tamaño, lo cual es útil para determinar qué está consumiendo su contexto antes de aumentar los límites.

### ¿Dónde se definen las herramientas?

Para los proveedores que admiten llamadas a herramientas, TomoriBot envía las definiciones de herramientas a través de la interfaz compatible del proveedor.

### ¿Por qué TomoriBot olvida?

| Qué pasó | Por qué |
|---|---|
| Olvidó algo de hoy | Pasó el límite de mensajes sin haberse guardado como memoria a largo plazo. |
| Olvidó algo en otro canal | Los mensajes recientes son específicos de cada canal. Las memorias del servidor, las memorias de participantes y la memoria a corto plazo proporcionan información seleccionada de otros canales. |
| `/refresh` la hizo olvidar | Refresh corta los mensajes recientes y borra la memoria a corto plazo de este canal, pero no debería eliminar la memoria a largo plazo. Elimina el embed de refresh para quitar el corte. |
| Olvidó algo después de reiniciar | Los mensajes recientes nunca sobreviven a los reinicios |

Si quieres que algo sobreviva a todo lo anterior, tiene que convertirse en una memoria a largo plazo. Consulta [Memoria](/es-419/features/knowledge/memory/long-term-memory/).

## Consejos y trucos

- `/config` > Comportamiento > Comportamiento general amplía la ventana de conversación (20-100 mensajes). Más
  contexto, más tokens por respuesta.
- `/config` > Comportamiento > Comportamiento general inyecta un recordatorio breve a una profundidad elegida. Como se
  ubica bajo en el paquete, cerca de los mensajes recientes, es más probable que actúe según él
  que según algo en el prompt del sistema. Este es el mejor lugar para animarla a guardar
  memorias con más frecuencia.
- `/personal memories` y `/memories` escriben directamente en `Memorias del servidor` y
  Participantes de la conversación, lo cual es una de las formas garantizadas de hacer
  permanente el conocimiento en el contexto de TomoriBot.
