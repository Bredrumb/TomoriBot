---
title: "Comparación de motores TTS"
aiGenerated: false
sidebar:
  order: 1
---

Compara a continuación los tiempos de síntesis y las muestras de audio generadas en el mismo entorno de prueba.

## Clonación de voz multilingüe y en inglés

### Prompts de benchmark

- **Prompt estándar** *(utilizado para Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2, Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Prompt de Fish Audio S2 Pro** *(probado con etiquetas de expresión entre corchetes)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Rendimiento y comparación de audio

Los tiempos indican tanto el tiempo de generación completo (segundos totales transcurridos desde la solicitud hasta el audio finalizado) como el Factor de tiempo real (RTF), definido como el tiempo de generación dividido entre la duración del audio:

- **RTF < 1.0 (en negrita):** El motor genera voz más rápido que en tiempo real (por ejemplo, `0.50× RTF` procesa un clip de 10 segundos en 5 segundos). Solo estos motores podrían mantener el ritmo de una llamada de voz en vivo, algo que TomoriBot no implementa actualmente.
- **RTF > 1.0:** La generación toma más tiempo que el audio hablado. TomoriBot envía cada mensaje de voz como un archivo completo, por lo que un RTF más alto solo representa una espera más prolongada.

| Motor | Nativo de Windows<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Muestra de audio |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 min<sup>(2)</sup><br/>*(~65× RTF)* | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, predeterminado)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clip de 8.7s)*<br/>0.57× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clip de 8.0s)*<br/>0.38× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Estándar)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clip de 7.8s)*<br/>0.77× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clip de 8.8s)*<br/>1.36× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clip de 13.9s)*<br/>0.43× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clip de 7.4s)*<br/>1.09× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clip de 9.2s)*<br/>1.09× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **Entorno de prueba**: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) en Windows 11 (ejecución nativa) utilizando una muestra de audio de referencia mono de 24 kHz y 26.6 segundos con transcripción literal coincidente.
- <sup>(2)</sup> **Fish Audio S2 Pro**: La ejecución en Windows opera en modo eager sin compilar (~65× RTF) debido a la latencia de lanzamiento del kernel CUDA en sus evaluaciones de 76 capas por token. Se recomienda ejecutar en Linux o WSL2 con la fusión del compilador OpenAI Triton (`torch.compile`) para evitar este cuello de botella.

---

## Clonación de voz en japonés

### Prompt de benchmark en japonés

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Rendimiento y comparación de audio en japonés

| Motor | Nativo de Windows<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Muestra de audio |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clip de 8.5s)*<br/>0.47× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Medido en el mismo entorno de prueba con RTX 4070 Ti SUPER en Windows 11.

---

## Compara los motores

TomoriBot devuelve archivos WAV completos. Los tamaños de modelo corresponden al recuento de parámetros; las cifras de memoria de GPU son recomendaciones de configuración. Los tiempos indicados arriba provienen de una única máquina con Windows.

Las longitudes de referencia incluyen las recomendaciones de los proyectos de origen y los límites en tiempo de ejecución. Consulta la guía de cada motor para conocer los detalles.

| Motor | Tamaño del modelo; GPU de 16 GB | Idiomas | Clip de referencia | Fuentes de voz y controles | Velocidad / ruta de transmisión | Elígelo para |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (predeterminado), 110M Nano o 500M Estándar; sí, Nano puede usar CPU | Inglés | 10 segundos; duraciones mayores se ignoran silenciosamente tras la ventana de 10 s del prompt | Clonación por referencia, etiquetas de eventos compatibles; el modelo estándar ofrece sintonización de CFG y exageración | Enfoque rápido y liviano; el contenedor devuelve el WAV completo | Entornos pequeños de clonación en inglés o experimentos en CPU |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B por modo; sí, los modelos se intercambian | 10, incluidos inglés y japonés | A partir de 3 segundos; sin límite documentado | Clonación o VoiceDesign descrito por texto | Enfoque en calidad; transmisión en el proyecto de origen, el contenedor usa búfer | Clonación multilingüe de propósito general y VoiceDesign en japonés |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | Clon de 4B + diseño de ~1.7B, intercambiados; 16 GB es un objetivo de prueba no verificado; la versión insignia de 8B probablemente no quepa | Clonación: 31, incluido japonés; diseño: inglés y chino | No documentado en el proyecto de origen; sin límite en tiempo de ejecución | Clonación o VoiceGenerator descrito por texto; etiquetas de idioma para clonación | Experimental; la clonación local dispone de backend de transmisión en origen, el contenedor usa búfer | Comparar la calidad de clonación de MOSS o diseño de voz en inglés y chino |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B v4.1 Small actual; ~3-4 GB de VRAM observados en una ejecución local | Solo japonés | ~30 segundos; recortado en el límite de 120 s del checkpoint | Clonación o VoiceDesign; indicaciones de estilo mediante emojis | Los pasos de muestreo intercambian calidad por velocidad; el contenedor usa búfer | Voces en japonés con bajo consumo de recursos y modulación por emojis |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; oficial BF16 predeterminado (~16-18 GB), INT8 opcional para 16 GB | 83 indicados en origen | 10-30 segundos; sin límite en tiempo de ejecución | Clonación por referencia (requiere transcripción de referencia), etiquetas de expresión libres entre corchetes | Modelo Dual-AR pesado; requiere Linux/WSL2 con Triton para síntesis rápida (~65× RTF en modo eager de Windows) | Clonación altamente expresiva y detallada; consulta los términos de la licencia de investigación |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB BF16 reportados en origen | 30 | 5-30 segundos; rango documentado, sin límite en tiempo de ejecución | Clonación, Voice Design, Ultimate Cloning asistido por transcripción, instrucciones de entonación | ~0.30 RTF en RTX 4090 de origen; transmisión en origen, el contenedor usa búfer | Un solo modelo multilingüe con el abanico más amplio de controles de voz |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | Núcleo de 0.5B; 16 GB cómodos, mayor espacio en descarga/ejecución | 9, incluido japonés, más dialectos del chino | 3-30 segundos; duraciones mayores se recortan a los primeros 30 s | Clonación, clonación cross-lingual, entonación en lenguaje natural | Enfoque de baja latencia; transmisión nativa de texto/audio en origen, el contenedor usa búfer | Un candidato prometedor para streaming con clonación cross-lingual |

El tamaño de modelo y la cantidad de idiomas siguen las páginas de origen de [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) y [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Consulta cada guía para conocer detalles de sistema operativo, controladores, licencias, versiones de modelos y memoria. Una GPU de 16 GB no necesariamente puede alojar de forma simultánea un modelo TTS y un LLM local grande.

La primera solicitud en modo automático de Qwen3-TTS incluye la carga del modelo. MOSS descarga previamente ambos modelos durante la configuración y precalienta el modelo de clonación al inicio por defecto, pero cualquier servidor en modo automático aún debe cargar el otro modelo tras un cambio de modo. TomoriBot espera hasta `TTS_SYNTHESIZE_TIMEOUT_MS` (240000 ms por defecto) para cada respuesta completa.
