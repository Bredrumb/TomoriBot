---
title: "Fish Audio S2 Pro"
---

Fish Audio S2 Pro es un modelo de texto a voz multilingüe de 4B enfocado en la clonación de voz de alta fidelidad y la entrega expresiva. TomoriBot lo usa a través del envoltorio local en `servers/tts/fishs2/`.

La configuración predeterminada de TomoriBot usa los pesos oficiales BF16 (`fishaudio/s2-pro`) para proporcionar la fidelidad de síntesis más alta y evitar incompatibilidades de cuantificación. Para los usuarios con GPU de consumo con memoria limitada, se admite una cuantificación INT8 opcional de solo peso (`Imagilux/fishaudio-s2-pro`) a través de anulaciones de entorno.

Fish S2 Pro admite etiquetas de expresión entre corchetes como `[whisper]`, `[excited]`, y `[angry]`. Configura el endpoint con el marcado **Etiquetas entre corchetes** para que TomoriBot conserve estos controles en los guiones de voz generados.

## Licencia

El código de Fish Speech y los pesos del modelo S2 Pro se distribuyen bajo la Licencia de Investigación de Fish Audio. Se permite la investigación y el uso no comercial bajo sus términos; el uso comercial requiere una licencia de Fish Audio separada.

TomoriBot no redistribuye los pesos del modelo. Cada usuario de autoalojamiento descarga Fish S2 Pro directamente de Hugging Face y es responsable de cumplir con la Licencia de Investigación de Fish Audio. La atribución requerida es: **Built with Fish Audio**.

## Hardware y Sistema Operativo

> [!IMPORTANT]
> **Usa Linux o WSL2 para Fish Speech:** Fish Audio se dirige oficialmente a Linux y WSL2. Fish S2 Pro usa una arquitectura Dual-Autoregressive (Dual-AR) (36 capas lentas de transformadores + 10 pasadas rápidas de codebook = 76 evaluaciones de capas por token). En Linux, OpenAI Triton puede compilar este bucle anidado en kernels fusionados de GPU (`torch.compile(backend="inductor")`), que según los benchmarks upstream permite la síntesis en tiempo real en GPU de servidores Linux. El envoltorio deja la compilación desactivada de forma predeterminada, así que configura `FISH_S2_COMPILE=1` para usarla.
>
> En el Windows nativo, Triton no es compatible, lo que obliga a PyTorch a un modo entusiasta sin compilar con más de 120,000 despachos secuenciales de kernel CUDA a través del controlador de Windows WDDM. Esto causa un grave estancamiento de despacho, lo que ralentiza la generación hasta **~8-10 minutos** (~65s de cómputo por segundo de audio) para exactamente el mismo clip. Para una inferencia utilizable, **ejecuta Fish S2 Pro dentro de Linux o WSL2**.

Hardware recomendado:

- **Linux o WSL2 (Altamente Recomendado)**
- GPU NVIDIA con **16 GB a 24 GB VRAM** (BF16 cabe cómodamente en ~16-18 GB VRAM con almacenamiento en caché KV y descarga)
- Se recomienda Python 3.12
- `git`, `ffmpeg`, y las bibliotecas de audio estándar requeridas por Fish Speech

## Configuración

### Linux / WSL2 (Recomendado)

Desde la raíz del repositorio de TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

El instalador:

1. clona `Imagilux/fish-speech` en `servers/tts/fishs2/fish-speech/` y cambia al commit de tiempo de ejecución fijado;
2. crea el `.venv` aislado;
3. instala Fish Speech más las dependencias del envoltorio de TomoriBot; y
4. descarga el punto de control oficial BF16 `fishaudio/s2-pro` en `fish-speech/checkpoints/fish-speech-s2-pro/`.

