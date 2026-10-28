### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | Español | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Un sistema de asistente de IA personal y juego de rol personalizable y con autoalojamiento para Discord con memoria, múltiples personas, llamada de herramientas, soporte para modelos locales/API, *¡y* un montón de otras funciones divertidas!

<p align="center">
  <strong><a href="https://docs.tomoribot.app/es-419/">Documentación oficial</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invita a TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Servidor de Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Últimas versiones</a>
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
# Acerca del proyecto

TomoriBot es un asistente de IA personal y sistema de juego de rol gratuito y de código abierto para Discord, inspirado en SillyTavern y en el descontinuado Clyde de Discord. Se puede usar como un asistente práctico, un compañero personalizable, un compañero de rol, o TODO lo anterior para ti y para todos en tu servidor de Discord.

## Demostración de funciones


![Screenshots 1](../assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/capabilities/tools-and-extensions/">Conversación impulsada por IA con agentes</a></h3>
<p align="center">TomoriBot tiene muchas herramientas que le permiten ir más allá de solo chatear, como buscar en la web, programar tareas y recordatorios recurrentes, utilizar los emotes y stickers de tu servidor, generar contenido multimedia y memoria persistente para recordar el contexto entre canales y servidores.</p>

<br />


![Screenshots 2](../assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/chatting-personality/multiple-personas/">Soporte para múltiples personas</a></h3>
<p align="center">La personalidad, el comportamiento y el avatar de TomoriBot en el servidor se pueden cambiar, crear y exportar fácilmente para otros como personas (similar a las tarjetas de personajes de IA compartibles). Importa e incluso transforma tus tarjetas favoritas de SillyTavern a través de <code>/persona generate</code>. Puedes tener una cantidad ilimitada de personas diferentes en un solo servidor, cada una con sus propias memorias y agendas. También puedes organizar que trabajen entre sí para realizar tareas en tu servidor (o simplemente para bromear entre ellas).</p>

<br />

![Screenshots 3](../assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/command-reference/">Comandos de barra nativos para configuración y ejecución</a></h3>
<p align="center">Configura y personaliza a TomoriBot sin salir de Discord. Usa comandos de barra y menús interactivos para crear personas, ajustar prompts y parámetros de modelos, conectar servidores MCP, gestionar memorias y controlar permisos y límites de uso. Ejecuta comandos tú mismo para generar imágenes y mensajes de voz, tirar dados y probar otras funciones divertidas.</p>

<br />

![Screenshots 4](../assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/">Configuración completamente local</a></h3>
<p align="center">TomoriBot puede ejecutarse a sí misma y a su base de datos cifrada en tu propia PC, con un LLM local para conversaciones, ComfyUI para la generación de imágenes y videos (<code>/assets/comfyui-workflows/</code>), motores de búsqueda locales y modelos de voz locales para la generación y transcripción de voz (<code>/servers/</code>), todo sin necesidad de ningún proveedor en la nube.</p>

<br />

![Screenshots 5](../assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/">¡Muchas más funciones, y sumando!</a></h3>
<p align="center">Un montón de funciones divertidas que van desde prácticos saludos automáticos para nuevos miembros del servidor y chat de voz, hasta opciones de rol como tiradas de dados y acciones lúdicas. Constantemente se desarrollan nuevas funciones, así que reporta cualquier error a través de los issues de GitHub o del Discord oficial (o para compartir sugerencias divertidas).</p>

<!-- GETTING STARTED -->
# Primeros pasos

Puedes [invitar a la TomoriBot pública](https://discord.com/oauth2/authorize?client_id=841644102059556915) a tu servidor de Discord ahora mismo por comodidad, o [configurar el autoalojamiento de tu propia instancia](#autoalojamiento) si prefieres un control total sobre tu privacidad y claves de API. TomoriBot utiliza las mejores prácticas de seguridad y cifrado para mantener los datos a salvo, pero el autoalojamiento garantiza que todos los datos permanezcan completamente en tu dispositivo:

## Autoalojamiento

1. **Requisitos previos:**
   - [Bun](https://bun.sh/) v1.3.2+ (se recomienda v1.4.0+)
   - [PostgreSQL](https://www.postgresql.org/) o [Docker](https://www.docker.com/) (el asistente de instalación usa una instalación existente de PostgreSQL o inicia una en Docker)
   - Un [token de bot de Discord](https://discord.com/developers/applications) con `Presence Intent`, `Server Members Intent` y `Message Content Intent` habilitados
2. **Ejecuta el asistente de instalación:**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # instala dependencias, configura .env y prepara PostgreSQL
   bun run dev # inicia el bot y ejecuta las migraciones de la base de datos automáticamente
   ```

Para más detalles o si tienes problemas con los pasos anteriores, consulta la [documentación de autoalojamiento](https://docs.tomoribot.app/es-419/self-hosting/) completa.

<!-- AFTER SETUP -->
### Después de invitar / Configuración

Simplemente menciona al bot en un servidor o usa las palabras de activación configuradas para iniciar una conversación:
```
@TomoriBot hola, ¿qué pasa?
```

¡O entra a los mensajes directos (DM) de TomoriBot y dile hola!

#### Comandos básicos

- `/setup` - Configuración inicial del bot para tu servidor
- `/config` y `/personal config` - Múltiples formas de ajustar a TomoriBot en el servidor actual o para ti
- `/providers` y `/personal providers` - Agrega más puntos de enlace de modelos o proveedores en la nube
- `/persona` - Dale una personalidad o añade nuevos personajes (consulta [Personas múltiples](https://docs.tomoribot.app/es-419/features/chatting-personality/multiple-personas/))
- `/memories` - Enséñale datos a través de las conversaciones (consulta [Memoria](https://docs.tomoribot.app/es-419/features/knowledge/memory/))

Consulta la [referencia de comandos](https://docs.tomoribot.app/es-419/features/command-reference/) completa para ver todos los comandos de barra.


## Agradecimientos

¡Muchísimas gracias a todos, *especialmente* a las siguientes increíbles personas por sus significativas contribuciones y consejos que ayudaron enormemente a moldear a TomoriBot para mejor!

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

## Licencia
Este proyecto está bajo la licencia [AGPLv3](../LICENSE).

---

Si encuentras útil (o divertido) a TomoriBot, ¡considera darle una ⭐ al repositorio o apoyar el desarrollo a través de Ko-fi o Patreon!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
  </a>
  &nbsp;
  <a href="https://www.patreon.com/cw/tomoribot">
    <img src="https://img.shields.io/badge/Support_on_Patreon-FF424D?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon">
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
