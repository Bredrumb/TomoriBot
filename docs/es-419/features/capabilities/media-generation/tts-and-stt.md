---
title: "Voz: TTS y STT"
sidebar:
  order: 3
---

TomoriBot puede **hablar** (texto a voz) y **escuchar** (voz a texto):

- **TTS** le permite responder con mensajes de voz nativos de Discord.
- **STT** convierte archivos de audio adjuntos por usuarios en texto que puede usar como contexto de conversación.

Ambos funcionan mediante el mismo sistema de endpoints. La ruta más rápida es **ElevenLabs** (en la nube,
documentada por completo abajo). Si prefieres ejecutar la voz en tu propio hardware, usa un motor local y sigue las guías de autoalojamiento.

## Texto a voz
<!-- anchor: text-to-speech -->

### ElevenLabs (en la nube, opción más sencilla)

1. Obtén una clave de API en [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Ejecuta `/providers`, elige `Agregar nuevo proveedor`, selecciona **ElevenLabs** y pega la clave. Este flujo:
   - registra el endpoint de **voz** de ElevenLabs (y también el de **transcripción**),
   - los selecciona como activos,
   - puede asignar una voz a una persona de inmediato.
3. Asigna voces a otras personas en `/config` > Persona > Voz. Explora voces en la [Biblioteca de voces de ElevenLabs](https://elevenlabs.io/app/voice-library), donde también puedes clonar la tuya.

Selecciona ElevenLabs en `/providers` y elige `Editar punto de conexión` cuando necesites actualizar la clave.

Notas:

- En el **plan gratuito solo funcionan las voces prediseñadas**. Consulta la [lista de voces prediseñadas](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Los caracteres se cuentan cuando genera y lee mensajes de voz. El nivel gratuito tiene límites mensuales. Consulta tu panel de ElevenLabs.
- Las respuestas de voz dependen de `voice_message_enabled` y requieren que la persona activa tenga una voz asignada.
- Persona > Voz en `/config` requiere Administrar servidor en un servidor y sigue disponible para el propietario en un espacio de trabajo basado en mensajes directos.

En `/help`, elige `Funciones` y luego `Voz` para ver el mismo recorrido en Discord.

### Motores locales de clonación de voz (con autoalojamiento)

En una instancia con autoalojamiento puedes ejecutar un servidor local de clonación de voz. El flujo general es:
inicia el servidor envoltorio, registra su conexión y modelo con `/providers`, selecciónalo con `/providers`,
sube una muestra con `/config` en Modelos > Parámetros y voces TTS y asígnala en Persona > Voz en `/config`.
Se acepta cualquier formato de audio (se convierte automáticamente a WAV mono). Los clips de 10-20 segundos
sin música de fondo funcionan mejor.

Cada motor tiene su propia guía:

- [Chatterbox-Turbo/Nano](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/): clonación rápida de voz solo en inglés, con etiquetas de evento compatibles como `[laugh]`.
- [Qwen3-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/qwen3tts/): multilingüe (10 idiomas), además de un modo VoiceDesign en lenguaje natural.
- [MOSS-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/moss/): endpoint automático de prueba para clonación multilingüe o diseño de voz en inglés y chino.
- [IrodoriTTS](/es-419/self-hosting/local-endpoints/text-to-speech/irodoritts/): especializado en japonés, lee los emojis como señales de emoción.

Consulta la [tabla comparativa de texto a voz](/es-419/self-hosting/local-endpoints/text-to-speech/) para ver la lista completa y las recomendaciones de hardware.

## Voz a texto
<!-- anchor: speech-to-text -->

Los endpoints de transcripción convierten archivos de audio adjuntos por usuarios en texto para el contexto
de conversaciones en segundo plano. Que las transcripciones se **publiquen visiblemente** en el chat se
controla por separado desde `/config` > Motor > Avisos.

### ElevenLabs (en la nube)

Ya se explicó arriba. Añadir ElevenLabs desde `/providers` registra el endpoint de transcripción junto al de voz.
Usa `/providers` para elegir entre endpoints de transcripción.

### Motores locales (con autoalojamiento)

- [WhisperX](/es-419/self-hosting/local-endpoints/speech-to-text/whisperx/): la ruta local recomendada, con unos 100 idiomas, aceleración por GPU y varios tamaños de modelo.
- [KoboldCPP](/es-419/self-hosting/local-endpoints/speech-to-text/koboldcpp/): funciona si tu compilación expone un endpoint de transcripción compatible con OpenAI.
- [whisper.cpp](/es-419/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Consulta el centro de [Voz a texto](/es-419/self-hosting/local-endpoints/speech-to-text/) para ver la lista completa.
Para el resumen de Discord, ejecuta `/help` y elige `Funciones` y luego `Transcripción`.
