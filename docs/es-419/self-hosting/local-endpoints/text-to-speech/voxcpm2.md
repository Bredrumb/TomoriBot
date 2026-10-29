---
title: "VoxCPM2"
aiGenerated: true
---

Sintetiza voz expresiva a 48 kHz en 30 idiomas utilizando el modelo de texto a voz [VoxCPM2](https://github.com/OpenBMB/VoxCPM) de OpenBMB.

VoxCPM2 es un modelo de voz multilingüe de 2B parámetros que admite clonación de voz, Ultimate Cloning asistido por transcripción y Voice Design en lenguaje natural. TomoriBot se conecta a la biblioteca oficial de Python `voxcpm` mediante el servidor en `servers/tts/voxcpm2/`, ejecutando cómodamente el checkpoint oficial no cuantizado `openbmb/VoxCPM2` en BF16 en 16 GB de VRAM.

## Licencia

El código y los pesos del modelo de VoxCPM2 se distribuyen bajo la licencia Apache-2.0, permitiendo su uso comercial conforme a los términos de la licencia. TomoriBot no redistribuye los pesos; el instalador los descarga directamente del repositorio oficial en Hugging Face.

Recursos oficiales en el proyecto de origen:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 en Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Documentación de VoxCPM](https://voxcpm.readthedocs.io/)

## Idiomas admitidos

VoxCPM2 admite oficialmente 30 idiomas sin requerir una etiqueta de idioma:

Alemán, árabe, birmano, chino, coreano, danés, español, finlandés, francés, griego, hebreo, hindi, holandés, indonesio, inglés, italiano, japonés, jemer, lao, malayo, noruego, polaco, portugués, ruso, sueco, swahili, tagalo, tailandés, turco y vietnamita.

OpenBMB también documenta varios dialectos del chino. TomoriBot puede seguir enviando un campo `language` para mantener compatibilidad con el contrato estándar de TTS, pero VoxCPM2 detecta el idioma a partir del texto de síntesis y el contenedor no fuerza una etiqueta de idioma.

## Modos de voz

Usa el marcado `Automático` y `Plano` para clonación y diseño de voz. Una transcripción de referencia habilita Ultimate Cloning; una instrucción de entonación tiene prioridad y omite la transcripción para esa solicitud.

## Hardware y entorno de ejecución

Punto de partida recomendado:

- Python 3.10-3.12
- GPU NVIDIA con 8 GB de VRAM o más para el entorno oficial en BF16; 12-16 GB ofrecen un margen cómodo
- Controlador NVIDIA actualizado y compilación de PyTorch con soporte CUDA para aceleración por GPU
- La ejecución en CPU está admitida como alternativa secundaria, pero es sustancialmente más lenta

El paquete oficial también permite seleccionar dispositivos CPU y Apple MPS. Para TomoriBot en Windows, el paquete estándar de Python puede ejecutarse de forma nativa; no se requiere WSL. El instalador de Windows PowerShell instala por defecto una compilación de PyTorch con soporte CUDA (`cu124`).

Para realizar una instalación explícita en una máquina exclusivamente con CPU, añade el modificador `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Si en algún momento tu instalación nativa de PyTorch en Windows requiere una reinstalación manual o realineación de controladores, instala la compilación de PyTorch con CUDA directamente en el entorno virtual del servidor:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## Instalación

El servidor fija el paquete estable actual `voxcpm` 2.0.3 y descarga `openbmb/VoxCPM2` en la caché habitual de Hugging Face.

### Linux y WSL Bash

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

La primera configuración descarga varios gigabytes de pesos del modelo. Para instalar el entorno de Python sin precargar el modelo, define `VOXCPM2_PREFETCH=0`; la biblioteca oficial descargará el checkpoint en el primer inicio del servidor.

Linux y WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Tras la instalación, `bun run launch --voxcpm2` inicia el servidor conjuntamente con TomoriBot. El punto de conexión predeterminado es `http://127.0.0.1:8016`.

## Registro en TomoriBot

Ejecuta `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y configura el punto de conexión de voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Modo de fuente de voz: `Automático`
- Estilo de marcado de script: `Plano`
- Admite instrucciones: `Sí`

Tras guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de voz. Luego abre `/config` > Modelos > Cambiar modelos y selecciona el modelo de voz de VoxCPM2.

Se recomienda `Automático` porque el mismo servidor admite clonación por audio de referencia y Voice Design. No es necesario mantener procesos independientes de VoxCPM2 para los dos modos.

## Clonación de voz de persona

Para una persona que deba clonar a un hablante existente:

1. Prepara un clip de referencia limpio con un solo hablante y poco o ningún fondo musical. En origen se considera práctico el rango de 5 a 30 segundos.
2. Abre `/config` en Modelos > Parámetros y voces TTS y sube el clip.
3. Añade la transcripción exacta del clip de referencia cuando esté disponible. VoxCPM2 la utiliza para Ultimate Cloning y logra reproducir con mayor fidelidad el ritmo, emoción y estilo de referencia.
4. Abre `/config` en Persona > Voz, elige la persona y asigna la muestra guardada.

Si no se guarda ninguna transcripción, VoxCPM2 realiza la clonación normal por audio de referencia.

## Voice Design de persona

Para una persona que deba crearse a partir de una descripción escrita de la voz en lugar de una muestra:

1. Abre `/config` en Persona > Voz y elige VoiceDesign.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural como `Mujer joven adulta, voz suave y cálida, ritmo pausado, entonación ligeramente juguetona`.

En el caso de una voz clonada, las instrucciones puntuales de entonación tienen prioridad sobre la transcripción de referencia.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID del modelo en Hugging Face o directorio local del modelo |
| `VOXCPM2_DEVICE` | `auto` | Dispositivo de ejecución: `auto`, `cuda`, `cuda:N`, `cpu` o `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Habilita la ruta de optimización / compilación del entorno oficial |
| `VOXCPM2_LOAD_DENOISER` | `0` | Carga el supresor de ruido opcional de origen; desactivado por defecto para ahorrar memoria |
| `VOXCPM2_CFG_VALUE` | `2.0` | Intensidad de la guía |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Pasos de inferencia de coincidencia de flujo (flow-matching); más pasos pueden mejorar la calidad a costa de la velocidad |
| `VOXCPM2_MAX_LEN` | `4096` | Longitud máxima de generación |
| `VOXCPM2_NORMALIZE` | `0` | Habilita la normalización de texto de origen |
| `VOXCPM2_RETRY_BADCASE` | `1` | Habilita el mecanismo de reintentos de origen para generaciones anómalas |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Cantidad máxima de reintentos automáticos |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Umbral de relación de longitud para casos anómalos en origen |
| `VOXCPM2_PREFETCH` | `1` | Solo instalador: descarga el modelo durante la configuración |
| `VOXCPM2_PORT` | `8016` | Puerto del servidor local de VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de escucha del servidor local; consulta [Acceso a la red](/self-hosting/local-endpoints/text-to-speech/#network-access) |

El audio de referencia debe ser un contenedor WAV no vacío de 10 MB decodificados como máximo, lo cual el contenedor comprueba antes de escribir un archivo temporal.
