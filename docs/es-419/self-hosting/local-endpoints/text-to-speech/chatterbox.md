---
title: "Chatterbox TTS"
aiGenerated: true
---

Clona voces en inglés con etiquetas de emociones utilizando el servidor local de texto a voz [Chatterbox](https://github.com/resemble-ai/chatterbox).

Chatterbox se ejecuta localmente mediante `servers/tts/chatterbox/server.py`. Utiliza por defecto el modelo rápido Chatterbox-Turbo (350 millones de parámetros) con etiquetas de eventos de emoción en línea como `[laugh]` y `[sigh]`. También puedes configurar el modelo ligero Chatterbox-Nano (110 millones de parámetros) para entornos en CPU, o el modelo estándar de 0.5B para sintonización de guía libre de clasificador (`cfg_weight`) y exageración emocional (`exaggeration`). Este contenedor no carga Chatterbox Multilingual V3.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio de TomoriBot, la carpeta donde clonaste TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Mantén esa terminal abierta mientras TomoriBot utilice Chatterbox. La URL del punto de conexión predeterminado es `http://127.0.0.1:8011`; define `CHATTERBOX_PORT` para usar otro puerto.

### Opcional: usar Chatterbox-Nano

Nano requiere una compilación de Chatterbox con la opción de cargador `nano=True`. Tras la configuración normal anterior, instala la revisión fijada de origen en el mismo entorno virtual. El hash de commit fija la versión compatible del código fuente; no constituye una garantía de seguridad. Este comando requiere `git` y conserva las dependencias de ejecución ya instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Luego define `CHATTERBOX_FAST_MODEL=nano` antes de iniciar el contenedor. Deja la variable sin definir para Turbo. En Windows PowerShell, establécela con `$env:CHATTERBOX_FAST_MODEL = "nano"`; en Linux o macOS, usa `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. La respuesta de `/health` informa `fast_model` para que puedas verificar la opción cargada. Nano y Turbo utilizan la misma solicitud de clonación y las mismas etiquetas de eventos admitidas. Ambos admiten únicamente inglés.

El interruptor de modelo rápido en `/config` debe permanecer activado para usar Nano o Turbo. Al desactivarlo, se selecciona el modelo estándar Chatterbox de 0.5B para la sintonización de peso CFG y exageración.

### Chatterbox estándar

Para usar el modelo estándar, desactiva `Modelo rápido (Turbo)` en `/config` > Modelos > Parámetros y voces TTS. El modelo estándar admite la sintonización de `cfg_weight` y `exaggeration`, pero no las etiquetas de eventos entre corchetes.

## Registro en TomoriBot

Incluye `Chatterbox` en la etiqueta del punto de conexión o en el nombre del modelo. TomoriBot reconoce un punto de conexión de Chatterbox únicamente por ese nombre (o por una URL de punto de conexión que lo contenga), por lo que la lista de etiquetas permitidas de Turbo, la eliminación de etiquetas del modelo estándar y las opciones de Chatterbox en `/generate voice-message` solo se aplican cuando está presente.

Ejecuta `/providers`, elige `+ Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Tras guardar la conexión, selecciónala y elige `+ Agregar nuevo modelo de voz` en el menú desplegable de modelos. Elige `Clon de voz` como `Modo de fuente de voz` y `Etiquetas entre corchetes` como `Estilo de marcado de script` para que las etiquetas de entonación se conserven al enviar.

Usa `/providers` para el registro del punto de conexión y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el punto de conexión registrado.

## Configurar una voz de persona

1. Prepara un clip de voz limpio de 10 segundos con un solo hablante y sin música de fondo.
2. Abre `/config` en Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` en Persona > Voz, y elige la persona y la muestra de voz.

Chatterbox requiere más de 5 segundos de audio. Procura que dure 10 segundos; el modelo utiliza una porción limitada de los clips más largos para el acondicionamiento.

## Sintonización opcional

En `/config` > Modelos > Parámetros y voces TTS, ajusta `cfg_weight` y `exaggeration` para el modelo estándar. Ambos tienen un valor predeterminado de `0.5`; valores más altos siguen la referencia con mayor precisión y aumentan la expresividad, respectivamente.

Las etiquetas de eventos admitidas para Turbo/Nano son `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` y `[laugh]`. Los descriptores no admitidos, como `[excited]`, `[whisper]` o `[smiles]`, se eliminan en lugar de enviarse a TTS.
