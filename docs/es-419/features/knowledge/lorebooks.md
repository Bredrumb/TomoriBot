---
title: "Lorebooks"
sidebar:
  order: 2
aiGenerated: false
---

Los lorebooks son una memoria avanzada para mundos de juego de rol, personajes y detalles recurrentes de la historia. Usa Memorias para conversaciones cotidianas. Las entradas de lorebook recuerdan los detalles que escribes cuando sus palabras clave aparecen en mensajes recientes.

Administra los lorebooks en `/memories` > `Lorebooks`. Todos los miembros pueden leer las entradas dentro de su alcance; solo los miembros con `Administrar servidor` pueden agregarlas, editarlas, importarlas, exportarlas o eliminarlas.

## Lorebooks para todo el servidor y de persona

Los lorebooks tienen dos alcances:

- Los libros de **Todo el servidor** se aplican a todas las personas del servidor. Primero elige un libro y luego una entrada dentro de él.
- Las entradas de **Persona** pertenecen al linaje de una persona. Se siguen aplicando incluso después de que la persona sea eliminada y vuelta a importar.

Usa los botones `Todo el servidor` y `Persona` en la parte superior de la página para cambiar de alcance. La lista de personas agrupa a aquellas que comparten un linaje, ya que comparten un mismo libro. Los límites de canales y el alcance Todo el servidor / Persona son controles independientes: el alcance decide a quién pertenece la entrada, mientras que los canales deciden dónde puede aparecer.

## Escribir una entrada

Asigna a cada entrada un título, palabras clave y hasta 4,000 caracteres de contenido. Las palabras clave son palabras o frases separadas por comas. La coincidencia no distingue entre mayúsculas y minúsculas, ni entre caracteres de ancho completo o medio ancho.

Deja las palabras clave en blanco para datos de contexto general que no necesiten coincidencia de palabras clave. Vuelve a agregar palabras clave para restaurar la coincidencia. Las entradas nuevas usan la ubicación después de la persona; las entradas importadas conservan su ubicación. Las ranuras de world info de un preajuste de SillyTavern controlan dónde aparecen los grupos antes y después.

## Cuándo se activan las entradas

Una entrada activada necesita una coincidencia de palabra clave, a menos que sus palabras clave estén en blanco. Los límites de alcance y canal se siguen aplicando a las entradas sin palabras clave.

`Reglas de activación` controla las palabras clave secundarias, la cantidad de mensajes recientes en los que buscar (1-100), la probabilidad de activación y el orden de inserción. Las palabras clave secundarias pueden requerir cualquier coincidencia (OR), todas las coincidencias (AND), ninguna coincidencia (NOR) o menos de todas las coincidencias (NAND). Los números de inserción más bajos aparecen primero.

La probabilidad de activación va del 0% al 100%. El cero impide la activación, incluso para entradas sin palabras clave. Si un archivo importado no incluye la probabilidad o es nula, se establece en 100% por defecto; un 0% explícito permanece en 0%. Las entradas con estado `Desactivado` permanecen guardadas pero no se incluyen en el prompt.

La coincidencia de palabras clave es literal. Las claves con forma de expresiones regulares como `/a+/` se conservan exactamente como se escribieron y no funcionan como expresiones regulares.

## Qué llega al prompt

Las entradas activadas se envían en un bloque de `World Info` por ubicación, según el orden de inserción. Ambos bloques comparten un límite conjunto de 8,000 caracteres; si una entrada supera este límite, se omite para que las siguientes aún puedan incluirse.

El contenido puede usar `{{user}}`, `{{char}}` y `{{bot}}`. TomoriBot los reemplaza por los nombres actuales. Otras macros `{{...}}` y bloques condicionales se mantienen tal como están escritos.

## Límites de canales

