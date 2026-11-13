---
title: "Moderación del servidor"
sidebar:
  order: 2
---

TomoriBot proporciona a los administradores de servidores un control detallado sobre el uso, los costos, los permisos y los canales a través de `/moderation` y `/config`. La mayoría de estos controles requieren el permiso `Administrar servidor`. Para obtener una lista completa de comandos, consulta la [Referencia de comandos](/features/command-reference/).

## Control de costo: cuotas
<!-- anchor: cost-control-quotas -->

La generación cuesta dinero, ya sea que la paguen desde su cuenta de proveedor o sus miembros. Uso del límite de cuotas por usuario y en todo el servidor:

- **Configurar límites**: en `/moderation` > `Cuotas`, configure límites diarios por usuario y grupos de restablecimiento en todo el servidor para la generación de texto, imágenes y videos. Establece un límite por usuario en `0` de forma ilimitada.
- **Restablecimientos manuales**: ejecute `/quota reset user` para borrar el uso diario de un miembro, o `/quota reset global` para restablecer todo el grupo del servidor.

Los grupos de todo el servidor se restablecen automáticamente en un intervalo configurable en días.

## BYOK de usuario (trae tu propia clave)
<!-- anchor: user-byok-bring-your-own-key -->

En `/moderation` > `Acceso de miembros`, puedes controlar si los miembros pueden usar IA financiada por el servidor:

- **Modelos de servidor permitidos** (predeterminado): los miembros utilizan proveedores configurados en el servidor.
- **Se requieren proveedores personales**: los miembros deben configurar sus propias claves API a través de `/personal providers`. El servidor no paga nada por los mensajes iniciados por los miembros. Las acciones iniciadas por el servidor (como saludos automatizados o tareas programadas) aún utilizan el proveedor del servidor.

Los miembros configuran sus proveedores personales en [Personalización](/features/knowledge/personalization/#your-own-providers).

También puede iniciar un servidor sin un proveedor de texto del lado del servidor eligiendo `BYOK del Usuario` durante `/setup`.

## Control de acceso: listas blancas

Utilice `/moderation` > `Lista blanca` para restringir dónde y cómo responde TomoriBot:

- **Canales**: elija qué canales permiten respuestas de bot y establezca anulaciones de tiempo de reutilización específicas del canal. Los canales heredan el tiempo de reutilización global a menos que se establezca una anulación.
- **Personas**: restringe los canales en los que puede activarse una persona específica.
- **Roles**: restringe las interacciones del bot a miembros con roles específicos de Discord.

Configura el tiempo de reutilización de la respuesta global en todo el servidor en `/config` > `Comportamiento` > Comportamiento del disparador.

## Controles de aprendizaje y privacidad

- **Permisos de miembros**: en `/moderation` > `Acceso de miembros`, haz clic en `Editar permisos` para controlar
  si los miembros sin `Administrar servidor` pueden administrar memorias del servidor, atributos de persona,
  diálogos de muestra o inspeccionar instantáneas de mensajes. La enseñanza de memorias del servidor está desactivada por defecto y
  permite a los miembros ver sus propias memorias, agregar nuevas y editar o eliminar las suyas. Cuando está desactivada,
  solo los miembros con `Administrar servidor` pueden ver o administrar las memorias del servidor. Ver y administrar documentos y
  lorebooks requiere `Administrar servidor`.
- **Lista negra de usuarios**: en `/moderation` > `Lista negra de usuarios`, elige miembros para que TomoriBot los ignore por completo. Los miembros de la lista negra no pueden activarla ni ejecutar comandos, y sus mensajes nunca llegan al contexto del mensaje. También puedes establecer bloqueos de miembros específicos de una persona.
- **Reglas de canal**: en `/config` > `Canales` > `Reglas de canal`, marca canales de texto públicos como privados o agrega listas negras de herramientas entre canales. Los canales con restricciones en Discord son privados automáticamente. Los canales privados no tienen registros de pensamiento ni herramientas entrantes entre canales, incluidos vistazos, creación de hilos y tareas programadas desde otros canales. La STM no puede entrar ni salir a menos que `Uso compartido de STM de canales privados` esté en `Permitido`. Aún puedes pedirle al bot que trabaje dentro de un canal privado o despachar tareas hacia afuera; una tarea saliente puede incluir información de tu conversación.

La privacidad automática comprueba los permisos de roles: `@everyone` debe poder ver el canal y ningún rol puede tener una denegación explícita de `Ver canal`. Las excepciones individuales para miembros no afectan esta clasificación. Por lo tanto, los servidores con roles de verificación o roles de restricción que denieguen la vista pueden tener canales marcados como privados incluso cuando los miembros comunes puedan leerlos. El panel distingue la privacidad automática de las selecciones manuales. Quitar una selección manual no puede anular las restricciones de Discord.

## Transparencia: registros de pensamiento

En `/config` > `Canales` > Registros y bienvenida, haz clic en `Establecer canal de registros` para designar un canal donde TomoriBot publica su razonamiento interno, avisos alternativos y llamadas de herramientas exitosas. Esto es útil para auditar lo que está haciendo, incluido qué disparador expuso una herramienta en [Modo de herramientas deliberado](/features/capabilities/tools-and-extensions/deliberate-tool-mode/).

El registro utiliza la misma comprobación de privacidad basada en roles que la STM. La actividad en canales privados y sus hilos permanece fuera del registro. El canal de registros debe estar en el mismo servidor.

:::tip
El canal de registros puede estar restringido a tu equipo de moderación mientras recibe actividad de canales abiertos a todos los roles.
:::

## Saludos de bienvenida

En `/config` > `Canales` > Registros y bienvenida, configure saludos automatizados para nuevos miembros en un canal elegido. TomoriBot espera hasta que el nuevo miembro complete la evaluación y la incorporación de las reglas de Discord antes de enviar el saludo. Si un miembro se va antes de finalizar la evaluación, no se envía ningún saludo. Haz clic en `Borrar bienvenida` en esa misma página para desactivar los saludos.

## Expresiones

Ejecuta `/expressions initialize` para indexar los emojis y stickers personalizados de su servidor para que las personas puedan usarlos con precisión en la conversación. Para saber cómo las personas usan emojis, stickers y reacciones, consulte [Expresiones y reacciones](/features/chatting-personality/chatting-and-triggers/#expressions--reactions).
