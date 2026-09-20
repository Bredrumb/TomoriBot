---
title: "Múltiples personas"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay" -
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | AI Companions & Personas for Your Discord Server"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Run multiple AI companions in one Discord server. Custom personas with their own avatars, triggers, and speaking styles."
sidebar:
  order: 2
---

La personalidad de TomoriBot vive en una **persona**: su nombre, avatar, rasgos, estilo al hablar y
comportamiento. Puedes ejecutar varias personas a la vez, cada una con su propio personaje, activadores
y avatar de webhook. Esta página explica *cómo se comporta*. Para saber *qué conoce* (datos y memorias),
consulta [Memoria](/es-419/features/knowledge/memory/).

## Crear una persona

- `/persona create`: crea una personalidad personalizada desde cero.
- `/persona generate`: haz que la IA genere una personalidad a partir de una descripción y una imagen. Requiere un proveedor compatible con salida estructurada. También puedes cargar aquí un preajuste existente de TomoriBot o una tarjeta de SillyTavern para transformar un personaje ([Compatibilidad con SillyTavern](/es-419/features/integrations/sillytavern-support/)).
- `/persona default`: cambia a una de las personalidades predeterminadas integradas como base.
- `/persona export` / `/persona import`: comparte o respalda una persona como archivo. Importar permite traer una persona como **alter** con sus propios activadores y avatar de webhook.
- `/persona remove`: elimina una persona alter.

Un buen flujo inicial es elegir una predeterminada o generar una, y después perfeccionarla con los atributos y diálogos de ejemplo de abajo.

## Personas alter

Las personas alter permiten que varios personajes coexistan en un servidor:

- Cada alter tiene su propia personalidad, palabras de activación y **avatar de webhook**, así que distintos personajes aparecen con nombres e imágenes diferentes en el mismo canal.
- Varias personas alter pueden responder a un solo mensaje, hasta el límite de `/config` > Motor > Activador.
- **Responder a un mensaje de webhook** continúa la conversación como esa persona.
- Añade alters mediante `/persona import` (opción alter) y adminístralas con `/persona` y `/persona remove`.

Esto hace posibles el roleplay grupal y los servidores con varios personajes. Para conocer los detalles de ejecución sobre cómo los activadores dirigen a las personas y cómo funcionan las identidades de webhook, consulta la referencia de arquitectura sobre [comportamiento de múltiples personas](/en/architecture/subsystems/multi-persona/).

## Dar forma a la personalidad

Dos comandos hacen la mayor parte del trabajo de enseñarle cómo hablar y actuar:

### Atributos {#attributes}

`/config` > Persona > Identidad y personalidad añade rasgos de personalidad o características físicas, por
ejemplo `amigable`, `cabello rojo` o `termina las oraciones con *Nya~*`. Elimínalos desde el mismo lugar.

### Diálogos de ejemplo {#sample-dialogues}

`/config` > Persona > Identidad y personalidad le enseña *cómo habla* mediante ejemplos. Usa los marcadores
`{user}` y `{bot}` para que los diálogos funcionen para todos y al compartir la persona:

- `{user}`: se reemplaza por el nombre o apodo real del usuario
- `{bot}`: se reemplaza por su nombre actual

```text
{user}: ¿Cuál es tu pasatiempo favorito?
{bot}: ¡Fufu~ Me gusta tejer ropa diminuta para peluches diminutos~♥
```

Consejos para diálogos de ejemplo eficaces:

- Escribe intercambios naturales y conversacionales.
- Incluye los atributos y rasgos que quieres que muestre.
- Demuestra el tono que buscas y añade variedad para que generalice.

Elimina ejemplos desde `/config` > Persona > Identidad y personalidad.

### Nombre y avatar

- `/config` > Persona > Identidad y personalidad: establece cómo se llama a sí misma.
- `/config` > Persona > Identidad y personalidad: establece su imagen de perfil para este servidor.

También puedes establecer un prompt del sistema personalizado con `/config` > Motor > General para dar más forma al comportamiento. Consulta [Ajuste del comportamiento](/es-419/features/chatting-personality/behavior-tweaking/).

## Sprites (avatares de emoción) {#sprites-emotion-avatars}

Los sprites son imágenes de avatar alternativas a las que una persona puede cambiar a mitad de la conversación
para expresar una emoción o situación, como sus expresiones faciales. Cada sprite es una imagen con etiqueta
(por ejemplo `feliz`, `enojada`, `avergonzada`) que muestra en lugar de su avatar normal cuando corresponde.

Cómo los usa: el modelo recibe los sprites disponibles y sus indicaciones de uso en cada turno. Para mostrar
uno, inicia una línea de respuesta con `PersonaName (label):`. Esa línea se entrega con la imagen del sprite
correspondiente. Si ningún sprite encaja, responde normalmente.

Administra los sprites de una persona en `/config` > Persona > Sprites (añadir y eliminar requiere el permiso
**Administrar servidor**):

- `/config` > Persona > Sprites: añade o reemplaza un sprite. Elige la persona, dale una **etiqueta**, carga la **imagen** (PNG, JPG o GIF) y, opcionalmente, añade **instrucciones de uso** que indiquen cuándo utilizarlo. Reutilizar una etiqueta reemplaza ese sprite. Cada persona tiene un máximo de sprites.
- `/config` > Persona > Sprites: cambia el nombre, imagen, instrucciones o interruptor de identidad de un sprite existente.
- `/config` > Persona > Sprites: elimina sprites de una persona.
- Exportar e importar en `/config` > Persona > Sprites: respalda o comparte todo el conjunto de sprites de una persona como archivo.

El interruptor de **identidad** decora el nombre del mensaje como `Label (Persona)` en Discord, lo que resulta especialmente útil para [personas alter](#personas-alter) que hablan como personajes distintos.

Cambiar el avatar de una persona predeterminada elimina los sprites que traía porque muestran el rostro del
personaje original. Los sprites que añadiste permanecen. Ejecuta `/persona default` para recuperar los sprites predeterminados.

## Elección de persona por canal

¿Quieres controlar qué persona te responde en un canal específico sin cambiar la configuración de todo el servidor?
Eso es el foco personal. Consulta [Personalización](/es-419/features/knowledge/personalization/#personal-spotlight).

## Formas de dirigirse a las personas específicas de cada persona

Los administradores del servidor pueden usar `/config` > Persona > Identidad y personalidad para dar a cada persona
prefijos, sufijos y formas de dirigirse independientes en masculino, femenino y neutro. El ajuste específico de una
persona de un usuario se basa en el linaje estable de la persona. Por eso dos personas pueden llamar a Sparrow con
nombres distintos en la misma respuesta de varias personas y seguir dirigiéndose al mismo usuario de Discord.
Editar primero un puntero oficial crea una copia independiente. Nunca cambia el catálogo compartido ni la persona de otro servidor.
