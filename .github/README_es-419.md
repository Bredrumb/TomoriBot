### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | Español | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> Este README es una breve descripción general. Para la documentación completa y actualizada (guías de configuración, tutoriales de funciones, información de proveedores y más) visita **[docs.tomoribot.app](https://docs.tomoribot.app/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Un asistente de inteligencia artificial personal y sistema de juegos de rol para Discord con autoalojamiento y personalizable, que incluye memoria, múltiples personas, uso de herramientas, multimodalidad y soporte para API o modelos locales.

<p align="center">
  <strong><a href="https://tomoribot.app/">Sitio web oficial</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invitar a TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Servidor de Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Últimos lanzamientos</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Reportar un error</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Solicitar una función</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](../assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## Acerca del proyecto

TomoriBot es un asistente de inteligencia artificial personal y sistema de juegos de rol gratuito y de código abierto para Discord con autoalojamiento, inspirado en SillyTavern y en el descontinuado Clyde de Discord. Se puede usar como un asistente práctico, un compañero personalizable y un compañero de rol para ti en mensajes directos, o para todos en tu servidor de Discord. 

TomoriBot soporta memoria a largo plazo, comportamiento con múltiples personas, herramientas web y MCP, generación de medios en el chat, comandos de barra de Discord, y múltiples proveedores, incluyendo proxies personalizados y el autoalojamiento de tus propios modelos para todo, desde la generación de texto hasta la de video.

### Primeros pasos

Puedes [invitar a la TomoriBot pública](https://discord.com/oauth2/authorize?client_id=841644102059556915) a tu servidor de Discord, o [configurar el autoalojamiento de tu propia instancia](#autoalojamiento) si prefieres un control total sobre tu privacidad y claves de API. TomoriBot utiliza las mejores prácticas de seguridad y cifrado para mantener los datos a salvo, pero el autoalojamiento garantiza que todos los datos permanezcan completamente en tu dispositivo. 

Después de agregarla a tu servidor usando cualquiera de los métodos anteriores, ejecuta el comando de barra `/setup` para ver las instrucciones. Luego puedes simplemente decir su nombre (o mencionarla) para recibir una respuesta. 

## Demostración de funciones


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/capabilities/tools-and-extensions/">Conversación impulsada por inteligencia artificial agentic</a></h3>
<p align="center">TomoriBot tiene MUCHAS herramientas que le permiten ir más allá de solo chatear, como buscar en la web, establecer tareas y recordatorios recurrentes, utilizar los emotes y stickers de tu servidor, y opciones de memoria como RAG y memoria a corto plazo que le permiten recordar el contexto entre canales y servidores.</p>

<br />


![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/chatting-personality/multiple-personas/">Soporte para múltiples personas</a></h3>
<p align="center">La personalidad, el comportamiento y el avatar de TomoriBot en el servidor se pueden cambiar, crear y exportar fácilmente para otros como personas (similar a las tarjetas de personajes de inteligencia artificial compartibles). Importa e incluso transforma tus tarjetas favoritas de SillyTavern a través del comando de barra <code>/persona generate</code>. Puedes tener una cantidad ilimitada de personas diferentes en un solo servidor, cada una con sus propias memorias y agendas. También puedes organizar que trabajen entre sí para realizar tareas en tu servidor (o simplemente para bromear entre ellas).</p>

<br />

![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/capabilities/media-generation/">Entrada y salida multimodal completa</a></h3>
<p align="center">TomoriBot puede procesar imágenes, audio y video enviados
  directamente en Discord y generarlos a cambio usando tus propios puntos de enlace de modelos locales o mediante claves de API, todo lo cual está cifrado dentro de una base de datos persistente. ¡Puedes encontrar flujos de trabajo de ComfyUI listos para usar en <code>assets/comfyui-workflows/</code> y servidores locales de inferencia de audio en <code>servers/</code>!</p>

<br />


![Configuración completamente local con ComfyUI](../assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/">Configuración completamente local</a></h3>
<p align="center">Puedes ejecutar TomoriBot y su base de datos en tu propia PC, con un LLM local para conversaciones, ComfyUI para la generación de imágenes y modelos de voz locales para la generación y transcripción de voz. Todo ese procesamiento de IA puede ocurrir en tu propio hardware sin proveedores de IA en la nube. Discord aún necesita conexión a internet y transmite los mensajes y medios que intercambias con el bot.</p>

<br />

![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/command-reference/">Comandos de barra nativos para configuración</a></h3>
<p align="center">Todo se puede gestionar a través de los comandos de barra nativos de Discord y la interfaz de usuario interactiva. ¡Administra por completo las personas, los mensajes, ajusta los parámetros del modelo, configura servidores de herramientas MCP, ajusta permisos, configura la memoria, establece límites de cuota para los miembros del servidor y mucho más! También puedes preguntarle directamente a TomoriBot qué puede hacer y cuáles son sus comandos de barra. Actualmente, se está desarrollando un panel web para una gestión aún más fácil.</p>

<br />

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/">¡Muchas más funciones, y sumando!</a></h3>
<p align="center">Un montón de funciones divertidas que son fáciles de configurar, que van desde prácticos saludos automáticos para los nuevos miembros del servidor y el movimiento entre canales, hasta cosas graciosas como suplantaciones de usuarios para hacer algunas bromas. Constantemente se están desarrollando nuevas funciones, así que reporta cualquier error a través de los issues de GitHub o del servidor oficial de Discord (o para compartir sugerencias divertidas).</p>

## Recursos útiles

- [Lista completa de proveedores soportados](https://docs.tomoribot.app/es-419/features/setup-administration/providers-and-models/#supported-providers)
- [Cómo ejecutar modelos locales](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/)
- [Seguridad y modelos de amenazas](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Hoja de ruta oficial de TomoriBot](https://github.com/users/Bredrumb/projects/1/views/1)
- [Macros de herramientas para personalización de prompts](https://docs.tomoribot.app/es-419/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Autoalojamiento

Consulta la [documentación de autoalojamiento](https://docs.tomoribot.app/es-419/self-hosting/) para ver las instrucciones de instalación, Docker Compose y servidores locales opcionales.

<!-- AFTER SETUP -->
### Después de invitar / Configuración

#### Comandos básicos

- `/setup` - Configuración inicial del bot para tu servidor
- `/config` - Múltiples formas de ajustar a TomoriBot
- `/personal memories` - Administra tus memorias personales
- `/memories` - Administra memorias del servidor, documentos y la memoria a corto plazo
- `/moderation` - Administra el acceso de miembros, la lista negra de usuarios, las restricciones de canal, de personas y de roles

Consulta la **[Referencia de comandos](https://docs.tomoribot.app/es-419/features/command-reference/)** completa para ver todos los comandos de barra.

#### Interacción de chat

Simplemente menciona al bot en un servidor o usa las palabras de activación configuradas para iniciar una conversación:
```
@TomoriBot hola, ¿qué pasa?
```

¡O envíale un mensaje directo a TomoriBot y dile hola!

## Agradecimientos

¡Muchísimas gracias a todos, en especial a las siguientes personas maravillosas por sus contribuciones de código y consejos que dieron forma a TomoriBot para ser lo que es hoy!

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Bredrumb" title="Bredrumb: Creator, maintainer, and code contributions">
        <img src="https://avatars.githubusercontent.com/u/65227425?s=128" width="64" height="64" alt="Bredrumb: Creator, maintainer, and code contributions"><br>
        Bredrumb
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/palinalif" title="palinalif: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/31247276?s=128" width="64" height="64" alt="palinalif: Code contributions"><br>
        palinalif
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/baetican" title="baetican: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/280696164?s=128" width="64" height="64" alt="baetican: Code contributions"><br>
        baetican
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/struffl" title="struffl: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/1026348?s=128" width="64" height="64" alt="struffl: Software design and technical guidance"><br>
        struffl
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Rhapsody-Sky" title="Rhapsody-Sky: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/8095300?s=128" width="64" height="64" alt="Rhapsody-Sky: Software design and technical guidance"><br>
        Rhapsody-Sky
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/aph31" title="aph31: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/251111747?s=128" width="64" height="64" alt="aph31: Code contributions"><br>
        aph31
      </a>
    </td>
  </tr>
</table>

<!-- CONTACT -->
## Contacto y enlaces

**Sitio web oficial**: [https://tomoribot.app](https://tomoribot.app/)

**Correo electrónico**: bredrumb@gmail.com

**Discord**: [Servidor de soporte oficial](https://discord.gg/bjCfHm9QsB)


## Licencia
Este proyecto está bajo la licencia [AGPLv3](LICENSE).

<!-- SUPPORT -->
## Apoyar el proyecto

Si TomoriBot te parece útil y quieres apoyar su desarrollo continuo, ¡considera dejar una ⭐ en GitHub o dar tu apoyo a través de Ko-fi!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
  </a>
</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/