Una reinstalación normal se mantiene en el commit de tiempo de ejecución fijado `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` en lugar
de seguir una rama en movimiento. La revisión del modelo predeterminada es `main`; fija `FISH_S2_MODEL_REVISION` a
una revisión inmutable de Hugging Face cuando una implementación deba ser reproducible. La configuración del instalador
se enumera en [Variables del instalador](#installer-variables).

El modelo de Hugging Face está restringido. Acepta primero su licencia en Hugging Face. Si la descarga pide autenticación, ejecuta:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Luego vuelve a ejecutar el instalador.

### Windows PowerShell (Solo esfuerzo de buena fe)

El Windows nativo se proporciona solo para evaluación. Debido a la latencia de despacho del controlador en el modo entusiasta sin compilar, la generación será extremadamente lenta (~8-10 minutos por clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

El instalador de PowerShell se dirige a la aceleración de GPU CUDA (`cu124`) de forma predeterminada. Para instalar en una máquina solo con CPU sin una GPU NVIDIA, pasa `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Si PyTorch en Windows alguna vez necesita ser instalado o actualizado manualmente con soporte de CUDA, ejecuta:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot deja de esperar un mensaje de voz después de `TTS_SYNTHESIZE_TIMEOUT_MS` (predeterminado 240000 ms), lo cual
es más corto de lo que tarda un clip de Windows nativo. Auméntalo en el `.env` de TomoriBot (por ejemplo
`TTS_SYNTHESIZE_TIMEOUT_MS=900000`) mientras lo evalúas en Windows.

## Transcripción de Referencia Obligatoria

> [!WARNING]
> **El Texto de Referencia (`ref_text`) es requerido para la clonación de voz:** el mecanismo de atención cruzada de Fish S2 Pro requiere la transcripción del audio de referencia para alinear los tokens fonéticos con los códigos acústicos.
>
> Si subes una muestra de voz sin proporcionar su transcripción de referencia coincidente, Fish Speech **descarta silenciosamente los tokens de audio de referencia** y recurre a la voz de referencia cero aleatoria. El envoltorio Fish de TomoriBot valida y rechaza las solicitudes de síntesis que carecen de texto de referencia con un `400 Bad Request` para prevenir una generación accidental sin condicionamiento.

Al agregar una voz de persona en `/config` bajo **Modelos > Parámetros y voces TTS**, siempre completa el campo **Transcripción de referencia** con el texto literal hablado en tu clip de audio de referencia.

## Registro en TomoriBot

En `/providers`, elige **Agregar nuevo punto de conexión personalizado** y configura:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Modo de fuente de voz: `Clone`
- Estilo de marcado del guion: `Bracket Tags`
- Clave de API: déjalo vacío para la configuración loopback predeterminada. Si la autenticación de portador está habilitada, ingresa el valor exacto de `FISH_S2_API_KEY`.

Luego agrega la entrada del modelo del endpoint y actívala a través de `/config` bajo Modelos > Cambiar modelos.

## Agrega voces de personas

1. Prepara un clip de referencia limpio de 10-20 segundos con un solo orador y poco o ningún ruido de fondo.
2. En `/config`, abre Modelos > Parámetros y voces TTS y sube la muestra de voz.
3. **Ingresa la transcripción exacta** hablada en el clip de referencia en el campo de texto de referencia.
4. En `/config`, abre Persona > Voz y asigna la muestra a la persona.
5. Genera un mensaje de voz con `/generate voice-message` o deja que TomoriBot genere uno a través de su herramienta de mensajes de voz.

## Controles de expresión

Fish S2 Pro puede variar la entrega dentro de un enunciado usando etiquetas entre corchetes. Por ejemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Debido a que el endpoint usa el marcado `Bracket Tags`, TomoriBot conserva estas etiquetas en lugar de eliminarlas antes de la síntesis.

## Configuración

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Directorio de tiempo de ejecución de Fish Speech |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Directorio del punto de control S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de modelos y etiqueta de metadatos de salud para el punto de control configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del envoltorio de TomoriBot |
| `FISH_S2_PORT` | `8015` | Puerto del envoltorio Fish; recurre a `TOMORI_TTS_PORT` cuando no está establecido |
| `TOMORI_TTS_PORT` | sin establecer | Anulación del puerto compartido compatible con versiones anteriores |
| `FISH_S2_API_KEY` | sin establecer | Token portador opcional, también requerido para enlaces remotos autenticados |
| `TOMORI_TTS_API_KEY` | sin establecer | Recurso de token portador compartido cuando `FISH_S2_API_KEY` no está establecido |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | Permitir explícitamente un enlace no loopback sin un token portador |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | Tamaño máximo de WAV de referencia decodificado |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | sin establecer | Recurso de límite de audio de referencia decodificado compartido |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | Dirección de enlace interna de la API de Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Puerto de la API interna de Fish |
| `FISH_S2_COMPILE` | `0` | Habilitar Fish Speech `torch.compile` (requiere Linux/WSL2 con Triton) |
| `FISH_S2_HALF` | `0` | Solicitar modo de tiempo de ejecución FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Longitud del trozo del prompt iterativo de Fish |
| `FISH_S2_TOP_P` | `0.8` | Muestreo top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de muestreo |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalización por repetición |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximos tokens semánticos generados por solicitud |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Almacenar en caché las voces de referencia codificadas en el tiempo de ejecución de Fish |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | Longitud máxima del guion aceptada por el envoltorio |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | Tiempo máximo de espera para la API anidada de Fish |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | Tiempo máximo de espera para una solicitud de síntesis upstream |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | Cuánto tiempo espera `bun run launch --fishs2` por la comprobación de estado del envoltorio |

### Variables del instalador

Leídas por `install-fishs2.sh` e `install-fishs2.ps1`. Registra cualquier valor que anules para que la implementación pueda reproducirse.

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Repositorio de tiempo de ejecución de Fish Speech, por ejemplo un espejo revisado |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | Commit de tiempo de ejecución comprobado en la instalación |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de Hugging Face para descargar |
| `FISH_S2_MODEL_REVISION` | `main` | Revisión de Hugging Face para descargar |
| `FISH_S2_UPDATE` | `0` | Establecer en `1` para actualizar deliberadamente el tiempo de ejecución y volver a descargar el modelo |
| `FISH_S2_UPDATE_REF` | sin establecer | Referencia de tiempo de ejecución para una actualización. Sin ella, se mantiene un explícito `FISH_S2_RUNTIME_REF`; de lo contrario, la actualización usa `main` |
| `FISH_S2_UPDATE_MODEL_REVISION` | sin establecer | Revisión del modelo para una actualización, con la misma precedencia que `FISH_S2_UPDATE_REF` |

El audio de referencia debe ser un archivo RIFF/WAVE PCM no vacío y sin comprimir. El límite de tamaño decodificado se
verifica antes de la inferencia para evitar que una solicitud base64 de gran tamaño consuma memoria sin límites.

## Opción de VRAM Baja (Cuantificación INT8)

Los usuarios que se ejecutan en GPU con VRAM limitada (por ejemplo, 8-12 GB) que no pueden alojar el punto de control BF16 oficial pueden optar por el modelo cuantificado INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar y ejecutar el punto de control INT8:

```bash
# En Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# En Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Inicia `server.py` desde el mismo shell, o establece las mismas tres variables antes de lanzarlo, para que el envoltorio cargue el directorio INT8 en lugar del valor predeterminado BF16.

El punto de control INT8 reduce los pesos del transformador de ~10.3 GB a ~5.1 GB mientras mantiene las incrustaciones de audio y las capas del códec en BF16, cabiendo dentro de un total de VRAM de ~10 GB.
