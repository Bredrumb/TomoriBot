---
title: "IrodoriTTS"
---

Irodori-TTS v4.1 es un modelo de texto a voz enfocado en japonés con clonación de voz y Diseño de voz basado en subtítulos en un solo punto de control. TomoriBot lo ejecuta a través del envoltorio local FastAPI en `servers/tts/irodoritts/`.

El modelo predeterminado es `Aratako/Irodori-TTS-v4.1-Small`. Los puntos de control compatibles de Hugging Face se pueden seleccionar con `IRODORI_TTS_MODEL_ID`, incluyendo ajustes finos de la comunidad como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configuración

Irodori ahora usa `uv` para la gestión de dependencias y backend de PyTorch. Instala `uv` primero, luego ejecuta el script de configuración desde la raíz del repositorio de TomoriBot.

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

Los scripts de configuración crean `servers/tts/irodoritts/.venv`, por lo que `bun run launch --irodoritts` continúa funcionando después de la instalación.

Los backends disponibles son:

- `cu128`: NVIDIA CUDA 12.8 en Windows/Linux
- `cpu`: Solo CPU, o macOS CPU/MPS a través de PyPI
- `rocm`: AMD ROCm en Linux/WSL
- `xpu`: Intel XPU en Windows/Linux

La URL predeterminada del punto de conexión es `http://127.0.0.1:8013`.

## Uso de un punto de control diferente

El modelo predeterminado es `Aratako/Irodori-TTS-v4.1-Small`. Los repositorios compatibles de Hugging Face, ajustes finos de la comunidad (como `phasefield-audio/Irodori-TTS-v4.1-Anime`), o archivos de puntos de control locales se pueden configurar a través de variables de entorno.

Al iniciar el servidor (directamente con Python o a través de `bun run launch --irodoritts`), lee automáticamente el `.env` de la raíz del repositorio (o un `.env` local en `servers/tts/irodoritts/`) y registra el ID del modelo activo al inicio.

### A través de `.env` (Persistente)

Agrega a tu `.env` en la raíz de TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### A través de una variable de entorno por sesión

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

### Uso de un archivo de punto de control local

Si has descargado un archivo de punto de control (`.pt` o `.safetensors`) localmente, establece `IRODORI_TTS_CHECKPOINT` en su ruta:

```dotenv
IRODORI_TTS_CHECKPOINT="/ruta/a/punto_de_control_personalizado.pt"
```

El Irodori actual descarga el punto de control junto con cualquier activo de tokenizador incluido en el repositorio de Hugging Face. Las variantes de subcarpetas de Hugging Face también son admitidas por `IRODORI_TTS_MODEL_ID` cuando el repositorio del modelo las proporciona.

## Registro en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. Para la v4.1, las
configuraciones recomendadas son:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

`Auto` permite que el mismo endpoint de Irodori admita ambos modos de voz de TomoriBot, para que las pistas de emoción sobrevivan al envío:

- Las personas con una muestra de voz asignada bajo Persona > Voz envían un clip de referencia guardado para la clonación de voz.
- Las personas con un prompt de Diseño de voz establecido bajo Persona > Voz envían el prompt en lenguaje natural guardado como
  condicionamiento de subtítulos de Irodori.

Aún puedes elegir `Voice Clone` como Modo de fuente de voz si solo deseas la clonación de voz de audio de referencia.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para
seleccionar y activar el endpoint registrado.

## Configuración de voces de personas

### Clonación de voz

