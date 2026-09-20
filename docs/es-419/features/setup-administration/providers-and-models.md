---
title: "Proveedores y modelos"
sidebar:
  order: 1
---

TomoriBot no tiene un modelo de IA integrado, tú conectas uno de un proveedor. Un **proveedor**
es un servicio de IA (Google Gemini, OpenRouter, NovelAI, un endpoint local, …), y un
**modelo** es un modelo específico de ese proveedor. Necesitas al menos un proveedor para
usarla.

## Claves de API
<!-- anchor: api-keys -->

Añade una clave de proveedor durante la configuración inicial con `/setup`, o después desde
`/providers` eligiendo **Añadir proveedor nuevo**. Las claves se **cifran en reposo**: nadie,
ni siquiera los administradores del servidor, puede volver a leerlas.

`/setup` pregunta primero cómo deberían llegar las respuestas a un modelo, y la respuesta
decide qué recopila:

| Modo | Qué recopila |
|---|---|
| **Proveedor de IA (recomendado)** | Un proveedor del catálogo más su clave de API, validada y cifrada como borrador. |
| **Endpoint personalizado (avanzado)** | La conexión del endpoint y un modelo de texto, registrados dentro del asistente. Consulta [Endpoints personalizados](#endpoints-personalizados). |
| **BYOK de usuario** (solo servidores) | Nada: el espacio de trabajo no conserva proveedor propio, así que los miembros deben aportar el suyo. |

No se escribe nada hasta **Finalizar configuración**, así que un asistente abandonado o
caducado deja intactas las filas de proveedor existentes del espacio de trabajo. Para
reemplazar una clave ya guardada, usa `/providers`, porque `/setup` se niega a ejecutarse en un
espacio de trabajo ya configurado.

Cada proveedor tiene sus propios pasos de generación de clave. Ejecuta **`/help`**, elige
**Configuración** y luego **Paso 1: obtén una clave de API**, y elige tu proveedor para el
recorrido exacto, o usa estos puntos de partida:

| Proveedor | Notas | Consigue una clave |
|---|---|---|
| **Google Gemini** | Nivel gratuito, ejecuta todas las funciones. Configuración inicial recomendada. | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | Una clave, muchos modelos (algunos gratis). | [Claves de OpenRouter](https://openrouter.ai/settings/keys) |
| **NovelAI** | Suscripción; narrativa/rol sin censura (solo texto). | [NovelAI](https://novelai.net/) |
| **DeepSeek** | Modelos de razonamiento de pago por uso. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | Texto, incrustaciones e imágenes alojados. | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | Modelos Claude mediante la API (no Claude Code). | Sin enlace |
| **Z.ai** | Familia GLM. ⚠️ Los Términos restringen el uso a escenarios de codificación/agentes. | [Z.ai](https://z.ai/) |
| **Vertex AI** | Google Cloud mediante ADC de `gcloud`: mejor para configuraciones locales/de desarrollo. | ver abajo |
| **Vertex AI Express** | BYOK con clave de API de Google Cloud (vista previa, subconjunto de Gemini). | [Modo Express](https://console.cloud.google.com/expressmode) |
| **Personalizado** | Cualquier endpoint compatible con OpenAI (Ollama, vLLM, LiteLLM, …). | consulta [Endpoints personalizados](#endpoints-personalizados) |

:::caution
Nunca compartas tu clave de API con nadie más. Añade o reemplaza el token de autenticación
Bearer de un endpoint personalizado desde su acción **Editar endpoint** en `/providers`.
:::

**Vertex AI** se autentica con Credenciales Predeterminadas de Aplicación en lugar de un
secreto guardado. Para alojamiento local, las ADC pueden provenir de `gcloud`; los despliegues
alojados deberían usar una identidad de carga de trabajo o una cuenta de servicio. Una clave de
API de AI Studio por sí sola no autentica Vertex AI completo. El proyecto seleccionado debe
tener facturación y la API de Vertex AI habilitadas, y la identidad del host necesita acceso a
Vertex. La guía de configuración está disponible desde **Google Vertex AI** en la página
**Claves de API** en `/help`.

La configuración de proveedores respaldados por Google valida las credenciales mediante el
endpoint autenticado de listado de modelos. No genera texto ni depende de cuál sea el modelo de
chat actualmente marcado como predeterminado en el catálogo, así que un predeterminado retirado
no puede impedir que se guarde una credencial válida.

### Opcional: clave de Brave Search

Brave Search es independiente de tu proveedor de IA y solo mejora la búsqueda web (añade
búsqueda de imágenes, videos y noticias). Establécela con `/providers`. ⚠️ Brave incluye $5 al
mes de crédito gratis; establece un límite de uso de $5 en el panel de Brave para evitar
cargos.

## Elegir modelos

`/providers` gestiona las credenciales del servidor, los catálogos de modelos y los registros
de endpoints, mientras que `/config` > Modelos > Cambiar modelos selecciona las asignaciones de
capacidad compartidas que usa cada miembro de este servidor. Ambos necesitan el permiso de
servidor requerido. Los miembros individuales gestionan sus propias credenciales y catálogos de
modelos con `/personal providers`, y luego seleccionan modelos personales en
`/personal config`. Los ajustes personales los siguen en todos los servidores donde usan
TomoriBot. Consulta
[Personalización](/es-419/features/knowledge/personalization/#your-own-providers) para ese
lado.

Los paneles se titulan **Proveedores del servidor** y **Proveedores personales** para que su
titularidad siga siendo visible después de que se abre la interacción del comando.

Después de establecer un proveedor, usa `/config` > Modelos > Cambiar modelos para elegir las
asignaciones de capacidad compartidas. Los seis espacios ordinarios seleccionan entradas de
modelo de los catálogos de proveedor:

- `/config` > Modelos > Cambiar modelos: el modelo de chat principal
- `/config` > Modelos > Cambiar modelos: un modelo de visión (para leer imágenes cuando el modelo de chat no puede)
- `/config` > Modelos > Cambiar modelos: incrustaciones para la [base de conocimiento de documentos](/es-419/features/knowledge/memory/#document-knowledge-base-rag)
- `/config` > Modelos > Cambiar modelos: generación de imágenes estándar (consulta [Generación de imágenes](/es-419/features/capabilities/media-generation/image-generation/))
- `/config` > Modelos > Cambiar modelos: generación de imágenes de NovelAI
- `/config` > Modelos > Cambiar modelos: generación de video
- `/config` > Modelos > Cambiar modelos: endpoint de texto a voz (TTS)
- `/config` > Modelos > Cambiar modelos: endpoint de voz a texto (STT)

Las primeras seis entradas eligen registros del catálogo de modelos. Los espacios de TTS y STT
en cambio eligen endpoints con alcance de espacio de trabajo, así que activan el endpoint
seleccionado en lugar de escribir una columna de modelo. Registra y edita esos endpoints en
`/providers`; su control de activación de endpoint sigue funcionando. `/personal config`
conserva seis espacios personales de enrutamiento de modelo y no añade selectores personales de
endpoint de TTS/STT.

También puedes gestionar las claves de respaldo de este servidor para failover automático y
balanceo de carga con `/providers`.

## Endpoints personalizados
<!-- anchor: custom-endpoints -->

Los endpoints personalizados te permiten registrar servicios autoalojados o mediante proxy
(Ollama, LM Studio, LiteLLM, vLLM, ComfyUI, TTS/STT local) como **paquetes de proveedor
etiquetados**.

- **Alcance de servidor:** abre `/providers` para registrar y editar endpoints del espacio de
  trabajo.
- **Alcance personal:** abre `/personal providers` para catálogos de modelos personales (solo
  tú; consulta
  [Personalización](/es-419/features/knowledge/personalization/#your-own-providers)). Los
  endpoints de voz personales no se seleccionan desde `/personal config`.

Una **etiqueta** es el nombre de menú visible para el usuario y agrupa capacidades bajo un
paquete cuando comparten una URL de endpoint. Nunca se envía al endpoint remoto. Las
capacidades servidas desde URL distintas necesitan etiquetas distintas. Elige **Añadir endpoint
personalizado nuevo**, selecciona la compatibilidad de API y guarda la conexión. Guardar
prepara las capacidades admitidas por ese protocolo sin registrar ningún modelo. Luego
selecciona el nuevo endpoint y usa su menú desplegable de modelo para registrar un código de
modelo exacto y una capacidad. Añadir un modelo lo activa para esa capacidad. Usa el mismo menú
desplegable para adjuntar más modelos o editar un registro añadido por el espacio de trabajo.
Los modelos de texto declaran sus propias capacidades en ese formulario, y los modelos de
imagen declaran qué modos de solicitud admiten.

Para TTS y STT, registra el endpoint y sus modelos en `/providers`, luego elige y activa el
endpoint en `/config` > Modelos > Cambiar modelos. Esos espacios de voz seleccionan un endpoint
en lugar de una entrada del catálogo de modelos. `/providers` sigue siendo la superficie de
registro, configuración y edición de endpoints.

La compatibilidad de API determina las rutas de solicitud y las cargas útiles que implementa el
servicio, así que también determina qué espacios de capacidad prepara la conexión. Registrar
modelos exactos para esos espacios es un paso separado, y el protocolo no se puede inferir de
forma confiable a partir de la URL del endpoint.

El modo **Endpoint personalizado (avanzado)** de `/setup` realiza los mismos dos pasos dentro
del asistente: **Configurar conexión** guarda la compatibilidad de API, la etiqueta, la URL y
el token de autenticación opcional detrás de una verificación de accesibilidad, y **Configurar
modelo de texto** registra el modelo de texto exacto y sus declaraciones de capacidad. El botón
de modelo permanece desactivado hasta que una conexión se valida, y volver a guardar la
conexión borra la declaración del modelo porque las declaraciones dependen de la compatibilidad
de API. El asistente crea juntos la conexión, el proveedor guardado, el modelo y las filas de
modelo activo cuando presionas **Finalizar configuración**, así que nunca deja una conexión sin
un modelo de texto utilizable. Solo registra modelos de texto; las capacidades de imagen, video,
TTS y STT todavía se registran en `/providers`.

Para recorridos completos sobre cómo ejecutar los servidores, consulta:

- [Configuración: LLM local](/es-419/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/): generación local de imágenes/video.
- [Configuración: ChatMock](/es-419/self-hosting/local-endpoints/setup-chatmock/): cuenta de ChatGPT / Codex CLI.

## Proveedores compatibles
<!-- anchor: supported-providers -->

Si no tienes el hardware para alojar tus propios modelos, TomoriBot admite una amplia gama de
servicios. No todas las funciones están disponibles en todos los proveedores.

### Proveedores de LLM

| Proveedor | Streaming | Llamadas a herramientas | Entrada de imagen | Incrustaciones | Notas |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| **Anthropic (API)** | ✅ | ✅ | ✅ | No | No es Claude Code |
| **NovelAI** | ✅ | ✅ | No | No | Solo GLM 4.6 puede usar herramientas |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| **DeepSeek** | ✅ | ✅ | No | No | No |
| **Z.ai** | ✅ | ✅ | ✅ | No | Modelos gratuitos; ⚠️ Los Términos son solo para uso de codificación/agentes |
| **Z.ai Coding** | ✅ | ✅ | No | No | Plan de suscripción |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | Incluye la versión "gratuita" Express |
| **Codex CLI (vía ChatMock)** | ✅ | ✅ | ✅ | No | [Configuración](/es-419/self-hosting/local-endpoints/setup-chatmock/) |

### Generación de imágenes

| Proveedor | Texto a imagen | Imagen a imagen | Inpainting | Notas |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | No | No |
| **OpenRouter** | ✅ | ✅ | No | No |
| **NovelAI** | ✅ | ✅ | ✅ | Se puede combinar con otros proveedores |
| **NVIDIA** | ✅ | No | No | Solo texto a imagen; las imágenes de referencia se ignoran |
| **Z.ai** | ✅ | No | No | No |

Estos son los **valores predeterminados** desde los que parten los modelos de imagen de un
proveedor, y NovelAI funciona mediante su propio flujo en lugar de esta tabla. Registrar un
modelo de imagen mediante `/providers` te permite declarar los propios modos de ese modelo, que
es cómo activas el inpainting en un flujo de trabajo de ComfyUI o en un modelo de proveedor cuya
API admite edición con máscara. Un modelo que nunca declares sigue los valores predeterminados
anteriores, así que una corrección posterior a estos le llega automáticamente. Declara solo lo
que el modelo realmente hace: Tomori le ofrece a la herramienta exactamente los modos que
marques, y un modo que la API rechaza se convierte en una generación fallida.

### Generación de video

| Proveedor | Texto a video | Imagen a video | Notas |
|---|---|---|---|
| **Google** | ✅ | ✅ | Flujo de sondeo asíncrono |
| **OpenRouter** | ✅ | ✅ | Flujo de sondeo asíncrono |
| **Z.ai** | ✅ | ✅ | Flujo de sondeo asíncrono |

### Voz y audio

| Proveedor | Texto a voz | Voz a texto |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

Los motores de voz locales están cubiertos en [Autoalojamiento](/es-419/self-hosting/). Para los
motores integrados de búsqueda web y obtención de URL, consulta
[Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#búsqueda-web-y-lectura-de-url).
