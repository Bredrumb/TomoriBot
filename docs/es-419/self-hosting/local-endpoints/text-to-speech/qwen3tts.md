---
title: "Qwen3-TTS"
aiGenerated: true
---

Sintetiza la voz de personajes multilingües con alta precisión utilizando [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) tanto en modo de clonación de voz como en modo VoiceDesign descrito por texto.

Qwen3-TTS 12Hz 1.7B ofrece síntesis de voz local de alta precisión. Ejecutar `servers/tts/qwen3tts/server.py` en su modo automático predeterminado selecciona dinámicamente el modelo Base de clonación de voz o el modelo VoiceDesign según cada solicitud entrante.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio de TomoriBot, la carpeta donde clonaste TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux y macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

La URL del punto de conexión en modo automático predeterminado es `http://127.0.0.1:8012`; define `QWEN3TTS_PORT` para utilizar otro puerto. También puedes especificar el modo automático de forma explícita:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

El modo automático inspecciona cada solicitud `/synthesize`: las solicitudes con `ref_audio` utilizan el modelo de clonación, mientras que las solicitudes con `instruct` utilizan el modelo VoiceDesign. Mantiene únicamente un modelo cargado a la vez e intercambia modelos cuando cambia el tipo de solicitud, por lo que la primera solicitud tras un cambio puede tardar más.

## Registro en TomoriBot

Para la mayoría de los usuarios, se recomienda registrar el servidor en modo automático para que un solo punto de conexión pueda admitir tanto personas de clonación de voz como de VoiceDesign.

Ejecuta `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Tras guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de voz. El formulario solicita el `Modo de fuente de voz` y el `Estilo de marcado de script`; elige `Automático` y `Plano` para el servidor en modo automático.

Usa `/providers` para el registro del punto de conexión y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el punto de conexión registrado.

## Configurar voces de persona

### Clonación de voz

Usa este modo para personas que deban imitar un clip de referencia:

1. Prepara un clip de voz limpio de 10 a 20 segundos con un solo hablante y sin música de fondo.
2. Abre `/config` en Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` en Persona > Voz, y elige la persona y la muestra de voz.

Qwen3-TTS admite clips de referencia de tan solo 3 segundos.

### VoiceDesign

Usa este modo para personas que deban utilizar una descripción escrita de la voz en lugar de una muestra:

1. Abre `/config` en Persona > Voz y elige VoiceDesign.
2. Elige la persona.
3. Ingresa una indicación de voz en lenguaje natural, como la edad del hablante, el tono, el acento y la entonación.

## Opcional: servidor exclusivo de VoiceDesign

Inicia el mismo servidor en modo VoiceDesign cuando sirvas `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

También puedes pasar `--mode voice-design` en lugar de definir `TOMORI_TTS_MODE`. La URL del punto de conexión predeterminado para el servidor exclusivo de VoiceDesign es `http://127.0.0.1:8014`.

Regístralo del mismo modo que el modo automático, pero usa la URL de punto de conexión `http://127.0.0.1:8014` y elige `VoiceDesign` como el Modo de fuente de voz en el modelo de voz.
