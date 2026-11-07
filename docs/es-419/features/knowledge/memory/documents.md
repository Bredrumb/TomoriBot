---
title: "Documentos"
sidebar:
  order: 3
aiGenerated: false
---

Los documentos le proporcionan a TomoriBot una base de conocimiento en la que busca mientras responde: el reglamento de un juego, las preguntas frecuentes del servidor, la exportación de una wiki o notas sobre una historia. Contienen material demasiado extenso para ser una [memoria a largo plazo](/features/knowledge/memory/long-term-memory/).

## Por qué usar documentos

Una memoria a largo plazo activa se envía completa con cada respuesta, por lo que cada una ocupa espacio en el prompt sin importar si la conversación la necesita o no. En cambio, un documento se consulta mediante búsqueda. Cada respuesta recibe a lo sumo 10 fragmentos que coincidan con la conversación, por lo que incluso un reglamento de 40 páginas agrega como máximo unas tres páginas de texto a una respuesta, y las secciones por las que nadie pregunta no tienen costo.

Usa una memoria a largo plazo para un dato breve que ella siempre deba saber. Usa un documento para material de referencia que deba consultar cuando surja el tema.

## Cómo funciona la búsqueda
<!-- anchor: how-search-works -->

Cuando agregas un documento, TomoriBot lo divide en pasajes de unos pocos párrafos cada uno, llamados fragmentos (chunks). Luego, un modelo de incrustación (embedding) convierte cada fragmento en una lista de números que describe su significado. Los fragmentos sobre temas similares obtienen números similares incluso cuando usan palabras diferentes.

En cada mensaje, ella convierte el mensaje más reciente en números de la misma manera y elige los fragmentos con el significado más cercano. También comprueba si hay fragmentos que compartan palabras exactas, lo cual detecta nombres y términos inventados que un modelo de incrustación podría no reconocer. Las mejores coincidencias entran en su prompt para esa respuesta. Esta técnica se conoce como generación aumentada por recuperación (RAG).

Por ejemplo, un documento dice "Los miembros del gremio se reúnen todos los viernes en los muelles". Preguntar "¿cuándo se junta el gremio?" encuentra ese fragmento aunque la pregunta nunca mencione "reúnen" ni "viernes".

Debido a que solo ve los fragmentos que coincidieron, no puede resumir un documento completo ni hacer recuentos a lo largo de este. Las preguntas sobre un detalle específico funcionan mejor. Los encabezados de Markdown ayudan: cada fragmento conserva sus encabezados de sección, por lo que un documento bien organizado ofrece coincidencias más claras.

## Configuración de documentos

Los documentos necesitan un modelo de incrustación. Elige uno en la ranura de `Incrustaciones` (Embeddings); consulta [Proveedores y modelos](/features/setup-administration/providers-and-models/).

Gestiona los documentos en `/memories` > `Documentos`. Elige `Añadir nuevo Documento` para subir un archivo `.txt`, `.md` o `.pdf`. Un documento puede pertenecer a una persona o compartirse entre todas las personas, y puede limitarse a canales seleccionados y a sus hilos. Puedes leer los fragmentos almacenados y editar o eliminar cualquiera de ellos. Para convertir una memoria del servidor larga en un documento, ábrela en `/memories` y elige `Vectorizar`.

En servidores nuevos, la gestión de documentos está restringida por defecto a miembros con `Administrar servidor`; los administradores pueden otorgar acceso mediante `/moderation` > `Acceso de miembros`.

## Límites de documentos

Por defecto, un archivo puede tener hasta 4 MB y su texto hasta 120,000 caracteres (unas 20,000 palabras en inglés), divididos en un máximo de 150 fragmentos. Los documentos de cada persona, y el conjunto compartido, pueden contener 20 documentos y 1,000 fragmentos. Quienes se autoalojan pueden cambiar estos límites con `MAX_DOCUMENT_SIZE_MB`, `MAX_DOCUMENT_TEXT_LENGTH`, `MAX_DOCUMENT_CHUNKS`, `MAX_DOCUMENTS_PER_SERVER` y `MAX_DOCUMENT_CHUNKS_PER_SERVER`.

## Aprender del historial del chat

`/learn history` lee hasta 100 mensajes en el canal actual, extrae los datos que contienen y los guarda como un documento. Requiere `Administrar servidor` y un modelo compatible con salidas estructuradas.

Las importaciones de historial ofrecen prompts para conversación, juego de rol y el punto de vista de una persona. Puedes revisar y ajustar el prompt antes de importar. Elige quién aprende el resultado con `learner`: una persona (la persona principal si se deja en blanco), cada persona que habló o todas las personas juntas.
