---
title: "MOSS-TTS"
---

Usa `servers/tts/moss/server.py` para probar la clonación de voz de MOSS y el diseño de voz descrito con texto a través de un endpoint local. El modo automático (Auto) selecciona el modelo de clonación cuando TomoriBot envía `ref_audio` y MOSS-VoiceGenerator cuando envía `instruct`. Mantiene solo un modelo cargado a la vez. Este es un sidecar de prueba, no una integración de transmisión de chat de voz de Discord.

El modelo de clonación predeterminado es [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), elegido como el punto de partida práctico para una GPU de 16 GB. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) es una alternativa de 8B pero generalmente necesitará más de 16 GB de VRAM en BF16. El diseño de voz usa [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (alrededor de 1.7B). El modo automático intercambia los modelos en lugar de mantener ambos en la VRAM, por lo que un cambio de modo aún incurre en un retraso de carga de GPU.

## Configuración

Ejecuta desde la raíz del repositorio de TomoriBot. Usa Python 3.12 y un controlador CUDA compatible con las ruedas PyTorch upstream CUDA 12.8. Los extras de tiempo de ejecución upstream fijan PyTorch y Torchaudio 2.9.1+cu128; mantén este sidecar en su propio entorno virtual. Otras pilas CUDA o CPU necesitan una instalación validada por separado.

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

El comando prefetch descarga el modelo de clonación, VoiceGenerator, y el tokenizador de audio de cada modelo en la caché de Hugging Face antes de que comience el servidor. Verifica el espacio disponible en disco del volumen de caché antes de cada descarga del repositorio y reutiliza los archivos almacenados en caché, pero ambos modelos necesitan un espacio considerable. Si la verificación falla, libera espacio o configura `HF_HOME` en un volumen mayor en el shell antes de la captación previa (prefetch) y de iniciar el servidor. Vuelve a ejecutar prefetch después de cambiar cualquier ID de modelo. Para descargar solo un modo para una prueba limitada, pasa `--mode clone` o `--mode voice-design`; el otro modo aún podría descargarse en su primer uso.

El endpoint es `http://127.0.0.1:8018`, y `bun run launch --moss` inicia el servidor junto con TomoriBot. El modo automático calienta el modelo de clonación desde la caché local antes de informar que el inicio se completó. Si el clon no se obtuvo previamente, el inicio falla en lugar de descargarlo de forma inesperada. `MOSS_TTS_WARM_MODE=voice-design` calienta el VoiceGenerator en su lugar; `MOSS_TTS_WARM_MODE=none` mantiene el inicio diferido anterior. Solo un modo permanece en la memoria de la GPU. Verifica `GET /health` para `warm_mode`, `active_mode`, y `model_id`. El envoltorio usa `trust_remote_code=True` de Hugging Face, así que instala solo de una fuente en la que confíes y revisa los cambios upstream antes de actualizar.

## Registro en TomoriBot

En `/providers`, elige **Agregar nuevo punto de conexión personalizado**, establece la compatibilidad de API en `tts-clone`, y usa la URL del endpoint `http://127.0.0.1:8018`. Agrega un modelo de Voz con el **Modo de fuente de voz** en `Auto` y **Estilo de marcado del guion** en `Plain`. Luego actívalo bajo `/config` > Modelos > Cambiar modelos.

Para la clonación, sube un clip de referencia limpio en `/config` > Modelos > Parámetros y voces TTS y asígnalo bajo Persona > Voz. El upstream no documenta ninguna longitud de referencia recomendada para MOSS-TTS ni ningún límite de duración en su tiempo de ejecución, así que la longitud del clip queda a tu criterio; los clips cortos y limpios siguen siendo la opción más segura por defecto. Para el diseño de voz, guarda una descripción de voz en lenguaje natural bajo Persona > Voz en su lugar. MOSS-TTS usa la referencia de audio; no usa la transcripción de referencia opcional de TomoriBot. MOSS-VoiceGenerator está documentado para inglés y chino, no japonés. El modelo de clonación de 4B admite japonés, pero una etiqueta de idioma conocida mejora la síntesis multilingüe.

El adaptador de clonación actual de TomoriBot no envía ninguna etiqueta de idioma. Para una prueba en un solo idioma, establece `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (o `English`, `Chinese`, etc.) antes de iniciar el servidor. Una solicitud manual `/synthesize` puede en su lugar proporcionar `language` por solicitud. Deja la variable sin establecer para uso de idiomas mixtos; evalúa la salida en japonés antes de depender de ella.

El sidecar lee su propio entorno de procesos. Agregar un valor al `.env` del bot no lo pasa automáticamente a un proceso de Python iniciado por separado.

Para probar la insignia de 8B en una máquina con suficiente memoria, configura `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes del prefetch. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` y `MOSS_TTS_MAX_NEW_TOKENS` también son configurables en `.env.optional.example`. El `TTS_SYNTHESIZE_TIMEOUT_MS` del bot puede necesitar un aumento para intercambios de modos o inferencia por CPU.
