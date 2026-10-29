---
title: "Configuración de OAuth de PluralBuddy"
description: "Autoriza tu instancia autoalojada de TomoriBot para verificar mensajes de instancias aprobadas de PluralBuddy."
sidebar:
  order: 8
---

Una instancia autoalojada de TomoriBot necesita una aplicación autorizada de PluralBuddy para el servicio oficial y cada instancia personalizada aprobada.

Si usas el [bot público desplegado](https://discord.com/oauth2/authorize?client_id=841644102059556915),
no necesitas completar esta configuración en el lado del host. Selecciona PluralBuddy con
`/personal message-proxy service:pluralbuddy`; consulta
[Soporte para proxy de mensajes](/features/integrations/message-proxy-support/#pluralbuddy).

## Antes de comenzar

- Ejecuta la versión actual de TomoriBot contra una base de datos PostgreSQL migrada.
- Usa una computadora con un navegador web y acceso a esa base de datos y a la clave de cifrado de TomoriBot. El asistente de autorización escucha en la dirección de bucle invertido de esa computadora. Si la base de datos es remota, coordina un acceso temporal y restringido desde esta computadora.
- Elige un puerto local no utilizado y registra una URL de retorno exacta en el portal de desarrolladores, por ejemplo `http://127.0.0.1:<port>/oauth/callback`. Registra esta URL: la utilizarás en cada uno de los pasos siguientes.

## Autoriza la instancia oficial

1. Inicia sesión en el [portal para desarrolladores de PluralBuddy](https://pluralbuddy.app/developers/applications) y crea una aplicación OAuth. Usa una aplicación independiente para pruebas. Selecciona `profile` y `offline_access`. Registra tu URL de retorno exactamente como la elegiste arriba. Mantén privados el ID de cliente y el secreto.
2. Desde el repositorio de TomoriBot, ejecuta el asistente con el ID de la instancia oficial y la misma URL de retorno:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. Ingresa el ID de cliente y el secreto en las solicitudes de la terminal. Abre en el navegador de esa computadora la URL de autorización mostrada, inicia sesión en PluralBuddy y aprueba la pantalla de consentimiento. El asistente se cierra después de una devolución de llamada o tres minutos, y almacena la conexión en PostgreSQL.
4. Inicia TomoriBot con la misma base de datos y clave de cifrado. Selecciona `/personal message-proxy service:pluralbuddy` en una cuenta de Discord que use PluralBuddy, y luego envía una republicación de webhook para comprobar que TomoriBot reconozca el alter.

El asistente lee la configuración de la base de datos y las claves de cifrado desde `.env` o desde un paquete JSON en `SECRET_FILE`. Mantén el paquete fuera del repositorio y realiza una copia de seguridad de la clave de cifrado. Ingresa el secreto del cliente en la solicitud de la terminal en lugar de guardarlo en `.env` o pasarlo como argumento. Si PluralBuddy revoca la conexión, repite la autorización con el mismo ID de instancia.

## Añade una instancia aprobada

Usa un origen HTTPS público sin ruta, consulta ni fragmento. La instancia debe ejecutar tanto un bot proxy como su API correspondiente.

1. En una computadora con acceso a la base de datos de despliegue, registra una instancia desactivada:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   Para PluralKit, usa `pluralkit` como servicio. El ID de usuario del bot evita esperas innecesarias de búsqueda en servidores donde ese bot no está presente.
2. Para PluralBuddy, registra una aplicación OAuth independiente en esa instancia con el mismo patrón de URL de retorno en bucle invertido indicado arriba. Autorízala utilizando el ID de instancia devuelto por el registro:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   Repite la autorización para reemplazar credenciales o recuperarte de un token de actualización revocado. PluralKit no requiere este paso.
3. A partir de un mensaje escrito por el bot proxy correspondiente, registra su ID de republicación de Discord y el ID de la cuenta del remitente. Comprueba que la API de la instancia resuelva esa republicación y luego actívala:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   Para una bifurcación nueva, prueba el bot, el intercambio y actualización de OAuth, y la búsqueda de TomoriBot en un despliegue desechable antes de activarlo para los usuarios.
4. Los usuarios seleccionan la instancia activada con `/personal message-proxy service:pluralbuddy instance:<name>`. Dejar `instance` vacío elige la instancia oficial. Desactivar una instancia detiene nuevas búsquedas sin alterar los perfiles guardados.

Si se reemplaza el bot proxy personalizado, actualiza el ID de usuario de bot de Discord antes de ofrecer la instancia nuevamente:

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

Desactiva o elimina una instancia personalizada con:

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

La eliminación borra la conexión OAuth y evita de forma permanente que el origen se vuelva a registrar. Usa `disable` si podrías reanudar la instancia en el futuro. Las identidades y memorias existentes permanecen disponibles, y los cambios surten efecto sin reiniciar.

Consulta [Soporte para proxy de mensajes](/features/integrations/message-proxy-support/#pluralbuddy) para la configuración del usuario y la [arquitectura de proxy de mensajes](/architecture/integrations/message-proxy/) para el almacenamiento de tokens y el comportamiento de actualización.
