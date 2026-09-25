---
title: "Manejo de datos"
sidebar:
  order: 4
---

TomoriBot está diseñada para ser transparente sobre tus datos. Puedes exportar, importar o
eliminar todo lo que almacena, y esta página detalla exactamente qué es eso. Para el texto
legal, consulta `/legal privacy-policy` y `/legal terms-of-service`.

:::note
Esta página cubre los controles por usuario dentro de Discord. **¿Autoalojas tu propia
instancia?** Las copias de seguridad y restauraciones de toda la base de datos son una
operación del lado del host; consulta
[Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
:::

## Qué almacena

**Almacenado:**

- Memorias del servidor y personales
- Sus ajustes y datos de persona
- Configuración del servidor
- Claves de API cifradas

**No almacenado:**

- Tus mensajes de Discord
- Historial de chat

**Enviado a tu proveedor de IA:** cada vez que se activa, obtiene los **mensajes más
recientes** del canal más cualquier **memoria relevante** como contexto para el modelo. No
monitorea ni lee mensajes fuera de esas activaciones.

:::note
Tu proveedor de IA elegido (Google, OpenRouter, NovelAI, …) procesa los mensajes bajo *sus
propias* políticas de privacidad. Nunca compartas información personal sensible con ninguna IA.
:::

## Exporta tus datos

Todo lo exportable se envía a tus mensajes directos como un archivo JSON:

- `/export config`: valores de configuración del servidor (sin claves de API, credenciales ni ajustes de proveedor).
- `/export personal config`: tus ajustes personales (perfil, privacidad, apariencia, modos de respuesta).
- `/export memories`: memorias del servidor, con alcance a la persona principal, a una persona seleccionada, o a cada persona por separado.
- `/export personal memories`: tus memorias personales, con alcance global, a una persona, o a cada persona por separado.
- `/persona export`: definiciones completas de persona.

## Importa tus datos

Adjunta un archivo exportado previamente para restaurarlo:

- `/import config`: configuración del servidor; requiere **Administrar servidor**. Elige qué secciones detectadas aplicar.
- `/import personal config`: tus ajustes personales. Elige qué secciones detectadas aplicar.
- `/import memories`: memorias del servidor; requiere **Administrar servidor**. Combina o reemplaza, y asigna cada persona de origen si el archivo tiene más de una.
- `/import personal memories`: tus memorias personales. Combina o reemplaza, y asigna cada persona de origen si el archivo tiene más de una.
- `/persona import`: restaura una persona. También acepta tarjetas PNG y JSON de SillyTavern y
  archivos `.charx` de Character Card V3, que importan solo el texto del personaje (consulta
  [Compatibilidad con SillyTavern](/es-419/features/integrations/sillytavern-support/)).

## Elimina tus datos

Estos eliminan o restablecen datos de forma permanente: **no se pueden deshacer**:

- `/personal memories`, `/memories`
- `/reset config`: restablece la configuración del servidor en las 29 tablas de configuración a los valores predeterminados de la base de datos.
  - **Singletons restaurados a los valores predeterminados de DDL (18 tablas):** configuraciones de chat, configuraciones de modelo, permisos de miembros, capacidades, embeds de aviso, configuraciones nsfw, configuraciones de voz, configuraciones de activación automática, configuraciones de alcance de canal, configuraciones de comportamiento de activación, configuraciones de generación de imágenes de NovelAI, configuraciones BYOK, configuraciones de memoria, configuraciones de memoria a corto plazo, configuraciones de bienvenida, configuraciones de cuota de imágenes, configuraciones de cuota de texto y configuraciones de cuota de video.
  - **Configuración preservada (dos conjuntos):** los ID de modelo activos, las credenciales y los parámetros de endpoint personalizado en `server_model_configs` (`llm_id`, `embedding_model_id`, `diffusion_model_id`, `video_model_id`, `vision_llm_id`, `api_key`, `key_version`, `custom_endpoint_url`, `custom_model_name`, `custom_num_ctx`, `other_model_codename`, `other_model_capabilities`, `other_model_capabilities_fetched_at`), además de la identidad activa del modelo de difusión de NovelAI (`nai_diffusion_model_id` en `server_novelai_imagegen_configs`).
  - **Colecciones vaciadas (11 tablas):** `server_auto_trigger_persona_overrides`, `stm_categories`, `random_triggers`, `channel_llm_overrides`, `channel_prompt_overrides`, `channel_context_notes`, `personalization_blacklist`, `persona_user_blocks`, `channel_whitelist`, `role_whitelist` y `channel_persona_whitelist`.
  - **Dominios preservados:** Personas y ajustes de persona, memorias del servidor, memorias a corto plazo, expresiones (emojis y stickers), consumo de cuota registrado, configuraciones de proveedor guardadas e integraciones externas (Matrix y MCP).
  - **Contexto y permisos:** Requiere el permiso Administrar servidor en servidores. Compatible en mensajes directos (DM) usando el snowflake del espacio de trabajo del usuario que invoca el comando.
- `/reset personal config`: restablece la configuración del usuario y los focos personales de canal en todos los servidores a los valores predeterminados de la base de datos.
  - **Campos restablecidos:** Restaura `users.language_pref` ('en-US') y `users.privacy_level` (0), restaura las 13 columnas de `user_personalization_configs` (apodo, opción de multiservidor, etiquetas de apariencia, URL de referencia de personaje, prompt de suplantación, DTM personal, modo de herramientas deliberado, desfase de zona horaria, excepciones de prefijo/sufijo, identidad de género, pronombres, estilo de trato) a los valores predeterminados del esquema, y elimina todas las `user_persona_naming_preferences`.
  - **Colecciones vaciadas:** Elimina todos los `personal_spotlights` del usuario en todos los espacios de trabajo, con propagación en cascada a `personal_spotlight_personas`.
  - **Dominios personales preservados:** Identidad de la cuenta de usuario, configuración regional de registro, memorias personales, configuraciones de proveedor guardadas (`user_saved_provider_configs`), endpoints personalizados y tareas/recordatorios programados.
  - **Contexto:** Disponible para todos los usuarios tanto en servidores como en mensajes directos.

## Optar por no participar

- `/personal config`: controla tu visibilidad ante ella, hasta llegar a la invisibilidad total (optar por no participar de las funciones de memoria por completo).
- `/config` > Permisos: los administradores del servidor pueden desactivar el autoaprendizaje y otras funciones.

Consulta [Memoria](/es-419/features/knowledge/memory/) para saber cómo funcionan las memorias día a día.
