---
title: "Generación de imágenes"
sidebar:
  order: 1
---

TomoriBot puede generar imágenes a partir de un prompt de texto o editar una imagen de referencia. Usa
`/generate image` o solo pídeselo ("dibújame un panda rojo tomando café").

## Qué puede hacer

- **Texto a imagen**: genera a partir de un prompt.
- **Imagen a imagen**: edita o cambia el estilo de una imagen de referencia completa.
- **Inpainting**: vuelve a dibujar una región específica y conserva el resto.
- **Outpainting**: extiende el lienzo más allá del encuadre original.
- **Relaciones de aspecto configurables**.
- Las **imágenes de referencia** pueden provenir de archivos adjuntos, stickers, emojis o avatares de usuarios/personas. Señala un mensaje o menciona a un usuario/persona para usar su avatar como referencia.

Los modos de edición disponibles dependen del backend. Texto a imagen e imagen a imagen funcionan en
los proveedores en la nube integrados (Google, Vertex, OpenRouter), mientras que **inpainting y outpainting
los proporcionan endpoints personalizados locales [ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/)**
y dependen de las capacidades declaradas por ese endpoint. Lo que el backend no puede hacer simplemente
se oculta, así que no ofrecerá un modo que tu configuración no admita.

Al generar una imagen, usa el contexto de Apariencia física de tu persona, además de etiquetas positivas
y negativas predeterminadas (cuando el backend admite prompts negativos). El resultado se entrega como una
galería de medios de Discord con detalles de generación, incluidos los usuarios o personas de referencia.

## Personalizar etiquetas
<!-- anchor: tag-customization -->

Cada fuente de etiquetas anterior se puede editar y tiene un alcance distinto. Todas abren un modal
rellenado con las etiquetas actuales para que las edites directamente:

- **`/config` > Persona > Apariencia**: etiquetas de `Apariencia Física` de la persona seleccionada (cómo *se ve*). Requiere el permiso Administrar servidor.
- **`/personal config`**: tus propias etiquetas de apariencia, aplicadas cuando una generación te referencia. Te siguen en todos los servidores (consulta [Personalización](/es-419/features/knowledge/personalization/)).
- Etiquetas positivas y negativas predeterminadas en **`/config` > Modelos > Valores predeterminados de generación de imágenes**: etiquetas predeterminadas del servidor que se añaden a cada generación (o la orientan en sentido contrario). Las negativas solo tienen efecto cuando el backend admite prompts negativos. Enviar el modal con el cuadro vacío restablece esa lista a los valores predeterminados integrados.

## Configuración

1. Configura un modelo de imágenes con `/config` > Modelos > Cambiar modelos.
2. Asegúrate de que la generación de imágenes esté permitida. Depende de la capacidad `imagegen_enabled` (`/config` > Permisos).
3. Pídele que genere una imagen o ejecuta `/generate image`.

## Compatibilidad con proveedores

La generación nativa de imágenes está disponible en **Google, Vertex AI, Vertex AI Express, OpenRouter,
Z.ai, NVIDIA NIM** y **NovelAI** (con estilo anime; el inpainting nativo está creado y llegará pronto,
pero está desactivado mientras se perfecciona la mezcla de bordes). Consulta [Proveedores y modelos](/es-419/features/setup-administration/providers-and-models/#proveedores-compatibles) para ver la matriz completa y cómo añadir un proveedor.

Para la generación **local** con tu propio hardware mediante ComfyUI, consulta [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/).
