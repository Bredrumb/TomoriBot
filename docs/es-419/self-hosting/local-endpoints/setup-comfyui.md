---
title: "Configuración: ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 2
---

TomoriBot puede generar imágenes y videos a través de tu propia instancia de [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Controla ComfyUI enviando un flujo de trabajo en formato API con tu prompt/tamaño sustituido, y luego sondea el punto de conexión `/history` de ComfyUI hasta que la salida esté lista.

Esta guía cubre la instalación/ejecución de ComfyUI y su registro. Para crear o editar un flujo de trabajo compatible con TomoriBot (los marcadores de posición `{TOMORI_*}`), consulta el [README de flujos de trabajo](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) en GitHub.

:::note[No se necesitan variables de entorno]
ComfyUI se registra a través de comandos de barra de Discord y se almacena cifrado en la base de datos. Consulta el [centro de puntos de conexión locales](/self-hosting/local-endpoints/).
:::

## Requisitos de hardware

La generación de imágenes y videos está limitada por la GPU: el costo principal es la VRAM (la memoria de tu tarjeta gráfica, independiente de la RAM del sistema), determinada por el checkpoint del modelo que carga tu flujo de trabajo. Se recomienda encarecidamente una GPU NVIDIA. Los dos flujos de trabajo incluidos en TomoriBot son modelos modernos, más pesados que SDXL:

| Flujo de trabajo incluido | Modelo base | VRAM práctica | Notas |
|---|---|---|---|
| Anima v1 (imagen) | Qwen-Image (~20B), fp8 | ~16 GB mínimo · 24 GB cómodo | El codificador de texto + VAE añaden ~8-10 GB de sobrecarga. Por debajo de 16 GB, usa una versión GGUF + `--lowvram`. |
| Bucle i2v WAN (video) | Wan 2.2 14B, fp8 + LoRAs LightX2V de 4 pasos | ~16 GB funcional · 24 GB+ cómodo | La opción más pesada: espera minutos por clip. Descarga el codificador de texto UMT5 a la RAM (`t5_cpu`, requiere 24 GB+ de RAM del sistema) en tarjetas más pequeñas. |

Ambos checkpoints incluidos ya están cuantizados en fp8 para ajustarse a tarjetas de consumo. Si dispones de menos VRAM, cambia la UNET por una cuantización más pequeña y habilita `--lowvram` o la descarga a CPU en ComfyUI. La difusión únicamente por CPU resulta poco práctica (muchos minutos por imagen, y aún más para video) y puede exceder la ventana de sondeo de TomoriBot, por lo que una GPU es efectivamente indispensable para el uso regular.

:::tip[Reducción adicional: elige una cuantización GGUF]
Para reducir aún más el tamaño, descarga una compilación GGUF del modelo desde Hugging Face: el código en nombres como `Q4_K_M` / `Q5_K_M` indica los bits por peso, y 4 bits (Q4) o 5 bits (Q5) suele ser el punto óptimo que conserva la mayor parte de la calidad por una fracción del espacio de fp8/fp16. Cargar UNETs GGUF en ComfyUI requiere el nodo personalizado [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::

## 1. Ejecuta ComfyUI con la API habilitada

Instala ComfyUI según [su README](https://github.com/comfyanonymous/ComfyUI) e inícialo para que escuche en la red:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

`--listen 0.0.0.0` es fundamental si TomoriBot se ejecuta en Docker o en una máquina diferente: el valor predeterminado solo se vincula al bucle invertido. Confirma la conectividad desde la máquina donde se ejecuta el bot:

```sh
curl http://127.0.0.1:8188/system_stats
```

Si deseas probarlo, carga los checkpoints del modelo requeridos por el flujo de trabajo elegido y realiza una generación manual en la interfaz web de ComfyUI para confirmar que funcione de extremo a extremo antes de vincular TomoriBot.

## 2. Obtén un flujo de trabajo de TomoriBot

Descarga un flujo de trabajo en formato API listo para usar. Puedes encontrar ejemplos en el repositorio en [`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Flujo de trabajo | Modos |
|----------|-------|
| Anima v1 (imagen) : `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| Bucle i2v WAN (video) : `tomoribot-wan-i2v-loop-video.json` | imagen a video |

Estos archivos están en formato API (el JSON que ComfyUI exporta mediante *Save (API Format)*), no el formato de guardado regular de la interfaz de usuario. Si creas tu propio flujo de trabajo, debe contener los marcadores de posición `{TOMORI_*}` que TomoriBot sustituye (prompt, ancho/alto, semilla, imágenes de referencia, etc.). Consulta el [README de flujos de trabajo](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) y la página `Puntos de conexión personalizados` bajo `Proveedores` en `/help`.

## 3. Regístralo en Discord

Ejecuta `/providers` (o `/personal providers`), elige `+ Agregar nuevo punto de conexión personalizado` e ingresa:

| Campo | Valor para ComfyUI |
|-------|-------------------|
| `endpoint_label` | Un nombre que elijas, p. ej. `home-comfy` |
| Compatibilidad de API | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (raíz, sin `/v1`) |
| `auth_token` | *(déjalo en blanco a menos que tu ComfyUI requiera autenticación)* |

Después de guardar la conexión, selecciónala y elige `+ Agregar nuevo modelo de imagen` o `+ Agregar nuevo modelo de video` en el menú desplegable de modelos. Ingresa el nombre en código exacto del checkpoint y sube el archivo `.json` del flujo de trabajo descargado en el Paso 2 en `Flujo de trabajo de ComfyUI`. La capacidad del modelo debe coincidir con el flujo de trabajo (flujo de trabajo de imagen → `image`, flujo de trabajo de video → `video`).

Agregar el modelo lo activa automáticamente como el modelo de `image`/`video`. Activa la generación preguntándole a Tomori directamente en el chat. Si por alguna razón no está activo, ejecuta `/config` > Modelos > Cambiar modelos y selecciona tu punto de conexión de ComfyUI registrado.

## Solución de problemas

- **Inaccesible al agregar:** ComfyUI se vinculó solo al bucle invertido mientras el bot está en Docker o en otro host. Inícialo con `--listen 0.0.0.0` y usa `http://host.docker.internal:8188` o la IP de tu LAN.
- **La generación nunca finaliza:** TomoriBot sondea `/history` hasta que aparece el resultado. Los inicios en frío y los modelos grandes ejecutados en CPU pueden sobrepasar la ventana de sondeo.
- **Prompt o tamaño ignorados, o dimensiones de salida incorrectas:** al flujo de trabajo le faltan los marcadores de posición requeridos `{TOMORI_*}`, o se subió una exportación de la interfaz gráfica en lugar del formato API.
- **Capacidad incorrecta:** un flujo de trabajo de `image` registrado bajo `video` (o viceversa) no se ejecutará. Agrégalo nuevamente bajo la capacidad correspondiente.
