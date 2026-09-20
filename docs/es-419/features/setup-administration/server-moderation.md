---
title: "Moderación del servidor"
sidebar:
  order: 2
---

TomoriBot le da a los administradores del servidor control sobre cómo se comporta en tu
servidor: quién puede usarla, dónde y cuánto cuesta, a través del panel `/config` y sus
comandos relacionados. La mayoría requiere el permiso **Administrar servidor**. Esta página
cubre lo más destacado; cada comando está en la
[Referencia de comandos](/en/features/command-reference/).

## Control de costo: cuotas {#cost-control-quotas}

Generar contenido cuesta dinero (tuyo o de tus miembros). Las cuotas limitan el uso por usuario
y a nivel de todo el servidor:

- `/moderation` → **Cuotas**: configura límites diarios por usuario y fondos comunes de todo el
  servidor que se restablecen, para generación de texto, imagen y video.
- `/quota reset`: restablece manualmente el fondo de un usuario o del servidor.

Establece un límite por usuario en `0` para uso ilimitado. Los fondos comunes de todo el
servidor se restablecen en un intervalo de días configurable.

## BYOK de usuario (trae tu propia clave) {#user-byok-bring-your-own-key}

`/moderation` **(Acceso de miembros)** lleva esto como una opción de dos estados. **Permitir
modelos del servidor** es el predeterminado; **Requerir proveedores personales** hace que cada
miembro traiga su **propio** proveedor personal para sus activaciones: el servidor no paga nada
por los mensajes iniciados por el usuario. Las activaciones iniciadas por el servidor siguen
usando el proveedor del servidor. Este es el control de costo más fuerte: traslada por completo
el gasto de API a los miembros. Los miembros configuran el suyo en
[Personalización → Tus propios proveedores](/es-419/features/knowledge/personalization/#your-own-providers).

También puedes arrancar un servidor sin **ningún** proveedor de texto del lado del servidor
eligiendo **BYOK de usuario** durante `/setup`. Se ofrece en servidores en lugar de en mensajes
directos, y pide confirmación antes de completar el paso de proveedor, porque el espacio de
trabajo se queda entonces sin proveedor de respaldo.

## Control de acceso: listas blancas

- `/moderation` → **Lista blanca** → **Canales**: elige los canales de activación y anulaciones
  de enfriamiento opcionales.
- `/moderation` → **Lista blanca** → **Personas**: limita en qué canales puede activarse una
  persona específica.
- `/moderation` → **Lista blanca** → **Roles**: restringe la activación a roles específicos.
- `/config` > Motor > Activador: establece el enfriamiento global entre respuestas.

Los canales en lista blanca heredan el enfriamiento global a menos que establezcas una
anulación específica del canal.

## Controles de aprendizaje y privacidad

- `/server memberpermissions`: controla quién puede enseñarle cosas.
- `/server blacklist`: evita que aprenda de usuarios específicos o use memorias sobre ellos.
- `/config` > Canales > Reglas de canal: marca canales donde la memoria a corto plazo está
  aislada y los registros de pensamiento están suprimidos.

## Transparencia: registros de pensamiento

`/server thought-logs` establece un canal donde se publican su razonamiento interno y las
llamadas a herramientas exitosas; útil para auditar qué está haciendo (incluido qué activador
expuso una herramienta en el
[Modo de herramientas deliberado](/es-419/features/capabilities/tools-and-extensions/#deliberate-tool-mode)).

## Saludos de bienvenida

`/config` > Canales > Registros y bienvenida configura un saludo automático para nuevos miembros
en un canal elegido. Por defecto, Tomori espera un minuto antes de saludarlos para que la
incorporación del servidor pueda terminar. Los operadores de instancia pueden ajustar este
período de gracia con `WELCOME_DELAY_MS`. Usa el botón **Borrar bienvenida** en esa misma página
para detener los saludos.

## Expresiones

`/expressions initialize` registra los emojis y stickers personalizados de tu servidor para que
los use con precisión; recomendado justo después de la configuración inicial. Para saber qué
hace con ellos (uso natural de `:emoji:`, stickers, reacciones), consulta
[Expresiones y reacciones](/es-419/features/chatting-personality/chatting-and-triggers/#expresiones-y-reacciones).
