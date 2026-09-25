---
title: "Personalización"
sidebar:
  order: 3
---

TomoriBot se puede configurar **específicamente para ti** con los comandos `/personal`: ajustes
que te siguen en todos los servidores que compartes con ella, independientes de la
configuración de cualquier servidor.

## Memorias personales

Los datos que recuerda sobre ti te siguen entre servidores. Gestionarlos (añadir, eliminar,
exportar) se explica en la página de [Memoria](/es-419/features/knowledge/memory/#personal-vs-server-memories).

## Perfil y nombres conscientes de la persona

`/personal config` almacena tres preferencias independientes y opcionales: identidad de género,
pronombres y estilo de trato. TomoriBot nunca infiere una a partir de otra. El estilo de trato
selecciona la variante de nombre masculina, femenina o neutra de una persona, y Neutro es el
valor predeterminado preseleccionado. Los campos en blanco se limpian y se omiten del contexto
del prompt. Los campos de perfil sin procesar solo se exponen con privacidad Mínima.

`/personal config` abre un modal de nombres para el alcance global o el de persona. Una
preferencia con alcance de persona sigue el linaje estable de esa persona entre servidores. Los
apodos heredan de la preferencia de persona a la preferencia global y luego al nombre de
visualización en vivo de Discord. Un apodo global en blanco sigue mostrando el de Discord,
incluidos cambios posteriores del nombre de visualización. Guardar un apodo global fija ese
valor personalizado hasta que se elimine. Un prefijo o sufijo en blanco hereda de la misma
manera, y el texto escrito lo reemplaza, así que `Master Mirri-san` puede combinar valores de
distintos niveles sin cambiar el objetivo de mención subyacente de Discord. Para quitar un
título que una persona añade por su cuenta, pídeselo directamente a la persona ("deja de
llamarme Master"); eso lo suprime para esa persona sin afectar a tus otras personas.

Los administradores del servidor pueden configurar valores predeterminados de persona con
`/config` > Persona > Identidad y personalidad. Un término de trato independiente como `fam` es
distinto del nombre formateado y solo está disponible para el texto de prompt escrito por la
persona. La capacidad de Actualizaciones de información del usuario, activada por defecto,
permite que una persona aplique cambios estructurados explícitos solicitados en la conversación.
Desactivarla detiene las actualizaciones automáticas por herramienta pero no desactiva
`/personal config`.

`/personal config` solo almacena un desfase UTC numérico de -12 a +14. No almacena ni infiere
una ubicación geográfica o una zona horaria IANA.

## Tus propios proveedores
<!-- anchor: your-own-providers -->

Los proveedores personales permiten que *tus propias solicitudes* usen *tus propias* claves de
API y modelos en lugar de los valores predeterminados del servidor. Esto es traer tu propia
clave (BYOK) a nivel individual.

Hay dos alcances en juego, y vale la pena tenerlos claros:

- **Valor predeterminado del servidor**: credenciales y catálogos compartidos en `/providers`,
  con el enrutamiento seleccionado mediante `/model` por miembros con el permiso de servidor
  requerido. Se aplica a todos ahí.
- **Ajuste personal**: configuración usada solo para tus propias solicitudes. Cuando está
  activado, reemplaza el valor predeterminado del servidor para esa capacidad **en todos los
  servidores** donde uses TomoriBot, no solo en el que lo configuraste.

**Configuración:**

1. `/personal providers` guarda un proveedor (tu clave se cifra). Esto también activa de
   inmediato tu ajuste personal de `Texto`, usando el modelo de texto predeterminado de ese
   proveedor.
2. `/personal config` permite seleccionar un modelo distinto para tu ajuste personal de texto.
   Elegir un modelo aquí mantiene Texto activado.
3. Vuelve a `/personal providers` cuando necesites actualizar credenciales, gestionar endpoints
   personalizados, o añadir y editar registros de modelo personales.

Seleccionar un modelo con `/personal config` activa esa capacidad para tus solicitudes.

Como los pasos 1 y 2 te cambian a un ajuste que cruza servidores, TomoriBot te pide confirmar
antes de guardar cada vez que una capacidad pasa del valor predeterminado del servidor a uno
personal. Rotar la clave de un proveedor que ya responde a tus solicitudes se salta esa
confirmación, ya que el enrutamiento no cambia.

Los registros de pensamiento atribuyen esos turnos a ti, y puedes ajustarlos con
`/personal config`. Esto afecta a tus solicitudes en todas partes y nunca toca los ajustes de
este servidor. También puedes registrar endpoints personalizados personales con
`/personal providers`; consulta
[Endpoints personalizados](/es-419/features/setup-administration/providers-and-models/#custom-endpoints).

Si una solicitud falla mientras usas tu proveedor personal, los consejos de "Qué puedes hacer"
del error nombran los comandos personales que realmente pueden arreglarlo (`/personal providers`,
`/personal config`) en lugar de los de administrador del servidor.

Cuando fallan todos los modelos de tu ruta de texto personal, TomoriBot puede responder con el
modelo de texto del propio servidor en lugar de dejar el mensaje sin respuesta. Esa respuesta usa
las credenciales del servidor y se descuenta de su cuota de texto, y se reporta igual que cualquier
otro respaldo de modelo: un botón **Respaldo utilizado** cuyos detalles nombran el modelo que
respondió y las fallas anteriores. Puedes desactivarlo en `/personal config` > Modelos > Alternativas,
en la sección **Respaldo al modelo del servidor**, para que las fallas de tu proveedor sigan siendo
tuyas. La opción se aplica a toda la cuenta y está activada por defecto, así que te sigue a cada
servidor que la permita.

:::note[Servidores con BYOK obligatorio]
Un servidor puede exigir proveedores provistos por los miembros con el modo BYOK de usuario
([Moderación del servidor](/es-419/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)).
Cuando está activo, tus mensajes activados por usuario necesitan un proveedor personal antes de
que pueda responder, y una ruta personal fallida sigue fallida: un servidor que no presta sus
modelos a los miembros tampoco presta uno como respaldo. Los proveedores personales se aplican en
todos los servidores donde la uses.
:::

## Otros ajustes personales

- `/personal config`: cambia cómo te llama.
- `/personal config`: tus propias etiquetas de apariencia (estilo booru), usadas cuando una
  [generación de imágenes](/es-419/features/capabilities/media-generation/image-generation/#personalizar-etiquetas)
  te hace referencia. Envía un campo vacío para eliminarlas.
- `/personal config`: controla tu visibilidad ante ella, hasta llegar a la **invisibilidad
  total** (optar por no participar de las funciones de memoria por completo).
- `/personal config`: tu ajuste personal para el
  [Modo de activación deliberada](/es-419/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- `/personal config`: permite que el modelo de texto del servidor cubra una ruta de texto
  personal fallida, o desactiva esa opción.
- `/personal config`: activa el intercambio de memoria a corto plazo entre servidores;
  `/personal memories` borra tu STM.
- `/personal config`: establece un prompt reutilizable para cuando te suplanta mediante
  `/impersonate user`.

## Foco personal
<!-- anchor: personal-spotlight -->

**Foco personal: selección de persona por canal.** El foco personal te permite *a ti* limitar
qué personas puedes activar en un canal, y opcionalmente asignar una para que se active
automáticamente con tus propios mensajes ahí. Tiene alcance a **ti + un canal** y no afecta a
nadie más.

**Configura uno** con `/personal config`, eligiendo:

- una duración en horas (usa **0** para conservarlo hasta que lo elimines manualmente),
- el canal objetivo,
- las personas que quieres en tu foco personal.

Después de elegir las personas, opcionalmente puedes seleccionar una como tu **persona de
activación automática personal**: la respondedora de respaldo para tus mensajes en ese canal.
Las activaciones directas siguen apuntando a la persona que llames explícitamente. Presiona
Finalizar para omitir este paso.

**Reglas importantes:**

- El foco personal solo **limita** el acceso; nunca lo amplía. Las personas seleccionadas son
  las *únicas* que puedes activar ahí.
- Sigue respetando los límites de persona a nivel de servidor configurados mediante
  `/moderation`.
- Las cadenas de proxy están bloqueadas: si tu foco personal solo incluye a Alice, una respuesta
  de Alice no puede pasar el turno a Bob en tu cadena de mensajes.

Revisa o elimina entradas con `/personal config` (desmarca para eliminar; los focos con tiempo
límite expiran por sí solos). En `/help`, elige `Comportamiento` y luego `Enfoque personal`,
para ver el resumen de Discord.
