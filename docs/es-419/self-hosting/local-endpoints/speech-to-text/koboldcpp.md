---
title: "Transcripción de KoboldCPP"
sidebar:
  order: 3
---

KoboldCPP tiene soporte para conversión de voz a texto basada en Whisper, pero la forma del endpoint puede variar según la compilación. El adaptador de la Fase 4 de TomoriBot espera un endpoint `POST /v1/audio/transcriptions` compatible con OpenAI.

## Configuración

Inicia KoboldCPP con Whisper/STT habilitado y confirma que tu compilación expone:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` o `GET /models`

Mantén KoboldCPP en ejecución mientras TomoriBot lo esté usando. Si tu compilación solo expone `/api/extra/transcribe` u otra forma personalizada, usa un envoltorio hasta que TomoriBot tenga un adaptador dedicado.

## Registro en TomoriBot

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado** y usa la compatibilidad de API de transcripción:

- Compatibilidad de API: `openai-compatible-transcription`
- `endpoint_url`: la raíz de tu servidor KoboldCPP

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar el nombre del modelo que tu servidor reporta como un modelo de Transcripción.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el endpoint registrado.

## Uso de transcripciones

Después del registro, TomoriBot transcribe los archivos adjuntos de audio en segundo plano y agrega el texto al contexto del chat. Usa `/config` > Motor > Avisos solo si también quieres que las transcripciones se publiquen visiblemente en el chat.
