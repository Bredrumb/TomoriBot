---
title: "VoxCPM2"
---

VoxCPM2 es el modelo multilingüe de texto a voz de 2B de parámetros de OpenBMB. Admite 30 idiomas, salida de 48 kHz, Diseño de voz en lenguaje natural, clonación de voz de audio de referencia, clonación controlable y "Clonación Definitiva" asistida por transcripción. TomoriBot usa el paquete oficial de Python `voxcpm` a través del ligero envoltorio en `servers/tts/voxcpm2/`.

El modelo predeterminado es el punto de control BF16 oficial `openbmb/VoxCPM2`. OpenBMB informa de aproximadamente **8 GB de VRAM** para el tiempo de ejecución estándar, por lo que el modelo normal se ajusta cómodamente a una GPU NVIDIA de 16 GB y no se necesita un punto de control cuantificado de forma predeterminada.

## Licencia

El código y los pesos del modelo VoxCPM2 se publican bajo **Apache-2.0**, incluido el uso comercial sujeto a los términos de la licencia. TomoriBot no redistribuye los pesos; el instalador los descarga del repositorio oficial de Hugging Face.

Recursos oficiales upstream:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 en Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Documentación de VoxCPM](https://voxcpm.readthedocs.io/)

## Idiomas admitidos

VoxCPM2 admite oficialmente 30 idiomas sin requerir una etiqueta de idioma:

Árabe, birmano, chino, danés, holandés, inglés, finlandés, francés, alemán, griego, hebreo, hindi, indonesio, italiano, japonés, jemer, coreano, lao, malayo, noruego, polaco, portugués, ruso, español, swahili, sueco, tagalo, tailandés, turco y vietnamita.

OpenBMB también documenta varios dialectos chinos. TomoriBot aún puede enviar un campo `language` para compatibilidad con el contrato común de texto a voz, pero VoxCPM2 detecta el idioma a partir del texto de síntesis y el envoltorio no fuerza una etiqueta de idioma.

## Modos de voz

Un endpoint VoxCPM2 puede manejar todos los modos de fuente de voz útiles de TomoriBot:

| Solicitud de TomoriBot | Comportamiento de VoxCPM2 |
|---|---|
| Solo `text` | Rechazado; elige una muestra de referencia o un prompt de Diseño de voz |
| `text` + `instruct` | Diseño de voz a partir de una descripción en lenguaje natural |
| `text` + `ref_audio` | Clonación de voz de audio de referencia |
| `text` + `ref_audio` + `instruct` | Clonación controlable: preserva al orador mientras dirige la entrega |
| `text` + `ref_audio` + `ref_text` | Clonación Definitiva usando el audio de referencia y su transcripción |
| `text` + `ref_audio` + `ref_text` + `instruct` | Clonación controlable; la instrucción única tiene prioridad y la transcripción no se envía |

VoxCPM2 representa el Diseño de voz y el control de estilo colocando una descripción en lenguaje natural entre paréntesis antes del texto a sintetizar. TomoriBot ya tiene un campo `instruct` para este propósito, por lo que el envoltorio realiza esa conversión automáticamente.

Usa el Estilo de marcado del guion **Plano**. VoxCPM2 no requiere que TomoriBot conserve las etiquetas entre corchetes o la sintaxis de control de emoji, y no es necesario un nuevo modo de Estilo de marcado del guion.

## Hardware y tiempo de ejecución

Punto de partida recomendado:

- Python **3.10-3.12**
- GPU NVIDIA con **8 GB VRAM o más** para el tiempo de ejecución oficial BF16; 12-16 GB proporcionan un margen cómodo
- Controlador NVIDIA actual y una compilación de PyTorch con CUDA habilitado para aceleración de GPU
- Se admite la CPU como respaldo, pero es sustancialmente más lenta

El paquete oficial también expone la selección de dispositivos CPU y Apple MPS. Para TomoriBot en Windows, el paquete estándar de Python puede ejecutarse de forma nativa; WSL no es necesario. El instalador de Windows PowerShell instala una compilación de PyTorch con CUDA habilitado (`cu124`) de forma predeterminada.

Para instalar explícitamente en una máquina solo con CPU, pasa el interruptor `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Si tu instalación nativa de PyTorch en Windows alguna vez necesita una reinstalación manual o una realineación de controladores, instala la compilación de PyTorch con CUDA habilitado directamente en el entorno virtual del sidecar:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB reporta aproximadamente 0.30 RTF en una RTX 4090 con el tiempo de ejecución estándar. Upstream también admite la generación en streaming y documenta las opciones de servicio más rápidas Nano-vLLM y vLLM-Omni. El contrato actual `POST /synthesize` de TomoriBot devuelve una respuesta WAV, por lo que este sidecar almacena intencionalmente en búfer el enunciado generado en lugar de exponer un protocolo de transmisión separado.

## Instalación

El sidecar fija el paquete estable actual `voxcpm` 2.0.3 y descarga `openbmb/VoxCPM2` en la caché normal de Hugging Face.

### Linux / WSL Bash

Desde la raíz del repositorio de TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

Desde la raíz del repositorio de TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

La primera configuración descarga varios gigabytes de pesos del modelo. Para instalar el entorno de Python sin obtener previamente el modelo, configura `VOXCPM2_PREFETCH=0`; la biblioteca oficial luego descargará el punto de control en el primer inicio del servidor.

Linux / WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Después de la configuración, `bun run launch --voxcpm2` inicia el sidecar junto con TomoriBot. El endpoint predeterminado es `http://127.0.0.1:8016`.

Si `VOXCPM2_API_KEY` o `TOMORI_TTS_API_KEY` están configurados, registra el endpoint con autenticación habilitada y guarda la misma clave en TomoriBot. El lanzador todavía prueba la ruta no autenticada `/health`, mientras que las solicitudes de síntesis usan `Authorization: Bearer <key>`.

## Registro en TomoriBot

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado**, y configura el endpoint de Voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Modo de fuente de voz: `Auto`
- Estilo de marcado del guion: `Plain`
- Compatibilidad con instrucciones: `Yes`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. Luego abre `/config` > Modelos > Cambiar modelos y selecciona el modelo de voz de VoxCPM2.

Se recomienda `Auto` porque el mismo servidor admite clonación de audio de referencia y Diseño de voz. No necesitas procesos separados de VoxCPM2 para los dos modos.

## Clonación de voz de persona

Para una persona que debe clonar a un orador existente:

1. Prepara un clip de referencia limpio con un solo orador y poca o ninguna música de fondo. La fuente upstream considera 5 a 30 segundos como el rango práctico.
2. Abre `/config` bajo Modelos > Parámetros y voces TTS y sube el clip.
3. Agrega la transcripción exacta del clip de referencia cuando esté disponible. VoxCPM2 la usa para Clonación Definitiva y puede reproducir más del ritmo, la emoción y el estilo de referencia.
4. Abre `/config` bajo Persona > Voz, elige la persona y asigna la muestra guardada.

Si no se guarda ninguna transcripción, VoxCPM2 aún realiza la clonación normal de audio de referencia.

La cifra de 5 a 30 segundos es un rango de calidad documentado, y no un límite aplicado: VoxCPM2 no aplica ningún límite propio de duración de la referencia, así que el techo de carga de TomoriBot es lo que detiene un clip más largo.

## Diseño de Voz de Persona

Para una persona que debe crearse a partir de una descripción de voz escrita en lugar de una muestra:

1. Abre `/config` bajo Persona > Voz y elige VoiceDesign.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural, como `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

TomoriBot envía la descripción guardada como `instruct`. VoxCPM2 la convierte en su prefijo nativo de control de Diseño de voz.

Cuando una persona clonada también recibe instrucciones de voz únicas, VoxCPM2 usa la clonación controlable: la muestra de referencia proporciona la identidad del orador mientras que la instrucción dirige cualidades como la emoción, el ritmo o la entrega. Si también se almacena una transcripción, la instrucción tiene prioridad porque la ruta upstream de Clonación Definitiva no proporciona un modo de instrucción de control confiable; la transcripción se omite intencionalmente para esa solicitud.

## `/generate voice-message`

Una vez que VoxCPM2 es el modelo de Voz activo, `/generate voice-message` usa la fuente de voz configurada de la persona de la misma manera que las llamadas a la herramienta de mensajes de voz normales:

- las personas clones envían el `ref_audio` guardado y el `ref_text` opcional;
- las personas de VoiceDesign envían su prompt guardado como `instruct`;
- los endpoints con capacidad de clonación con Compatibilidad con instrucciones habilitada exponen el campo de Dirección de entrega y pasan instrucciones únicas a través de `instruct`;
- cuando una instrucción está presente con una muestra clon, TomoriBot usa `reference_wav_path` únicamente y no envía los campos de prompt de transcripción.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID del modelo de Hugging Face o directorio del modelo local |
| `VOXCPM2_DEVICE` | `auto` | Dispositivo de tiempo de ejecución: `auto`, `cuda`, `cuda:N`, `cpu`, o `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Habilitar la ruta de optimización / compilación del tiempo de ejecución oficial |
| `VOXCPM2_LOAD_DENOISER` | `0` | Cargar el eliminador de ruido opcional upstream; deshabilitado de forma predeterminada para ahorrar memoria |
| `VOXCPM2_CFG_VALUE` | `2.0` | Fuerza de orientación |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Pasos de inferencia de coincidencia de flujo; más pueden mejorar la calidad a costa de la velocidad |
| `VOXCPM2_MAX_LEN` | `4096` | Longitud máxima de generación |
| `VOXCPM2_NORMALIZE` | `0` | Habilitar la normalización de texto upstream |
| `VOXCPM2_RETRY_BADCASE` | `1` | Habilitar el comportamiento de reintento upstream para generaciones anormales |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Reintentos automáticos máximos |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Umbral de longitud de caso malo upstream |
| `VOXCPM2_PREFETCH` | `1` | Solo instalador: descargar el modelo durante la configuración |
| `VOXCPM2_PORT` | `8016` | Puerto del sidecar de VoxCPM2; recurre a `TOMORI_TTS_PORT` si no está establecido |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del sidecar |
| `TOMORI_TTS_PORT` | `8016` | Recurso de puerto de sidecar compartido compatible con versiones anteriores |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` | Tamaño máximo de audio de referencia decodificado |
| `VOXCPM2_API_KEY` | sin establecer | Token portador opcional para `/synthesize`; se acepta `TOMORI_TTS_API_KEY` como respaldo |
| `TOMORI_TTS_API_KEY` | sin establecer | Recurso de token portador opcional compartido para `/synthesize` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | `0` | Establecer en `1` solo para permitir un enlace no loopback sin un token portador |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | Longitud máxima de texto de síntesis aceptada |

El audio de referencia debe ser un contenedor WAV no vacío. El envoltorio aplica el límite de bytes decodificados antes de escribir un archivo temporal. `/health` permanece sin autenticar para verificaciones de preparación locales; `/synthesize` requiere `Authorization: Bearer <key>` siempre que se configure una clave. Mantén el enlace de loopback predeterminado a menos que exista un proxy inverso o una política remota explícita.

## Puntos de control y tiempos de ejecución alternativos

El modelo BF16 oficial ya se adapta al objetivo previsto de GPU de consumo de 16 GB, por lo que TomoriBot no usa por defecto un punto de control cuantificado. Existen cuantificaciones de la comunidad, pero agregan otra capa de compatibilidad y mantenimiento sin ser necesarias para la configuración normal.

Para implementaciones de alto rendimiento, OpenBMB apunta actualmente a Nano-vLLM-VoxCPM y vLLM-Omni como opciones de servicio acelerado. Esos tiempos de ejecución pueden exponer funciones de transmisión y de servicio simultáneo más allá de este sidecar de referencia. No son requeridos para el flujo de trabajo local normal de mensajes de voz de TomoriBot, y este envoltorio se mantiene deliberadamente en la API oficial de `voxcpm` para que las actualizaciones del modelo upstream sigan siendo fáciles de seguir.
