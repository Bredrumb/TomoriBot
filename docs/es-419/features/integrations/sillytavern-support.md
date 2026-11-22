---
title: "Compatibilidad con SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Usa tarjetas de personaje de SillyTavern en Discord"
description: "Importa tarjetas de personaje y preajustes de prompt de SillyTavern a Discord con TomoriBot. Trae tus personajes existentes a tu servidor."
sidebar:
  order: 2
aiGenerated: true
---

TomoriBot puede importar recursos desde [SillyTavern](https://github.com/SillyTavern/SillyTavern): preajustes del Administrador de prompts (que controlan la estructura del prompt), tarjetas de personajes (la definición del personaje) y lorebooks (Character Books incrustados o archivos de world info independientes). Si nunca has usado SillyTavern, puedes saltarte esta página con tranquilidad.

## Importación de tarjetas de personaje

Trae un personaje SillyTavern existente a Discord con `/persona import`. Acepta:

- **Tarjetas PNG** con metadatos `chara` o `char` integrados.
- Tarjetas **JSON estilo v2** con propiedades de nivel raíz (`name`, `description`, `first_mes`).
- Tarjetas **v3 JSON** (`spec: "chara_card_v3"` con un objeto `data` anidado).
- **Archivos `.charx`** (paquetes de Character Card V3).

Un archivo `.charx` es un archivo ZIP que contiene una definición de `card.json`. TomoriBot importa el texto de caracteres de `card.json` y omite los archivos de activos incluidos (iconos, sprites, audio, video). Puedes configurar un avatar en `/config` > `Persona` > `Identidad y personalidad` y agregar sprites en `/config` > `Persona` > Sprites.

Si un archivo cargado es una tarjeta SillyTavern válida sin metadatos TomoriBot, la importación lo convierte automáticamente. También puedes pasar una tarjeta a `/persona generate` para crear una nueva personalidad inspirada en el personaje.

Las importaciones se validan antes de guardar (límites predeterminados: 5000 caracteres por campo de texto, 200 atributos, 100 diálogos de muestra por lado, 100 palabras de activación). Para conocer la mecánica de conversión y mapeo de campos, consulte la [arquitectura de soporte de tarjeta](/en/architecture/integrations/sillytavern/card-support/).

:::tip
El Character Book de una tarjeta se convierte en el [lorebook](/features/knowledge/memory/lorebooks/) de esa persona. Las entradas desactivadas permanecen desactivadas. Reimportar la tarjeta reemplaza todo el lorebook de la persona, incluidas las entradas que hayas agregado tú.
:::

## Exportación de tarjetas de personaje

Usa `/persona export` con `output_format` establecido en `PNG compatible con SillyTavern` para llevar una persona
a SillyTavern. La tarjeta incluye el avatar, la personalidad, los diálogos de ejemplo, el prompt de la persona
y el lorebook de la persona. No tiene saludo inicial; agrega uno en SillyTavern antes de iniciar un chat.

Se excluyen los ajustes específicos de TomoriBot, como activaciones, intervenciones, ajustes de voz y límites de canal del lorebook.
Elige `Tarjeta de TomoriBot` o `JSON sin procesar` para conservar los ajustes de persona de TomoriBot. `Paquete de TomoriBot` también incluye sprites y multimedia de referencia de personaje, además del audio de referencia de voz cuando se solicita. Este ZIP es un formato de TomoriBot; usa el `PNG compatible con SillyTavern` para SillyTavern.

## Preajustes de prompt
<!-- anchor: prompt-presets -->

Un ajuste preestablecido del Administrador de mensajes SillyTavern controla el orden y el diseño del mensaje enviado al modelo. Abre `/config` > `Plugins` > SillyTavern Presets para importar ajustes preestablecidos, alternar nodos individuales, cambiar ajustes preestablecidos activos o restaurar el formato predeterminado.

### Qué controla un preajuste

- Pedido rápido y colocación de marcadores.
- Nodos de aviso personalizados
- Nodos posteriores a la historia y de inyección profunda.
- Estado inicial habilitado para nodos importados

### Lo que un preset no reemplaza

Un diseño de aviso de estructuras preestablecidas; no reemplaza las fuentes de texto que lo completan:

- Instrucciones del sistema y campos de persona: `/config` > `Comportamiento` > `Comportamiento general`, `/config` > `Persona` > Avanzado y `/config` > `Persona` > `Identidad y personalidad`.
- Historial de chat en vivo y contexto del documento recuperado.
- Contexto automático: memorias del servidor, datos de emojis y stickers, listas de participantes y memorias a corto plazo.

### Cómo se mapean los bloques nativos

Los bloques nativos se asignan directamente a los componentes del mensaje TomoriBot:

- `main`: el indicador del sistema activo (`/config` > `Comportamiento` > `Comportamiento general`, o el respaldo predeterminado)
- `charDescription`: `/config` > `Persona` > Avanzado
- `charPersonality`: `/config` > `Persona` > `Identidad y personalidad`
- `dialogueExamples`: `/config` > `Persona` > `Identidad y personalidad`
- `chatHistory`: historial de mensajes del canal en vivo
- `worldInfoBefore` y `worldInfoAfter`: contexto del documento recuperado (no libros de historia de SillyTavern)

### Regla del prompt del sistema

Cuando un preajuste importado está activo, este controla por completo el prompt del sistema. El prompt integrado de TomoriBot y cualquier prompt personalizado de `/config` > `Comportamiento` > `Comportamiento general` no se envían, y los botones del prompt del sistema allí quedan bloqueados. Tu prompt personalizado se conserva y vuelve a aplicarse cuando desactivas el preajuste en `/config` > `Plugins` > `Preajustes de SillyTavern`.

### Macros de preajuste
<!-- anchor: preset-macros -->

Usa [macros de preajuste](/features/prompt-macros/#sillytavern-preset-macros) para insertar
detalles de la persona, el mensaje más reciente del usuario o la hora del servidor en un nodo del preajuste.

### Instrucciones condicionales
<!-- anchor: conditional-instructions -->

Usa [condicionales de preajuste](/features/prompt-macros/#preset-conditionals) para elegir
instrucciones según un valor, como si la persona tiene una descripción.

### Notas de compatibilidad

- Los nodos deshabilitados en `prompt_order` permanecen inactivos hasta que se habilitan en `/config` > `Plugins` > SillyTavern Presets. Los nodos vacíos y de solo comentarios nunca se envían.
- El orden de los marcadores es literal: colocar `chatHistory` delante de `dialogueExamples` coloca el historial de chat primero. Los marcadores de world info posicionan el lore de Always On; el lore activado, los documentos recuperados, la presencia y el reloj permanecen cerca de los cuatro turnos de diálogo más recientes. La memoria a corto plazo reciente o entre canales también permanece cerca de esos mensajes, o más cerca si está configurado.
- Las inyecciones posteriores al historial se fusionan con el historial de conversaciones existente en lugar de enviarse como mensajes independientes.
- No se admiten el posprocesamiento de expresiones regulares, los parámetros de muestreo predefinidos (temperatura, top-p) ni los ajustes preestablecidos en capas. Los ajustes preestablecidos de finalización de texto heredados se importan con bloques solo ST eliminados.

En `/help`, elija `Plugins`, luego `Preajustes de SillyTavern`, para la guía Discord. Para el procesamiento interno preestablecido, consulte la [arquitectura del sistema preestablecido](/en/architecture/integrations/sillytavern/preset-system/).
