---
title: "Qwen3-TTS"
---

Usa `servers/tts/qwen3tts/server.py` para ambos modos de Qwen3-TTS 12Hz 1.7B, el texto a voz más grande pero más preciso entre las opciones actuales de TomoriBot. De forma predeterminada, se inicia en el modo automático (Auto), que elige el modelo base de clonación de voz o el modelo de Diseño de voz (VoiceDesign) de cada forma de solicitud.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio de TomoriBot, la carpeta donde clonaste TomoriBot:

### Usando Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Usando Linux/macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

La URL predeterminada del punto de conexión del modo automático es `http://127.0.0.1:8012`. También puedes especificar el modo automático explícitamente:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

El modo automático inspecciona cada solicitud de `/synthesize`: las solicitudes con `ref_audio` usan el modelo de clonación, mientras que las solicitudes con `instruct` usan el modelo de Diseño de voz. Mantiene solo un modelo cargado a la vez y los intercambia cuando el tipo de solicitud cambia, por lo que la primera solicitud después de un intercambio puede ser más lenta.

## Registro en TomoriBot

Para la mayoría de los usuarios, registra el servidor en modo automático para que un solo endpoint pueda admitir tanto las personas de clonación de voz como las de Diseño de voz.

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado**, y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. El formulario del modelo
pregunta por el **Modo de fuente de voz** y el **Estilo de marcado del guion**; elige `Auto` y `Plain` para el servidor de modo automático.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el endpoint registrado.

## Configuración de voces de personas

### Clonación de voz

Usa esto para las personas que deban imitar un clip de referencia:

1. Prepara un clip de voz limpio de 10-20 segundos con un solo orador y sin música de fondo.
2. Abre `/config` bajo Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` bajo Persona > Voz, luego elige la persona y la muestra de voz.

### Diseño de Voz

Usa esto para las personas que deban usar una descripción de voz escrita en lugar de una muestra:

1. Abre `/config` bajo Persona > Voz y elige VoiceDesign.
2. Elige la persona.
3. Ingresa un prompt de voz en lenguaje natural, como la edad del orador, el tono, el acento y la entrega.

Elimina un prompt de Diseño de Voz de una persona desde Persona > Voz en `/config`. Durante la generación, TomoriBot envía el prompt guardado en el cuerpo JSON de `/synthesize` como `instruct`; las instrucciones únicas de `voice_instructions` de la herramienta se adjuntan.

El modo automático mantiene ambas configuraciones. Las personas configuradas bajo Persona > Voz en `/config` usan la síntesis de clonación o la síntesis de Diseño de voz de acuerdo a su selección.

## (Opcional) Servidor solo para Diseño de voz

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

También puedes pasar `--mode voice-design` en lugar de establecer `TOMORI_TTS_MODE`. La URL predeterminada del punto de conexión solo para Diseño de voz es `http://127.0.0.1:8014`.

Regístralo de la misma manera que el modo automático, pero usa la URL de endpoint `http://127.0.0.1:8014` y elige `VoiceDesign`
como el Modo de fuente de voz en el modelo de Voz.