1. Prepara un clip de voz en japonés limpio con un solo orador y sin música de fondo. Alrededor de 30 segundos ya es suficiente: más allá de eso, el audio adicional aporta poco a la fidelidad del timbre y aumenta el tamaño de la carga y el tiempo de inferencia.
2. Abre `/config` bajo Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` bajo Persona > Voz, luego elige la persona y la muestra de voz.

Irodori v4.1 admite un condicionamiento de referencia más largo que el modelo v2 antiguo, pero el audio fuente limpio sigue siendo más importante que la duración bruta.

El entorno de ejecución de v4.1 limita el clip de referencia al valor predeterminado del punto de control, que el punto de control v4.1 establece en 120 segundos. Todo lo que sea más largo se recorta a ese límite en lugar de rechazarse, y `IRODORI_MAX_REF_SECONDS` lo anula. Por lo tanto, un clip en el límite de carga de 130 segundos de TomoriBot todavía funciona: Irodori usa como condicionamiento los primeros 120 segundos.

Más largo no es mejor aquí. El upstream informa que aproximadamente 30 segundos de habla de referencia limpia ya capturan la mayor parte de la ganancia medible de similitud con el orador, y que varios clips más cortos del mismo orador superan a una sola grabación larga. Los pasos de latente de referencia adicionales que acompañan a un clip más largo también alargan cada solicitud de síntesis. Solo supera los 30 segundos cuando el timbre del orador varíe a lo largo de la grabación.

### Diseño de Voz

1. Abre `/config` bajo Persona > Voz.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural de la voz y entrega deseadas.

TomoriBot envía este prompt como `instruct`; el envoltorio de Irodori lo asigna a la condición `caption` de v4.1. Las solicitudes de Diseño de voz no requieren un clip de referencia guardado.

TomoriBot elimina la sintaxis de emoji personalizados de Discord antes de enviar el texto al texto a voz. Con `script_markup: emoji`, los emojis Unicode se conservan para el condicionamiento de texto de Irodori.

### Controles de estilo con emoji

IrodoriTTS admite anotaciones con emoji en el texto de entrada para influir en los efectos de sonido, la forma de hablar y las expresiones emocionales. Con `Script Markup Style` de TomoriBot configurado como `Emoji`, estos emojis Unicode se conservan y se envían a Irodori.

| Emoji | Significado / emoción / estilo |
| --- | --- |
| 👂 | Susurro, sonidos cerca del oído |
| 😮‍💨 | Respiración, suspiro, respiración al dormir |
| ⏸️ | Pausa, silencio |
| 🤭 | Risita, risa contenida |
| 🥵 | Jadeo, gemido, gruñido |
| 📢 | Eco, reverberación |
| 😏 | En tono burlón, dulce y juguetón / persuasivo |
| 🥺 | Voz temblorosa, tímidamente / con inseguridad |
| 🌬️ | Falta de aire, respiración agitada |
| 😮 | Jadeo / inhalación repentina |
| 👅 | Sonido de lamer, masticar, sonidos húmedos |
| 💋 | Chasquido de labios / ruido de labios |
| 🫶 | Suavemente, con ternura |
| 😭 | Sollozo, llanto, tristeza |
| 😱 | Grito, alarido, chillido |
| 😪 | Con sueño, lánguidamente |
| 😴 | Hablar dormido, roncar |
| ⏩ | Habla rápida, atropellada, con prisa |
| 📞 | Como por teléfono o altavoz |
| 🐢 | Lentamente |
| 🥤 | Trago / sonido al tragar |
| 🤧 | Tos, aspirar por la nariz, estornudo, carraspeo |
| 😒 | Chasquido de lengua |
| 😰 | Con pánico, agitación, nervios, tartamudeo |
| 😆 | Con alegría, feliz |
| 💥 | Con fuerza / impulso |
| 😠 | Enojado, molesto, haciendo pucheros |
| 😲 | Sorpresa, asombro / exclamación |
| 🥱 | Bostezo |
| 😖 | Con dolor, agonía |
| 😟 | Con ansiedad, preocupación |
| 🫣 | Con timidez, vergüenza |
| 🙄 | Con exasperación, poniendo los ojos en blanco |
| 😊 | Alegremente, con gusto |
| 😎 | Con confianza, orgullosamente |
| 👌 | Asentimiento / sonido de acuerdo |
| 🙏 | Suplicando, rogando |
| 🥴 | Borracho |
| 🎵 | Tarareo |
| 🤐 | Voz amortiguada (boca cubierta) |
| 😌 | Aliviado, satisfecho |
| 🤔 | Voz interrogativa / de duda |
| 💪 | Con esfuerzo, con fuerza |
| 👃 | Sonido de olfatear |
| 📖 | Narración, monólogo |

Repetir el mismo emoji puede intensificar el efecto. El control mediante emoji no es perfectamente consistente, así que conviene tratarlos como indicaciones de estilo y no como una garantía del resultado. Consulta las [anotaciones oficiales de emoji de IrodoriTTS](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) para ver la lista original y futuras actualizaciones.

## Inferencia más rápida con Sway Sampling

El valor predeterminado sigue siendo el muestreo lineal de 40 pasos de mayor calidad de Irodori. Para menor latencia, prueba Sway Sampling con menos pasos:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Esta es una compensación entre calidad y velocidad de inferencia, así que pruébala con tu punto de control y voces elegidas antes de hacerla permanente.

## Por qué los scripts de instalación son más simples ahora

El instalador anterior de TomoriBot clonaba y parcheaba el `pyproject.toml` de Irodori, instalaba manualmente `dacvae` y fijaba un commit antiguo de Irodori de la era v2. Esas soluciones alternativas eran necesarias para el diseño del paquete upstream anterior, pero ya no son apropiadas para el Irodori actual.

El servidor ahora tiene su propio `pyproject.toml` y sigue la configuración del backend `uv` upstream. Irodori y `dacvae` permanecen fijados a commits conocidos allí para instalaciones reproducibles, pero TomoriBot ya no modifica el código fuente upstream durante la instalación.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repositorio de modelos de Hugging Face o fuente compatible de repositorio/subcarpeta |
| `IRODORI_TTS_CHECKPOINT` | sin establecer | Punto de control opcional local `.pt` o `.safetensors`; anula el modelo de Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del servidor; consulta [Acceso de red](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Puerto del servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Dispositivo del modelo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo del códec |
| `IRODORI_MODEL_PRECISION` | `bf16` en CUDA, de lo contrario `fp32` | Precisión del modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisión del códec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilitar `torch.compile` para el modelo Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilitar formas dinámicas al compilar |
| `IRODORI_NUM_STEPS` | `40` | Pasos de muestreo Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Programa de muestreo (`linear` o `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente Sway al usar el programa `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de orientación de texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de orientación de subtítulos / Diseño de voz |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de orientación del orador de referencia |
| `IRODORI_MAX_REF_SECONDS` | valor predeterminado del punto de control | Límite opcional en la duración del audio de referencia |
