---
title: "Compatibilidad con SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Usa tarjetas de personaje de SillyTavern en Discord"
description: "Importa tarjetas de personaje y preajustes de prompt de SillyTavern a Discord con TomoriBot. Trae tus personajes existentes a tu servidor."
sidebar:
  order: 2
---

TomoriBot puede importar dos cosas de [SillyTavern](https://github.com/SillyTavern/SillyTavern)
que ya podrías tener: **preajustes del Administrador de prompts** (cómo se organiza el prompt)
y **tarjetas de personaje** (el personaje en sí). Esta es una función especializada para
usuarios de ST; si nunca has usado SillyTavern, puedes omitir esta página.

## Importación de tarjetas de personaje

Trae un personaje de SillyTavern existente directamente a Discord con `/persona import`.
Acepta:

- **Tarjetas PNG** con metadatos `chara` / `char` incrustados,
- **Tarjetas JSON estilo v2** (`name`, `description`, `first_mes`, … a nivel raíz),
- **JSON v3** (`spec: "chara_card_v3"` con un objeto `data` anidado),
- **Archivos `.charx`** (Character Card V3, el formato que los sitios de tarjetas entregan por
  defecto).

Un archivo `.charx` es un zip cuyo `card.json` contiene el personaje. TomoriBot lee esa tarjeta
e ignora todo lo demás en el archivo: los íconos incluidos, los sprites de emoción, el audio y
el video no se importan, y la respuesta de importación lo indica. Establece un avatar con
`/server avatar` y añade sprites en `/config` > Persona > Sprites.

Si el archivo no tiene metadatos de TomoriBot pero es una tarjeta ST v2/v3 válida, la
importación la pasa automáticamente por el flujo de conversión de SillyTavern. También puedes
pasarle una tarjeta a `/persona generate` para transformarla en una persona nueva.

Las importaciones pasan por un esquema de validación antes de guardar nada (límites
predeterminados: 5000 caracteres por cadena, 200 atributos, 100 diálogos de muestra por lado,
100 palabras de activación; quienes se autoalojan pueden ajustar las variables de entorno
`PRESET_MAX_*`). Las lecturas de archivos están limitadas por separado mediante las variables de
entorno `MAX_CHARX_*`, porque el tamaño comprimido de un archivo no dice nada sobre a qué se
expande. Para el mapeo exacto de conversión y campos, consulta la
[arquitectura de compatibilidad de tarjetas](/en/architecture/integrations/sillytavern/card-support/).

## Preajustes de prompt
<!-- anchor: prompt-presets -->

Un preajuste del Administrador de prompts de SillyTavern controla la **organización** del
prompt. Usa `/config` > Plugins > Preajustes de SillyTavern para importar preajustes, inspeccionar
los nodos activados, cambiar entre preajustes, o volver a la organización normal.

### Qué controla un preajuste

- El orden del prompt y la ubicación de marcadores
- Nodos de prompt personalizados
- Nodos de inyección posteriores al historial / por profundidad
- Qué nodos importados empiezan activados o desactivados

### Qué *no* reemplaza

Un preajuste controla la *organización*, no cada fuente de texto. Estos siguen existiendo junto
a él:

- Tus bloques de sistema/persona: `/config` > Motor > General, `/config` > Persona > Avanzado,
  las acciones de atributos y diálogos de muestra en `/config` > Persona > Identidad y
  personalidad.
- El historial de chat en vivo y el contexto de documentos recuperado.
- El contexto automático de TomoriBot: memoria del servidor, contexto de emojis/stickers,
  usuarios en la conversación, memoria a corto plazo, condicionamiento y bloques similares.

### Cómo se mapean los bloques nativos

- `main` → el prompt del sistema actual (`/config` > Motor > General, o si no el respaldo
  integrado)
- `charDescription` → `/config` > Persona > Avanzado
- `charPersonality` → `/config` > Persona > Identidad y personalidad
- `dialogueExamples` → `/config` > Persona > Identidad y personalidad
- `chatHistory` → historial de canal en vivo
- `worldInfoBefore` / `worldInfoAfter` → contexto de documentos recuperado (no lorebooks de ST)

### Regla del prompt del sistema

Mientras un preajuste está activo, el prompt del sistema de respaldo integrado se elimina, pero
si *tú* estableces el tuyo con `/config` > Motor > General, igual se envía.

### Notas de compatibilidad

Sorpresas comunes cuando un preajuste parece ser ignorado:

- Importado ≠ enviado: los nodos desactivados en `prompt_order` permanecen apagados hasta que
  los actives con `/config` > Plugins > Preajustes de SillyTavern. Los nodos de solo comentario y
  vacíos nunca se envían; los marcadores desconocidos se omiten.
- El orden es literal: colocar `chatHistory` antes de `dialogueExamples` envía el chat en vivo
  primero.
- Las inyecciones posteriores al historial / por profundidad se combinan con las entradas de
  historial de chat existentes en lugar de convertirse en mensajes independientes; varios nodos
  en la misma profundidad se agrupan.
- El posprocesamiento con regex, las anulaciones de temperatura/top-p/modelo del lado del
  preajuste y los preajustes en capas no son compatibles. Los preajustes heredados de
  completado de texto se importan mediante una ruta de mejor esfuerzo que descarta bloques
  exclusivos de ST (escenario, anclas, cadenas de parada, …).

En `/help`, elige **Integraciones** y luego `Preajustes de SillyTavern`, para la referencia
dentro de Discord. Para los detalles internos del motor de importación, consulta la
[arquitectura del sistema de preajustes](/en/architecture/integrations/sillytavern/preset-system/).
