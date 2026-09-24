---
title: "CosyVoice 3"
---

CosyVoice 3 es la generación actual del proyecto multilingüe de texto a voz CosyVoice de Alibaba/QwenAudio. TomoriBot envuelve el tiempo de ejecución oficial en `servers/tts/cosyvoice3/` y expone la misma interfaz `POST /synthesize` utilizada por los otros endpoints de voz locales.

TomoriBot usa por defecto el punto de control oficial **`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`**. Es el lanzamiento actual de CosyVoice 3 recomendado por los desarrolladores, usa el modelo normal sin cuantificar y es lo suficientemente pequeño como para ejecutarse cómodamente en una GPU NVIDIA de 16 GB manteniendo intacto el diseño de baja latencia de CosyVoice.

## Qué admite

El lanzamiento actual de CosyVoice 3 admite:

- Chino, inglés, japonés, coreano, alemán, español, francés, italiano y ruso
- 18+ dialectos y acentos chinos
- clonación de voz zero-shot
- clonación de voz multilingüe y translingüe
- instrucciones en lenguaje natural para el idioma, dialecto, emoción, velocidad de habla y volumen
- controles detallados en el tiempo de ejecución ascendente, incluyendo `[breath]` y `[laughter]`
- transmisión de entrada de texto y salida de audio en el tiempo de ejecución ascendente

Los ejemplos oficiales de CosyVoice 3 incluyen actualmente una importante advertencia para el japonés: el texto en japonés se muestra después de la conversión a katakana. El japonés es un idioma admitido, pero si la ortografía japonesa normal da una mala pronunciación, la solución alternativa recomendada es convertir el texto de síntesis a katakana.

## Cómo asigna las solicitudes TomoriBot

El envoltorio acepta los campos normales de `tts-clone`:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Elige la API actual de CosyVoice 3 de la siguiente manera:

| Solicitud | Ruta de CosyVoice 3 |
|---|---|
| Audio de referencia + transcripción | `inference_zero_shot` |
| Audio de referencia sin transcripción | `inference_cross_lingual` |
| `instruct` o `language` explícito | `inference_instruct2` |

Para obtener la mejor calidad de clonación ordinaria, proporciona tanto el audio de referencia como su transcripción coincidente. La API de instrucciones actual de CosyVoice 3 se condiciona con el audio de referencia pero no acepta también la transcripción de referencia, por lo que las solicitudes que usan `instruct` cambian a la ruta oficial `inference_instruct2`.

### Estilo y controles de emoción

Registra el endpoint con el marcado **Plano**. La directriz de entrega pertenece al campo global
`voice_instructions` del endpoint, no a etiquetas arbitrarias entre corchetes en línea. Esto preserva el significado de
la instrucción para todo el enunciado y evita tratar un guion como `[happy] Hello.
[sad] Goodbye.` como dos instrucciones globales contradictorias. El soporte nativo de `[breath]` y `[laughter]`
se pospone intencionalmente hasta que TomoriBot pueda anunciar una capacidad de etiqueta exacta consciente del proveedor.

El campo `instruct` de `/synthesize` se pasa al condicionamiento de instrucciones de CosyVoice 3. Ejemplos
incluyen `sound relieved but still tired`, `speak as quickly as possible`, o `speak quietly with
restrained excitement`.

## Transmisión

CosyVoice 3 admite transmisión bidireccional upstream. El proyecto documenta tanto la transmisión de texto de entrada como la de audio de salida, con una latencia de primer audio tan baja como aproximadamente 150 ms en su configuración optimizada.

La interfaz personalizada actual de texto a voz de TomoriBot espera una respuesta de audio completa para un mensaje de voz
de Discord, por lo que este servidor devuelve un WAV completo y predetermina la inferencia upstream a
`stream=False`. Configura `COSYVOICE3_UPSTREAM_STREAM=1` solo cuando pruebes el generador upstream; no
reduce la latencia de respuesta de TomoriBot hasta que exista un transporte de voz por transmisión.

## Hardware

Punto de partida recomendado para TomoriBot:

- GPU NVIDIA con **16 GB VRAM**
- Python **3.10**
- controlador NVIDIA reciente compatible con CUDA 12
- `git`
- `ffmpeg` para la normalización de muestras de voz de TomoriBot
- `sox` y `libsox-dev` en Linux si ocurren problemas de compatibilidad de audio upstream

