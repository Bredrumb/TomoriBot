---
title: "IrodoriTTS"
aiGenerated: true
---

Genera voz japonesa natural con clonación de voz, VoiceDesign basado en subtítulos y marcado expresivo con emojis mediante [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 es un modelo de texto a voz enfocado en japonés que admite tanto clonación de voz como VoiceDesign descrito por texto en un solo checkpoint. TomoriBot se conecta a Irodori a través del contenedor local con FastAPI en `servers/tts/irodoritts/`, utilizando por defecto `Aratako/Irodori-TTS-v4.1-Small`.

Se pueden seleccionar checkpoints compatibles de Hugging Face mediante `IRODORI_TTS_MODEL_ID`, incluidos ajustes finos de la comunidad como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configuración

Irodori utiliza `uv` para la gestión de dependencias y del backend de PyTorch. El servidor mantiene su propio `pyproject.toml` con dependencias fijadas de Irodori y `dacvae` para instalaciones reproducibles. Instala `uv` primero y luego ejecuta el script de instalación desde la raíz del repositorio de TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Los scripts de instalación crean `servers/tts/irodoritts/.venv`, por lo que `bun run launch --irodoritts` continúa funcionando después de la instalación.

Backends disponibles:

- `cu128`: NVIDIA CUDA 12.8 en Windows y Linux
- `cpu`: solo CPU, o CPU/MPS en macOS mediante PyPI
- `rocm`: AMD ROCm en Linux/WSL
- `xpu`: Intel XPU en Windows y Linux

La URL del punto de conexión predeterminado es `http://127.0.0.1:8013`.

## Usar un checkpoint diferente

El modelo predeterminado es `Aratako/Irodori-TTS-v4.1-Small`. Puedes seleccionar otros checkpoints oficiales (incluido el modelo Large de 3.29B parámetros y sus variantes cuantizadas), ajustes finos de la comunidad o archivos de checkpoint locales mediante variables de entorno.

### Checkpoints y variantes

| Modelo / `IRODORI_TTS_MODEL_ID` | Parámetros | Tamaño del checkpoint | VRAM recomendada | Notas |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | Modelo predeterminado: inferencia rápida y bajo consumo de memoria. |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | Modelo Large completo sin cuantizar con base de texto T5Gemma 2. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Pesos FP8 con activaciones en BF16: recomendado para NVIDIA Ada (serie RTX 40) y superiores. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Pesos INT8 de uso general con cómputo BF16 en NVIDIA CUDA. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | La variante de Large más compacta: requiere NVIDIA Ampere (serie RTX 30) o superior. |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | Ajuste fino de la comunidad para entonación al estilo anime. |

Para la clonación de voz, Small ofrece una calidad similar con inferencia más veloz. Large cuenta con un codificador de texto más potente y sigue las descripciones de VoiceDesign con mayor apego.

El servidor lee el archivo `.env` en la raíz del repositorio o un `.env` local en `servers/tts/irodoritts/.env`.

### Vía `.env` (persistente)

Añade a tu archivo `.env` en la raíz de TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Vía variable de entorno por sesión

En Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

En Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Usar un archivo de checkpoint local

Si descargaste un archivo de checkpoint (`.pt` o `.safetensors`) localmente, define `IRODORI_TTS_CHECKPOINT` con su ruta:

```dotenv
IRODORI_TTS_CHECKPOINT="/ruta/a/checkpoint_personalizado.pt"
```

La versión actual de Irodori descarga el checkpoint junto con los recursos del tokenizador incluidos en el repositorio de Hugging Face. Las variantes en subcarpetas de Hugging Face también son compatibles con `IRODORI_TTS_MODEL_ID` cuando el repositorio del modelo las proporciona.

## Registro en TomoriBot

Ejecuta `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Tras guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de voz. Para v4.1, la configuración recomendada es:

- `Modo de fuente de voz`: `Automático`
- `Estilo de marcado de script`: `Emoji`

`Automático` permite que el mismo punto de conexión de Irodori admita ambos modos de voz de TomoriBot, conservando las indicaciones emocionales al enviar:

- Las personas con una muestra de voz asignada en Persona > Voz envían el clip de referencia almacenado para clonación de voz.
- Las personas con un prompt de VoiceDesign configurado en Persona > Voz envían la indicación guardada en lenguaje natural como acondicionamiento por subtítulo (caption) de Irodori.

Puedes seguir utilizando `Clon de voz` como modo de fuente de voz si únicamente deseas clonación mediante audio de referencia.

Usa `/providers` para el registro del punto de conexión y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el punto de conexión registrado.

## Configurar voces de persona

### Clonación de voz

1. Prepara un clip de voz limpio en japonés con un solo hablante y sin música de fondo. Alrededor de 30 segundos es suficiente: más allá de ese punto, el audio adicional aporta poca fidelidad de timbre y aumenta el tamaño de subida y el tiempo de inferencia.
2. Abre `/config` en Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` en Persona > Voz, y elige la persona y la muestra de voz.

Irodori aplica por defecto un límite de referencia de 120 segundos y recorta los clips más largos. Define `IRODORI_MAX_REF_SECONDS` para modificar este límite.

### VoiceDesign

1. Abre `/config` en Persona > Voz.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural de la voz y entonación deseadas.

TomoriBot envía este texto como `instruct`; el contenedor de Irodori lo asigna a la condición `caption` de v4.1. Las solicitudes de VoiceDesign no requieren un clip de referencia guardado.

TomoriBot elimina la sintaxis de emojis personalizados de Discord antes de enviar texto a TTS. Con `script_markup: emoji`, los emojis Unicode se conservan para el acondicionamiento textual de Irodori.

### Controles de estilo con emojis

IrodoriTTS admite anotaciones con emojis en el texto de entrada para modular efectos de sonido, estilos de habla y expresiones emocionales. Al configurar el `Estilo de marcado de script` de TomoriBot en `Emoji`, estos emojis Unicode se conservan y se transmiten a Irodori.

Para conocer los emojis compatibles y sus significados, consulta las [anotaciones de emoji en origen](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md). Los emojis actúan como sugerencias de estilo y los resultados pueden variar.

## Mensajes de voz largos

Los textos extensos se dividen en fragmentos y se devuelven como un solo mensaje de voz. Las solicitudes largas pueden exceder el tiempo de espera predeterminado de 240 segundos; ajusta `TTS_SYNTHESIZE_TIMEOUT_MS` si es necesario. Define `IRODORI_CHUNKING_ENABLED=false` para desactivar la división o `IRODORI_CHUNK_MIN_CHARS` para modificar el umbral de corte.

## Inferencia más rápida con muestreo sway

El valor predeterminado sigue siendo el muestreo lineal de 40 pasos de alta calidad de Irodori. Para reducir la latencia, prueba el muestreo Sway con menos pasos:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Este ajuste intercambia calidad de inferencia por velocidad, por lo que conviene probarlo con tu checkpoint y voces elegidos antes de adoptarlo permanentemente.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repositorio del modelo en Hugging Face o fuente compatible de repositorio/subcarpeta |
| `IRODORI_TTS_CHECKPOINT` | no definida | Checkpoint local opcional `.pt` o `.safetensors`; tiene prioridad sobre el modelo de Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de escucha del servidor; consulta [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Puerto del servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Dispositivo para el modelo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo para el códec |
| `IRODORI_MODEL_PRECISION` | `bf16` en CUDA, de lo contrario `fp32` | Precisión del modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisión del códec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilita `torch.compile` para el modelo Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilita formas dinámicas al compilar |
| `IRODORI_NUM_STEPS` | `40` | Pasos de muestreo de Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Esquema de muestreo (`linear` o `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente sway al usar el esquema `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de guía de texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de guía para subtítulos / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de guía para el hablante de referencia |
| `IRODORI_MAX_REF_SECONDS` | valor predeterminado del checkpoint | Límite opcional para la duración del audio de referencia |
| `IRODORI_CHUNKING_ENABLED` | `true` | Divide el texto largo en límites válidos de puntuación y concatena los fragmentos generados |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Mínimo de caracteres sin espacios en blanco antes de cortar en límites oracionales fuertes; las comas sirven de límites secundarios a aproximadamente 1.5 veces este valor |
