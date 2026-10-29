---
title: "CosyVoice 3"
aiGenerated: true
---

Sintetiza voces de personajes naturales y multilingües con modulación emocional basada en instrucciones utilizando [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) de Alibaba.

CosyVoice 3 ofrece clonación de voz de disparo cero (zero-shot) y cross-lingual en 9 idiomas y más de 18 dialectos del chino. TomoriBot encapsula el entorno de ejecución oficial en `servers/tts/cosyvoice3/` para exponer la interfaz de voz estándar `POST /synthesize`. El instalador incluido usa por defecto el modelo oficial no cuantizado `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, ejecutándose en 16 GB de VRAM.

CosyVoice admite nueve idiomas y dialectos del chino. Si la pronunciación en japonés no es óptima, el proyecto de origen recomienda convertir el texto a katakana.

Usa el marcado de script `Plano` y proporciona instrucciones de entonación a través de `voice_instructions`. Una transcripción de referencia coincidente permite la clonación de disparo cero; sin ella, el servidor recurre a la clonación cross-lingual. Las instrucciones utilizan el audio de referencia sin su transcripción.

## Hardware

Hardware recomendado:

- GPU NVIDIA con 16 GB de VRAM
- Python 3.10
- Controlador NVIDIA compatible con CUDA 12
- `git`
- `ffmpeg` para normalización de muestras de voz
- `sox` y `libsox-dev` en Linux si se presentan problemas de compatibilidad de audio

El modelo de 0.5B parámetros cabe fácilmente en 16 GB de VRAM sin cuantización. La descarga del checkpoint incluye modelos de flujo, tokenizadores de voz, modelos de texto y pesos de aprendizaje por refuerzo, ocupando cerca de 10 GB de espacio en disco más las dependencias de Python.

Aunque la inferencia en CPU está técnicamente admitida en origen, resulta demasiado lenta para interacciones de voz en Discord.

## Instalación

### Linux y WSL2 (recomendado)

Desde la raíz del repositorio de TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

O inicia el servidor configurado junto con TomoriBot:

```bash
bun run launch --cosyvoice3
```

El instalador descarga las revisiones fijadas del entorno de ejecución y del modelo, y se niega a sobrescribir una copia de trabajo con cambios locales sin confirmar.

Los requisitos de origen instalan PyTorch 2.3.1 con paquetes CUDA 12.1, paquetes CUDA 12 ONNX Runtime en Linux y paquetes TensorRT 10.13 en Linux. Si tu GPU requiere una compilación más reciente de PyTorch, instala una compilación compatible dentro del entorno virtual una vez completada la instalación.

### Windows PowerShell

La ejecución nativa en Windows se ofrece como opción secundaria:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

Se recomienda encarecidamente WSL2 para el uso de GPUs NVIDIA en Windows. Los requisitos de origen instalan ONNX Runtime exclusivamente para CPU en Windows, mientras que Linux y WSL2 instalan paquetes acelerados por GPU.

## Registro en TomoriBot

Ejecuta `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y configura el punto de conexión de voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Modo de fuente de voz: `Clon de voz`
- Estilo de marcado de script: `Plano`
- Admite instrucciones: `Sí`

Tras guardar la conexión, selecciónala y agrega un modelo de voz. Un código de modelo claro es `Fun-CosyVoice3-0.5B-2512`.

Luego abre `/config` > Modelos > Cambiar modelos y activa el punto de conexión de voz de CosyVoice 3.

## Asignar una voz de persona

Para la clonación de voz de disparo cero:

1. Prepara un clip de audio limpio de 3 a 30 segundos con un solo hablante y un mínimo de ruido de fondo.
2. Abre `/config` en Modelos > Parámetros y voces TTS y sube la muestra.
3. Ingresa la transcripción coincidente cuando esté disponible. CosyVoice 3 tokeniza esta transcripción como prefijo de prompt para la clonación de disparo cero; debe describir los primeros 30 segundos del audio.
4. Abre `/config` en Persona > Voz y asigna la muestra a la persona.

El contenedor recorta el audio de referencia a los primeros 30 segundos. La clonación cross-lingual puede utilizar una referencia hablada en un idioma diferente al del texto generado.

## Probar con `/generate voice-message`

Usa `/generate voice-message` para probar la síntesis sin esperar una activación automática en el chat. Puedes probar con la muestra asignada a la persona o subir un clip temporal con su respectiva transcripción.

Para guiar la emoción y la entonación, ingresa indicaciones en el modal o permite que el prompt de la persona proporcione `voice_instructions`. Mantén el texto hablado como diálogo simple; las etiquetas de estilo en línea se eliminan antes de la síntesis.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Directorio local del checkpoint |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de escucha del contenedor; consulta [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Puerto del contenedor |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilita el generador de transmisión interno de CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador numérico global de velocidad para la inferencia en origen |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vacío | Instrucción opcional agregada cuando una solicitud no proporciona ninguna |
| `COSYVOICE3_FP16` | `0` | Solicita al entorno oficial utilizar su modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilita la carga de TensorRT en origen cuando esté debidamente preparado |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilita la carga de vLLM en origen cuando sus dependencias independientes estén instaladas |

Por defecto, TensorRT, vLLM y fp16 permanecen desactivados. El entorno de ejecución estándar de PyTorch opera con soltura en GPUs de 16 GB sin dependencias adicionales.

## Variantes del modelo

Para probar los pesos de aprendizaje por refuerzo incluidos, copia el directorio del modelo, cambia el nombre de `llm.rl.pt` a `llm.pt` en la copia y apunta `COSYVOICE3_MODEL_DIR` a él. Los entornos opcionales vLLM y TensorRT requieren dependencias independientes.

## Licencia

El código de CosyVoice y los pesos `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` se publican bajo la licencia Apache-2.0.

La ficha del modelo en origen señala que los materiales de demostración están destinados a evaluación académica. TomoriBot no distribuye pesos de modelos. Revisa las licencias y términos de origen para tu caso de uso específico antes de implementar comercialmente.