El modelo en sí tiene 0.5B de parámetros y no necesita cuantificación para caber en una tarjeta de 16 GB. La descarga del punto de control de Hugging Face es mucho mayor de lo que sugiere el recuento de parámetros porque también incluye el modelo de flujo, los tokenizadores de voz, el modelo de texto en inglés y los pesos del LLM base y RL. Permite aproximadamente 10 GB de espacio en disco para el paquete de modelos actual, más el entorno de Python y el tiempo de ejecución.

La inferencia de CPU es posible a través del tiempo de ejecución upstream pero no es la ruta recomendada para el uso de voz de Discord de baja latencia.

## Instalación

### Linux / WSL2 (recomendado)

Desde la raíz del repositorio de TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

O inicia el servidor configurado y TomoriBot juntos:

```bash
bun run launch --cosyvoice3
```

El instalador:

1. clona recursivamente el commit revisado de `QwenAudio/CosyVoice` `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` en `servers/tts/cosyvoice3/CosyVoice/`;
2. crea `servers/tts/cosyvoice3/.venv`;
3. instala los requisitos actuales upstream de CosyVoice más el pequeño conjunto de dependencias del envoltorio; y
4. descarga `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` en la revisión de Hugging Face `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` en `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Las ejecuciones posteriores conservan esas revisiones exactas; pasar a revisiones más nuevas significa cambiar ambos valores fijados en el instalador. El instalador se niega a reinstalar sobre una copia del tiempo de ejecución que tenga cambios locales.

Los requisitos upstream actualmente usan PyTorch 2.3.1 con el índice del paquete CUDA 12.1, paquetes ONNX Runtime de CUDA 12 en Linux, y paquetes TensorRT 10.13 en Linux. Si estás usando hardware que requiere una compilación más reciente de PyTorch CUDA, instala una compilación compatible de PyTorch en el entorno virtual del servidor después de los requisitos upstream y pruébala con tu controlador.

### Windows PowerShell

El Windows nativo se proporciona como un esfuerzo de buena fe:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

Para uso de GPU NVIDIA, **se recomienda WSL2**. Los requisitos upstream actuales instalan GPU ONNX Runtime en Linux pero CPU ONNX Runtime en Windows, por lo que WSL2 se adapta más a la configuración que el proyecto CosyVoice optimiza y prueba para baja latencia.

## Registro en TomoriBot

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado**, y configura el endpoint de voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Modo de fuente de voz: `Clone`
- Estilo de marcado del guion: `Plain`
- Compatibilidad con instrucciones: `Yes`

Después de guardar la conexión, selecciónala y agrega un modelo de Voz. Un código de modelo claro es `Fun-CosyVoice3-0.5B-2512`.

Luego abre `/config` > Modelos > Cambiar modelos y activa el endpoint de voz de CosyVoice 3.

## Asignación de una voz de persona

Para la clonación zero-shot normal:

1. Prepara una muestra limpia de 3 a 30 segundos con un solo orador y poco o ningún ruido de fondo.
2. Abre `/config` bajo Modelos > Parámetros y voces TTS y sube la muestra.
3. Ingresa la transcripción coincidente cuando sea posible. CosyVoice 3 la usa para la ruta zero-shot respaldada por transcripción, y se tokeniza como prefijo del prompt, así que debe describir el audio que realmente se usa: los primeros 30 segundos del clip.
4. Abre `/config` bajo Persona > Voz y asigna esa muestra a la persona.

El tokenizador de voz de CosyVoice trabaja con una ventana de prompt de 30 segundos, y el upstream la impone al fallar: su propia interfaz web indica mantener el audio de prompt por debajo de 30 segundos, y el tokenizador afirma ese límite en lugar de acortar el audio en sí. En cambio, el servidor local recorta, así que un clip más largo se recorta a sus primeros 30 segundos, la síntesis continúa y el recorte queda registrado en la consola del servidor.

El recorte lee el clip en su propio lugar, lo que significa que el embedding de locutor se toma de los mismos 30 segundos iniciales que los tokens de voz del prompt. Es ese par lo que CosyVoice usa como condicionamiento, así que una referencia larga no pierde nada que el motor habría usado. El efecto práctico es que solo los 30 segundos iniciales de una subida larga condicionan la voz, mientras que el resto se sube y se almacena sin usarse.

Mantener la muestra asignada entre 10 y 20 segundos se queda dentro de la ventana con margen de sobra, lo que también mantiene la transcripción almacenada alineada con el audio que lee el modelo.

Se admite la clonación translingüe. El orador de referencia puede hablar un idioma diferente al del texto generado. Si una transcripción de referencia no está disponible, el envoltorio usa la ruta translingüe dedicada de CosyVoice 3.

## Prueba con `/generate voice-message`

Usa `/generate voice-message` para probar el endpoint activo sin esperar a que un turno normal de chat elija la herramienta de voz. Puedes usar la muestra configurada de la persona o subir una muestra única. Al subir una muestra, proporciona su transcripción en el modal cuando sea posible.

Para una entrega expresiva, ingresa una directriz global de entrega en el modal o deja que la herramienta de voz envíe
`voice_instructions`. Mantén el guion hablado como texto sin formato; las etiquetas de estilo en línea arbitrarias se eliminan
antes de la síntesis en lugar de representarse incorrectamente como instrucciones de todo el enunciado.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Directorio local del punto de control |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del envoltorio; consulta [Acceso de red](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Puerto del envoltorio |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilitar el generador de transmisión interna de CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador numérico global de velocidad pasado a la inferencia upstream |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vacío | Instrucción opcional añadida cuando una solicitud no proporciona una |
| `COSYVOICE3_FP16` | `0` | Pide al tiempo de ejecución oficial que use su modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilitar la carga upstream de TensorRT cuando se prepare adecuadamente |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilitar la carga upstream de vLLM cuando sus dependencias separadas estén instaladas |

El valor predeterminado mantiene TensorRT, vLLM y fp16 apagados. El tiempo de ejecución normal de PyTorch ya se ajusta a la GPU objetivo de 16 GB, es más simple de instalar y evita convertir la ruta predeterminada en una configuración específica de optimización.

## Rendimiento y variantes del modelo

### Predeterminado: `Fun-CosyVoice3-0.5B-2512` base

Esta es la opción predeterminada recomendada para TomoriBot. Tiene una fuerte similitud con el orador, admite todos los modos actuales de clonación e instrucción de CosyVoice 3 y no necesita cuantificación en una GPU de 16 GB.

### Peso RL

El paquete del punto de control actual también incluye `llm.rl.pt`. Upstream publica los resultados base y RL por separado. El peso RL mejora algunas métricas de error de contenido, mientras que el resultado base conserva puntuaciones de similitud de orador ligeramente más fuertes en la tabla publicada. Debido a que TomoriBot enfatiza la clonación de voz de la persona, el envoltorio deja el `llm.pt` normal como el predeterminado.

El cargador oficial actual siempre lee un archivo llamado `llm.pt`. Para experimentar con el peso RL sin sobrescribir la instalación predeterminada, copia el directorio del modelo, reemplaza el `llm.pt` de la copia por `llm.rl.pt`, y apunta `COSYVOICE3_MODEL_DIR` a esa copia.

### vLLM y TensorRT

CosyVoice 3 también admite rutas opcionales de vLLM y TensorRT. Upstream documenta actualmente vLLM 0.11.x+ usando el motor V1 y vLLM 0.9.0 como la ruta heredada. Estos tiempos de ejecución tienen restricciones adicionales de versión y hardware, por lo que TomoriBot no los instala ni los habilita de forma predeterminada.

Úsalos solo después de que el servidor de PyTorch ordinario esté funcionando. Para una carga de trabajo de mensaje de voz de Discord, evitar la complejidad adicional del tiempo de ejecución suele ser más útil que optimizar un modelo ya pequeño de 0.5B.

## Licencia

El repositorio de código actual de CosyVoice tiene licencia bajo la **Apache License 2.0**, y el repositorio de Hugging Face `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` también está marcado como **Apache-2.0**.

La tarjeta del modelo upstream contiene además un descargo de responsabilidad que dice que el contenido mostrado es para demostración académica y que algunos ejemplos pueden provenir de Internet. Una discusión upstream abierta pide una aclaración explícita sobre cómo se relaciona ese descargo de responsabilidad con el uso comercial de los pesos. TomoriBot no redistribuye el modelo. Los autoalojadores deben revisar la licencia actual upstream y los términos de la tarjeta del modelo para su propia implementación, especialmente antes del uso comercial.
