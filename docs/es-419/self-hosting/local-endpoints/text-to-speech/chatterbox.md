---
title: "Chatterbox TTS"
---

Usa `servers/tts/chatterbox/server.py` para la clonación de voz en inglés con etiquetas de eventos compatibles. La ruta del modelo rápido usa de forma predeterminada Chatterbox-Turbo (350M parámetros). Chatterbox-Nano (110M parámetros) puede seleccionarse para implementaciones más pequeñas orientadas a CPU. Este envoltorio no carga Chatterbox Multilingual V3.

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

Mantén esa terminal abierta mientras TomoriBot esté usando Chatterbox. La URL del punto de conexión predeterminado es `http://127.0.0.1:8011`.

### Opcional: usa Chatterbox-Nano

Nano requiere una compilación de Chatterbox con la opción del cargador `nano=True`. Después de la configuración normal anterior, instala la revisión anterior anclada en el mismo entorno virtual. El hash del commit fija la versión de origen compatible; no es una garantía de seguridad. Este comando requiere `git` y mantiene las dependencias en tiempo de ejecución ya instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Luego establece `CHATTERBOX_FAST_MODEL=nano` antes de iniciar el envoltorio. Deja la variable sin establecer para Turbo. En Windows PowerShell, establécela con `$env:CHATTERBOX_FAST_MODEL = "nano"`; en Linux o macOS, usa `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. La respuesta de `/health` informa `fast_model` para que puedas verificar la opción cargada. Nano y Turbo usan la misma solicitud de clonación y etiquetas de eventos compatibles. Ambos son solo en inglés.

El interruptor del modelo rápido de `/config` debe permanecer activado para usar Nano o Turbo. Desactivarlo selecciona el modelo Chatterbox 0.5B estándar para el ajuste del peso CFG y la exageración.

### Chatterbox Estándar (0.5B con CFG y Exageración)

El modelo original Chatterbox base de 0.5B (`ChatterboxTTS`) está integrado directamente en el envoltorio del servidor. Intercambia las etiquetas de eventos entre corchetes en línea de Turbo por un control vocal detallado usando **Orientación sin clasificador (`cfg_weight`)** y **`exaggeration`** emocional.

Para usar el modelo Estándar:
1. Inicia el envoltorio del servidor normalmente.
2. En Discord, ejecuta `/config` > **Modelos** > **Parámetros y voces TTS**.
3. Desactiva la opción **Modelo rápido de Chatterbox**.
4. En la siguiente generación, el envoltorio descarga y carga lentamente el modelo de 0.5B estándar en la memoria.

Ambos valores son campos de texto en el modal **Editar parámetros**. Siempre son editables, y la página señala que se ignoran mientras el modelo rápido esté activado:
- **`cfg_weight`** (predeterminado `0.5`): ajusta qué tan fielmente se adhiere el audio sintetizado al tempo de referencia y al estilo vocal.
- **`exaggeration`** (predeterminado `0.5`): controla la intensidad emocional y la inflexión dramática de la entrega.

> [!NOTE]
> El Chatterbox Estándar no admite etiquetas de eventos entre corchetes en línea (como `[laughs]` o `[sigh]`). TomoriBot elimina automáticamente las etiquetas entre corchetes del texto del prompt cuando el interruptor del Modelo rápido se desactiva.

## Registro en TomoriBot

Incluye `Chatterbox` en la etiqueta del punto de conexión o en el nombre del modelo. TomoriBot reconoce un endpoint de Chatterbox solo por ese nombre (o una URL del punto de conexión que lo contenga), por lo que la lista blanca de etiquetas de Turbo, la eliminación de etiquetas del modelo estándar y las opciones de Chatterbox en `/generate voice-message` se aplican solo cuando está presente.

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado** y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. Elige `Voice Clone` como el Modo de fuente de voz y `Bracket Tags` como el Estilo de marcado del guion para que las etiquetas de entrega sobrevivan al envío.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el endpoint registrado.

## Configuración de una voz de la persona

1. Prepara un clip de voz limpio de 10-20 segundos con un solo orador y sin música de fondo.
2. Abre `/config` bajo Modelos > Parámetros y voces TTS y sube el clip.
3. Abre `/config` bajo Persona > Voz, luego elige la persona y la muestra de voz.

Un clip más largo no aporta nada a Chatterbox. Su runtime trunca la referencia a los primeros 10 segundos para la condición del decodificador y a los primeros 6 segundos para la condición del codificador ([`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)), así que un clip de más de unos 10 segundos se sube, se almacena y luego se ignora en parte. El embedding del hablante se sigue calculando a partir del clip completo.

Turbo y Nano pueden usar etiquetas de eventos entre corchetes como `[laugh]` y `[sigh]` cuando el interruptor del modelo rápido está activado.

## Ajuste opcional

Usa `/config` bajo Modelos > Parámetros y voces TTS para ajustar la carga de la solicitud de Chatterbox:

- El interruptor del modelo rápido está activado de forma predeterminada. TomoriBot mantiene las etiquetas de eventos compatibles de Turbo/Nano y elimina los descriptores entre corchetes no compatibles antes de que el envoltorio llame a `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` de forma predeterminada es `0.5`. El mínimo es `0`; TomoriBot no establece un máximo rígido. Solo se aplica cuando `turbo` es `false`; los valores más bajos pueden ayudar a ralentizar las voces de referencia rápidas, mientras que los valores más altos siguen la referencia con más fuerza.
- `exaggeration` de forma predeterminada es `0.5`. El mínimo es `0`; TomoriBot no establece un máximo rígido. Solo se aplica cuando `turbo` es `false`; los valores más altos hacen que la entrega sea más expresiva o dramática y pueden acelerar el habla.

Las etiquetas de eventos compatibles de Turbo/Nano son `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]`, y `[laugh]`. Los descriptores no compatibles como `[excited]`, `[whisper]`, o `[smiles]` se eliminan en lugar de enviarse al texto a voz.

Cuando `turbo` está desactivado, TomoriBot elimina todos los descriptores entre corchetes antes de enviar el texto al texto a voz, luego el envoltorio carga lentamente el modelo `ChatterboxTTS` estándar y llama a `model.generate(..., cfg_weight, exaggeration)`.
