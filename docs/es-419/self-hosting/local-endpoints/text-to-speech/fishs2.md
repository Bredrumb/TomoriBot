---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Sintetiza discursos de personajes multilingües altamente expresivos con etiquetas de emociones detalladas utilizando [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro es un modelo multilingüe de texto a voz de 4B parámetros desarrollado para la clonación de voz de alta fidelidad. TomoriBot se conecta al modelo mediante el contenedor local en `servers/tts/fishs2/`. Utiliza por defecto los pesos oficiales en BF16 (`fishaudio/s2-pro`), con un checkpoint opcional cuantizado en INT8 (`Imagilux/fishaudio-s2-pro`) para GPUs con 8 a 12 GB de VRAM.

Fish S2 Pro admite etiquetas de expresión entre corchetes como `[whisper]`, `[excited]` y `[angry]`. Configura el punto de conexión con el marcado `Etiquetas entre corchetes` para que TomoriBot conserve estos controles en los guiones de voz generados.

## Licencia

El código de Fish Speech y los pesos del modelo S2 Pro se distribuyen bajo la Licencia de Investigación de Fish Audio. La investigación y el uso no comercial están permitidos bajo sus términos; el uso comercial requiere una licencia independiente de Fish Audio.

TomoriBot no redistribuye los pesos del modelo. Cada usuario que opte por el autoalojamiento descarga Fish S2 Pro directamente de Hugging Face y es responsable de cumplir con la Licencia de Investigación de Fish Audio. La atribución requerida es: Built with Fish Audio.

## Hardware y sistemas operativos

> [!IMPORTANT]
> Usa Linux o WSL2 para obtener una velocidad de inferencia práctica. El contenedor desactiva la compilación por defecto; define `FISH_S2_COMPILE=1` para habilitar la compilación con Triton. En Windows nativo el proceso puede tardar de 8 a 10 minutos por clip.

Hardware recomendado:

- **Linux o WSL2 (altamente recomendado)**
- GPU NVIDIA con 16 GB a 24 GB de VRAM (BF16 se ajusta cómodamente en ~16-18 GB de VRAM con caché KV y descarga)
- Python 3.12 recomendado
- `git`, `ffmpeg` y bibliotecas de audio estándar requeridas por Fish Speech

## Configuración

### Linux y WSL2 (recomendado)

Desde la raíz del repositorio de TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

El instalador descarga el entorno de ejecución fijado de Fish Speech y el checkpoint oficial en BF16. Define `FISH_S2_MODEL_REVISION` con una revisión inmutable para descargas de modelos reproducibles.

El modelo en Hugging Face tiene acceso restringido (gated). Acepta su licencia en Hugging Face primero. Si la descarga solicita autenticación, ejecuta:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Luego vuelve a ejecutar el instalador.

### Windows PowerShell (solo como opción secundaria)

La ejecución nativa en Windows se proporciona únicamente para evaluación. Debido a la latencia de despacho de controladores en modo eager sin compilar, la generación será sumamente lenta (~8-10 minutos por clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

El instalador de PowerShell apunta a la aceleración por GPU CUDA (`cu124`) de forma predeterminada. Para instalar en una máquina que disponga solo de CPU sin GPU NVIDIA, añade `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Si en algún momento necesitas instalar o actualizar PyTorch en Windows manualmente con soporte CUDA, ejecuta:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot deja de esperar un mensaje de voz tras `TTS_SYNTHESIZE_TIMEOUT_MS` (240000 ms por defecto), lo cual resulta menor de lo que requiere un clip nativo en Windows. Aumenta este valor en el archivo `.env` de TomoriBot (por ejemplo `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) mientras realices pruebas en Windows.

## Transcripción de referencia obligatoria

> [!WARNING]
> Fish S2 Pro requiere la transcripción exacta del clip de referencia. Ingrésala en `Transcripción de referencia` bajo `/config` > Modelos > Parámetros y voces TTS; el contenedor rechazará las solicitudes que no la incluyan.

## Registro en TomoriBot

En `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y configura:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Modo de fuente de voz: `Clon de voz`
- Estilo de marcado de script: `Etiquetas entre corchetes`
- Clave de API: déjala vacía. El contenedor carece de autenticación; consulta [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access).

Luego añade la entrada del modelo del punto de conexión y actívala mediante `/config` bajo Modelos > Cambiar modelos.

## Agregar voces de personas

1. Prepara un clip de referencia limpio de 10 a 20 segundos con un solo hablante y poco o ningún ruido de fondo.
2. En `/config`, abre Modelos > Parámetros y voces TTS y sube la muestra de voz.
3. **Ingresa la transcripción exacta** pronunciada en el clip de referencia en el campo de texto de referencia.
4. En `/config`, abre Persona > Voz y asigna la muestra a la persona.
5. Genera un mensaje de voz con `/generate voice-message` o deja que TomoriBot genere uno mediante su herramienta de mensajes de voz.

El proyecto de origen recomienda clips de referencia de 10 a 30 segundos.

## Controles de expresión

Fish S2 Pro permite variar la entonación dentro de un enunciado utilizando etiquetas entre corchetes. Por ejemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Dado que el punto de conexión utiliza el marcado `Etiquetas entre corchetes`, TomoriBot preserva estas etiquetas en lugar de eliminarlas antes de la síntesis.

## Configuración

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Directorio del checkpoint de S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de modelos y etiqueta de metadatos de estado para el checkpoint configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de escucha del contenedor; consulta [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Puerto del contenedor de Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Puerto de API interna de Fish |
| `FISH_S2_COMPILE` | `0` | Habilita `torch.compile` en Fish Speech (requiere Linux/WSL2 con Triton) |
| `FISH_S2_HALF` | `0` | Solicita el modo de ejecución FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Longitud de fragmento del prompt iterativo de Fish |
| `FISH_S2_TOP_P` | `0.8` | Muestreo top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de muestreo |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalización por repetición |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximo de tokens semánticos generados por solicitud |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Almacena en caché las voces de referencia codificadas en el entorno de Fish |

### Variables del instalador

Leídas por `install-fishs2.sh` e `install-fishs2.ps1`. Registra cualquier valor que reemplaces para que el despliegue pueda reproducirse.

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de Hugging Face a descargar |
| `FISH_S2_MODEL_REVISION` | `main` | Revisión de Hugging Face a descargar |

El audio de referencia debe ser un archivo PCM RIFF/WAVE no vacío y sin comprimir, de un máximo de 10 MB decodificado. El límite se comprueba antes de la inferencia para evitar que una solicitud en base64 de tamaño excesivo consuma memoria sin control; da cabida a cerca de 237 segundos del audio mono a 22.05 kHz en WAV que envía TomoriBot.

## Opción de baja VRAM (cuantización INT8)

Los usuarios con GPUs de VRAM limitada (por ejemplo de 8 a 12 GB) que no puedan alojar el checkpoint oficial en BF16 pueden optar por el modelo cuantizado en INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar y ejecutar el checkpoint en INT8:

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

Inicia `server.py` desde la misma sesión de terminal, o define las mismas tres variables antes de lanzarlo, para que el contenedor cargue el directorio INT8 en lugar del BF16 predeterminado.

El checkpoint en INT8 reduce los pesos del transformador de ~10.3 GB a ~5.1 GB manteniendo las incrustaciones de audio y las capas del códec en BF16, ajustándose en un total aproximado de 10 GB de VRAM.