Las restricciones de canal en todo el servidor pertenecen a la colección y se aplican a todas sus entradas. Configúralas con `Canales` junto al botón de estado de la colección. Los lorebooks de persona conservan las restricciones de canal en cada entrada individual. Dejar los canales vacíos permite todos los canales; los hilos siguen las reglas de su canal principal.

El botón `Activo` / `Desactivado` de la colección controla el libro completo. Al desactivarlo, todas las entradas quedan fuera de la conversación sin cambiar el estado individual de cada una. Al volver a activar la colección, se conserva qué entradas estaban activadas o desactivadas.

Las memorias del servidor más antiguas con etiquetas de palabras clave convertidas a lore de persona aún pueden contener un nombre `#canal` no resuelto. Hasta que un administrador guarde una selección de canales, TomoriBot tratará esa entrada como activa en todos los canales y la marcará en la página de Lorebooks.

## Importar un lorebook

En el alcance Todo el servidor, elige `+ Importar lorebook` en el selector de colecciones para crear un libro a partir del archivo subido. Su nombre toma por defecto el nombre dentro del archivo y luego el nombre del archivo; también puedes escribir un nombre en el diálogo de importación. Si el nombre ya existe, se rechazará, por lo que importar un libro nuevo no puede sobrescribir uno existente. Usa `+ Importar entradas` en el selector de entradas de un libro seleccionado para anexar o reemplazar sus entradas.

En el alcance Persona, `+ Importar lorebook` permanece en el selector de entradas porque la persona posee un único libro. Ambas importaciones admiten archivos JSON de world info de SillyTavern, JSON de Character Book y tarjetas de personajes en formato PNG, CHARX o JSON. Subir una tarjeta aquí importa únicamente su Character Book incrustado. Una tarjeta sin libro deja el lorebook seleccionado sin cambios.

Anexar es el comportamiento predeterminado: las entradas que ya existen se omiten y se agregan las nuevas. Marca `Reemplazar este lorebook` para reemplazar solo el libro seleccionado. Los demás libros de todo el servidor no se modifican. Cada persona puede almacenar hasta 250 entradas, y los libros de todo el servidor comparten un límite independiente de 250 entradas; una importación que supere ese límite se rechaza por completo, de modo que nada se importe a medias. Los archivos JSON tienen un límite de 2 MB; las tarjetas PNG y CHARX usan los límites de importación de persona del host mostrados en el diálogo de subida.

El comprobante de importación indica cuántas entradas se agregaron y cuántas se omitieron. El recuento de omitidas incluye duplicados y entradas que el convertidor no pudo utilizar, como entradas sin contenido. Los ajustes que no tienen un destino equivalente, como grupos, recursión, temporizadores persistentes, tiempos de enfriamiento y activadores, se contabilizan y se descartan. Las posiciones de world info de 2 a 7 se ubican antes de la persona. Las claves con expresiones regulares permanecen inertes. El comprobante de importación identifica las palabras clave y los ajustes no compatibles.

El Character Book de una tarjeta se importa como el lorebook de esa persona mediante `/persona import`; consulta [Compatibilidad con SillyTavern](/features/integrations/sillytavern-support/).

## Exportar un lorebook

`+ Exportar lorebook` en el selector de entradas descarga el libro seleccionado de Todo el servidor o de Persona como un archivo JSON de world info de SillyTavern. Puedes volver a importarlo mediante la misma subida de lorebook. Los ajustes de activación de las entradas y los estados de activación individuales se transfieren con el archivo; las restricciones de canales, los nombres de canales no resueltos y el estado de la colección no se incluyen.

Para un respaldo del servidor que conserve estas restricciones y los ajustes de la colección, usa `/export memories` con `Todas las personas`. `Persona principal` y `Persona seleccionada` exportan únicamente las memorias y dejan el lore de destino intacto al importar.

## Páginas relacionadas

- [Memoria](/features/knowledge/memory/)
- [Dentro del prompt](/features/knowledge/inside-the-prompt/)
- [Manejo de datos](/features/knowledge/data-handling/)
