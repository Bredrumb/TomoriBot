---
title: "MOSS-TTS"
aiGenerated: true
---

Evalúa la clonación de voz y el diseño de voz en lenguaje natural localmente a través de un punto de conexión de voz unificado mediante [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

El modelo de clonación predeterminado de 4B y el VoiceGenerator de 1.7B se intercambian en la memoria de la GPU cuando cambia el modo de voz, por lo que la primera solicitud tras un cambio toma más tiempo. El modelo de clonación de 8B requiere más VRAM.

## Configuración

Ejecuta los comandos desde la raíz del repositorio de TomoriBot usando Python 3.12 y un controlador compatible con CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux o WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

El comando de precarga descarga el modelo de clonación, VoiceGenerator y los tokenizadores de audio en tu caché de Hugging Face antes de iniciar el servidor. Si el espacio en disco es limitado, define `HF_HOME` hacia una partición más amplia. Para descargar únicamente un modelo, añade `--mode clone` o `--mode voice-design`.

El punto de conexión predeterminado es `http://127.0.0.1:8018`. Ejecuta `bun run launch --moss` para iniciar el servidor junto con TomoriBot. El modo automático precalienta el modelo de clonación desde la caché local. Define `MOSS_TTS_WARM_MODE=voice-design` para precalentar VoiceGenerator en su lugar, o `MOSS_TTS_WARM_MODE=none` para una inicialización diferida. Consulta `GET /health` para verificar los valores activos de `warm_mode`, `active_mode` y `model_id`. El contenedor utiliza Hugging Face `trust_remote_code=True`, por lo que se recomienda revisar el código de origen antes de actualizar.

## Registro en TomoriBot

En `/providers`, elige `+ Agregar nuevo punto de conexión personalizado`, define la Compatibilidad de API en `tts-clone` y usa la URL de punto de conexión `http://127.0.0.1:8018`. Añade un modelo de voz con el `Modo de fuente de voz` en `Automático` y el `Estilo de marcado de script` en `Plano`. Actívalo en `/config` > Modelos > Cambiar modelos.

Para la clonación de voz, sube un clip de referencia limpio en `/config` > Modelos > Parámetros y voces TTS y asígnalo en Persona > Voz. Los clips de audio limpios y más cortos ofrecen resultados más consistentes. Para el diseño de voz, guarda una descripción en lenguaje natural en Persona > Voz. Ten presente que MOSS-VoiceGenerator está diseñado para inglés y chino. Aunque el modelo de clonación de 4B admite japonés, las etiquetas de idioma explícitas mejoran la claridad de la síntesis.

El adaptador de clonación de TomoriBot no envía etiquetas de idioma automáticamente. Para el uso en un solo idioma, define `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (o `English`, `Chinese`, etc.) antes de iniciar el servidor. Las llamadas manuales a `/synthesize` pueden pasar `language` directamente.

El servidor lee su propio entorno de shell; las configuraciones en el `.env` del bot no se aplican a una terminal de Python iniciada de forma independiente.

Para ejecutar el modelo de 8B en hardware con alta memoria, define `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes de la precarga. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` y `MOSS_TTS_MAX_NEW_TOKENS` son configurables en `.env.optional.example`. Aumenta `TTS_SYNTHESIZE_TIMEOUT_MS` en TomoriBot si los intercambios de modelos o la ejecución en CPU generan tiempos de espera agotados.
