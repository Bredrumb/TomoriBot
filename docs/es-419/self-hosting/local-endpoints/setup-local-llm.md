---
title: "Configuración: LLM local"
aiGenerated: false
sidebar:
  label: "LLM local"
  order: 1
---

TomoriBot puede usar cualquier servidor LLM local compatible con OpenAI para la generación de texto y embeddings.

:::note[No se necesitan variables de entorno]
Los modelos locales se registran a través de comandos de barra de Discord y se almacenan cifrados en la base de datos. No existe ninguna variable `.env` para ellos.
:::

## 1. Ejecuta tu servidor de modelos

Esta guía recorre el proceso utilizando Ollama como ejemplo porque es la opción más sencilla para comenzar, ¡aunque puedes utilizar cualquier otro servidor que prefieras, en especial si ya tienes un perfil técnico!

Instala [Ollama](https://ollama.com). Los ejemplos a continuación usan Gemma 4 de Google, pero cualquier modelo de la [biblioteca de Ollama](https://ollama.com/library) funciona.

### ¿Qué tamaño debo descargar?
<!-- anchor: which-size-should-i-pull -->

Los modelos locales se ejecutan en la VRAM de tu GPU (la memoria integrada en tu tarjeta gráfica, independiente de la RAM del sistema). Regla general: un modelo necesita al menos su tamaño de descarga libre en VRAM, más ~1-2 GB de margen para el contexto de la conversación. Elige el Gemma 4 más grande que quepa en tu tarjeta:

| Tu VRAM de GPU | Mejor opción | Descarga (aprox.) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (cabe por completo), o `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` o `gemma4:31b` | 18 / 20 GB |

Las descargas corresponden a los tamaños de cuantización predeterminados de Ollama; consulta la [página del modelo](https://ollama.com/library/gemma4) para ver cifras exactas. ¿No tienes certeza de cuánta VRAM tienes? En Windows: `Administrador de tareas` > `Rendimiento` > `GPU`, y revisa "Memoria de GPU dedicada".

Descarga el tamaño que elegiste e inicia el servidor:

```sh
ollama pull gemma4:12b     # cambia por la etiqueta que quepa en tu VRAM
ollama serve               # escucha en http://127.0.0.1:11434
```

Confirma que sea accesible desde la máquina donde se ejecuta TomoriBot:

```sh
curl http://127.0.0.1:11434/v1/models
```

Toma nota de la etiqueta exacta instalada, ya que este es el Nombre del modelo que registrarás:

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Regístralo en Discord

Ejecuta `/providers` (en todo el servidor) o `/personal providers` (solo para ti), elige `+ Agregar nuevo punto de conexión personalizado` e ingresa:

| Campo | Valor para Ollama |
|-------|-------------------|
| `endpoint_label` | Un nombre que elijas, p. ej. `home-ollama` |
| Compatibilidad de API | `OpenAI-Compatible` (recomendado) u `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` para OpenAI-Compatible · `http://127.0.0.1:11434` para Ollama |
| `auth_token` | *(déjalo en blanco)* |

:::tip[Elige la URL que coincida con la compatibilidad de API]
Tanto `OpenAI-Compatible` como `Ollama` aceptan la raíz directa y la normalizan a la base `/v1`. `/chat/completions` se agrega automáticamente, así que no lo añadas. Las URL que ya incluyen una ruta, como `https://openrouter.ai/api/v1` o un prefijo de pasarela, se conservan de forma literal.
:::

Después de guardar la conexión, selecciónala y elige `+ Agregar nuevo modelo de texto` en su menú desplegable de modelos. Completa:

- **Nombre del modelo (ID exacto de API):** `gemma4:12b`, la etiqueta exacta de `ollama list`.
- **Anulación de ventana de contexto:** opcional, solo Ollama / KoboldCPP. Configúralo (p. ej. `8192`, `16384`) para elevar el `num_ctx` predeterminado de Ollama, que de otro modo es lo bastante pequeño como para truncar el contexto extenso de TomoriBot. Déjalo en blanco para usar el valor predeterminado del servidor.
- **Interruptores:** habilita `Llamado de herramientas` si el modelo admite llamadas a funciones; habilita `Entrada de imagen` solo para modelos de visión; `Salida estructurada` si el modelo maneja esquemas JSON correctamente. En nuestro ejemplo, Gemma 4 admite todas estas funciones, así que márcalas todas.

TomoriBot valida la conexión al guardarla. Si informa que el punto de conexión es inaccesible, la causa habitual es una discrepancia entre `localhost` y Docker, o un `/v1` faltante o sobrante (consulta [notas y problemas comunes](#notes--gotchas)).

Al agregar el modelo, este se convierte automáticamente en el modelo de `text` activo. Comienza a chatear para probarlo. Si no está activo por alguna razón, ejecuta `/config` > Modelos > Cambiar modelos y selecciona tu modelo recién registrado.

## 3. (Opcional) Embeddings locales para RAG

Selecciona el punto de conexión guardado y usa su menú desplegable de modelos para agregar un modelo de Embeddings (p. ej. `ollama pull nomic-embed-text`, Nombre del modelo `nomic-embed-text:latest`). Las funciones de RAG también requieren pgvector instalado en Postgres. Puedes consultar la guía de [configuración manual](/self-hosting/manual-setup/) aquí.

## 4. (Opcional) Comparte una sola GPU con ComfyUI
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

Si el modelo de texto y ComfyUI se ejecutan en la misma GPU, TomoriBot puede descargar el modelo de texto mientras se procesa un trabajo de imagen o video de ComfyUI. Las respuestas de texto que lleguen durante el trabajo esperarán hasta que la GPU quede libre nuevamente.

Abre el punto de conexión guardado, pulsa `Editar punto de conexión` y marca `Descargar el modelo durante tareas de ComfyUI` bajo `Comportamiento del endpoint`. TomoriBot comprueba qué servidor responde en la URL al guardar:

- **Ollama:** funciona tal como está instalado. TomoriBot solicita a Ollama descargar el modelo antes del trabajo, y Ollama lo recarga en la siguiente solicitud de texto.
- **KoboldCpp:** inicia KoboldCpp con `--admin` y `--admindir`, y asigna la contraseña de administrador al token de autenticación del punto de conexión. TomoriBot usa la API de recarga administrativa de KoboldCpp para descargar el modelo y volver a cargarlo posteriormente.

Cualquier otro servidor será rechazado al guardar, ya que los servidores genéricos compatibles con OpenAI no comparten un método común para descargar modelos.

## Otros servidores
<!-- anchor: other-servers -->

TomoriBot admite cualquier punto de conexión compatible con OpenAI, pero se recomiendan los servidores indicados a continuación. Todos siguen el mismo flujo: solo cambian la URL y un par de detalles.

### KoboldCPP

- Inicia con OpenAI-compat habilitado (integrado). Predeterminado: `http://127.0.0.1:5001/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Respeta la `Anulación de ventana de contexto` al igual que Ollama.
- Para descargar el modelo durante trabajos de ComfyUI, inicia también con `--admin` y `--admindir` (consulta [Comparte una sola GPU con ComfyUI](#4-optional-share-one-gpu-with-comfyui)).
- Carga modelos GGUF; el Nombre del modelo es el que reporte el modelo cargado (a menudo el nombre base del archivo), compruébalo en la respuesta de `/v1/models` de KoboldCPP.

### llama.cpp (`llama-server`)

- Compila o instala [llama.cpp](https://github.com/ggml-org/llama.cpp), y luego sirve un archivo GGUF con su servidor integrado compatible con OpenAI:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Configura la ventana de contexto al iniciar con `-c`, ya que la `Anulación de ventana de contexto` del modal es exclusiva de Ollama/KoboldCPP y no tiene efecto aquí.
- El Nombre del modelo es el que reporte `/v1/models`; puedes asignarle uno limpio con `--alias my-model`.
- Si lo iniciaste con `--api-key`, ingresa esa clave en `auth_token`.

### LM Studio

- En LM Studio, inicia el servidor local (`Local Server` en la pestaña `Developer`). Predeterminado: `http://127.0.0.1:1234/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- El Nombre del modelo es el identificador que LM Studio muestra para el modelo cargado.

### vLLM

- Sirve con el servidor compatible con OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Si iniciaste vLLM con `--api-key`, ingresa esa clave en `auth_token`.
- El Nombre del modelo es la ruta o nombre del modelo servido (coincide con `/v1/models`).

### LiteLLM (proxy sobre múltiples backends)

- Ejecuta el proxy de LiteLLM; predeterminado: `http://127.0.0.1:4000/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- El Nombre del modelo es el alias de modelo definido en la configuración de LiteLLM.
- Si el proxy exige una clave maestra, establécela en `auth_token`.

### ChatMock (cuenta de ChatGPT / CLI de Codex)

Cuenta con su propia guía dedicada debido a un ajuste necesario para el prompt del sistema:
[Configuración: ChatMock](/self-hosting/local-endpoints/setup-chatmock/).

## Elección de modelos en Hugging Face

Más allá de la biblioteca seleccionada de Ollama, [Hugging Face](https://huggingface.co) aloja miles de modelos de la comunidad. KoboldCPP, llama.cpp y LM Studio pueden cargar el formato GGUF, un paquete de un solo archivo que descargas y al que apuntas el servidor.

1. **Encuentra un GGUF.** Busca en Hugging Face tu modelo junto con el término "GGUF": cuantizadores de la comunidad como [bartowski](https://huggingface.co/bartowski) publican versiones GGUF de los modelos más populares poco después de su lanzamiento. Prefiere variantes de instrucción o chat (nombres terminados en `-Instruct` o `-Chat`); los modelos base no sostienen una conversación adecuadamente.
2. **Elige una cuantización que quepa en tu VRAM.** Un repositorio suele ofrecer el mismo modelo en múltiples niveles de cuantización; el tamaño del archivo equivale aproximadamente a la VRAM requerida (más ~1-2 GB para el contexto, la misma regla de la [tabla de tamaños](#which-size-should-i-pull) anterior). Descarga el archivo `.gguf` individual de tu elección.
3. **Cárgalo.** Inicia KoboldCPP o `llama-server` con ese archivo (consulta [Otros servidores](#other-servers)), y luego registra el punto de conexión en Discord como de costumbre.

:::tip[¿Qué cuantización elegir? Q4 o Q5 es el punto óptimo]
La cuantización almacena cada peso en menos bits para reducir el modelo, con una pequeña pérdida de calidad. El código en nombres como `Q4_K_M` / `Q5_K_M` indica los bits por peso: **4 bits (Q4) o 5 bits (Q5) suele ser el punto óptimo**, ya que conserva la mayor parte de la calidad ocupando cerca de la mitad del tamaño de 8 bits. Por debajo de 4 bits la calidad se degrada con rapidez. Además, con un presupuesto fijo de VRAM, **un modelo más grande en Q4 suele superar a uno más pequeño en Q8**.
:::

## Notas y problemas comunes
<!-- anchor: notes--gotchas -->

- **Una entrada de punto de conexión por etiqueta.** Para registrar varios modelos que comparten el mismo servidor, selecciona el punto de conexión guardado y utiliza su menú desplegable de modelos nuevamente. Usa etiquetas distintas para servidores o protocolos de API realmente diferentes.
- **El Nombre del modelo es el identificador de API.** Es la cadena exacta enviada al servidor. Escribirlo mal es la causa más frecuente de que "se conectó pero las respuestas fallan".
- **¿Ejecutas TomoriBot en Docker?** `localhost` dentro del contenedor no es tu host. Usa `http://host.docker.internal:<port>` (Windows/macOS) o la IP de la red local del host, y vincula el servidor de modelos a `0.0.0.0`.
- **¿Usas Compose?** Su configuración `RUN_ENV=development` permite puntos de conexión HTTP locales. Un entorno de ejecución en producción exige HTTPS y bloquea destinos de red privada a menos que el emisor lo permita explícitamente. `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` autoriza destinos privados para `fetch_url` en producción; no modifica las reglas de puntos de conexión de proveedores. Las direcciones de metadatos de la nube se mantienen bloqueadas en todos los modos.
