---
title: "Generación de videos"
sidebar:
  order: 2
---

TomoriBot puede generar videos cortos a partir de un prompt de texto o animando una imagen de referencia.
Usa `/generate video` o solo pídeselo.

## Qué puede hacer

- **Texto a video**: genera un clip corto a partir de un prompt.
- **Imagen a video**: anima una imagen de referencia (la primera imagen de un mensaje señalado se convierte en el fotograma inicial).
- **Imagen a video en bucle**: cuando se solicita mediante el chat, los modelos compatibles pueden reutilizar la imagen inicial como fotograma final.
- **Relaciones de aspecto configurables**.

La imagen a video y los bucles dependen de las capacidades del modelo seleccionado para el primer y el
último fotograma. TomoriBot comprueba el catálogo actual de modelos de video de OpenRouter antes de enviar
un trabajo de pago y te pide quitar la imagen, desactivar el bucle o seleccionar un modelo compatible cuando es necesario.

La generación de videos usa un **flujo de sondeo asíncrono**: se envía la solicitud, luego TomoriBot
consulta al proveedor hasta que el clip terminado está listo y lo publica. Los clips grandes pueden tardar.

## Configuración

1. Configura un modelo de video con `/config` > Modelos > Cambiar modelos.
2. Asegúrate de que la generación de imágenes/medios esté permitida mediante `/config` > Permisos.
3. Pídele que genere un video o ejecuta `/generate video`.

## Compatibilidad con proveedores

La generación nativa de videos está disponible en **Google, OpenRouter** y **Z.ai**. Consulta la matriz
completa en [Proveedores y modelos](/es-419/features/setup-administration/providers-and-models/#proveedores-compatibles).

Para la generación de videos **local** mediante ComfyUI (por ejemplo, flujos de imagen a video de WAN), consulta [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/).

Para la arquitectura interna de generación y sondeo, consulta la referencia sobre [generación de videos](/en/architecture/subsystems/video-generation/).
