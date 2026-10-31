### English | [日本語](.github/README_ja.md) | [繁體中文](.github/README_zh-TW.md) | [简体中文](.github/README_zh-CN.md) | [Español](.github/README_es-419.md) | [Português (Brasil)](.github/README_pt-BR.md) | [Tiếng Việt](.github/README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

A self-hosted and customizable personal AI assistant/role-playing system for Discord with memory, multiple personas, tool calling, API/local model support, *and* a bunch of other fun features!

<p align="center">
  <strong><a href="https://docs.tomoribot.app/">Official Docs</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invite TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord Server</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Latest Releases</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Report Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Request Feature</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
# About the Project

TomoriBot is a free and open-source personal AI assistant and role-playing system for Discord, inspired by SillyTavern and Discord's discontinued Clyde. It can be used as a practical assistant, customizable companion, role-play partner, or ALL of the above for you and everyone else in your Discord server.

## Feature Showcase


![Screenshots 1](assets/img/scs/1-agentic.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/capabilities/tools-and-extensions/">Agentic AI-Powered Conversation</a></h3>
<p align="center">TomoriBot has lotsa tools that allows her to go beyond just chatting, such as searching the web, setting recurrent tasks/reminders, utilizing your server's emotes/stickers, media generation, and persistent memory that allow her to remember context across channels and servers. </p>

<br />


![Screenshots 2](assets/img/scs/2-multipersona.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/chatting-personality/multiple-personas/">Multi-Persona Support</a></h3>
<p align="center">TomoriBot's in-server personality, behavior, and avatar can be easily changed, created, as well as exported for others as Personas (akin to shareable AI Character Cards). Import and even transform your favorite SillyTavern cards through <code>/persona generate</code>. You can have an unlimited amount of different personas in a single server, each having their own memories and agendas. You can also orchestrate them to work with each other to do work in your server (or just mess around with each other).</p>

<br />

![Screenshots 3](assets/img/scs/3-commands.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/command-reference/">Native Slash Commands for Config and Execution</a></h3>
<p align="center">Set up and customize TomoriBot without leaving Discord. Use slash commands and interactive menus to create personas, fine-tune prompts and model settings, connect MCP servers, manage memories, and control permissions and usage limits. Run commands yourself to generate images and voice messages, roll dice, and try other fun features.</p>

<br />

![Screenshots 4](assets/img/scs/4-comfyui.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/self-hosting/local-endpoints/">Fully Local Setup</a></h3>
<p align="center">TomoriBot can run itself and its encrypted database on your own PC, with a local LLM for conversations, ComfyUI for image/video generation (<code>/assets/comfyui-workflows/</code>), local search engines, and local speech models for voice generation and transcription (<code>/servers/</code>), all without the need for any cloud provider.</p>

<br />

![Screenshots 5](assets/img/scs/5-features.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/">Lots of More Features, and Counting!</a></h3>
<p align="center">A bunch of fun features ranging from practical automatic greetings for new server members and voice chat, to role-play ones like dice rolls and actions. New ones are constantly in development, so please report through GitHub issues or the official Discord for any bugs (or to share any fun suggestions).</p>

<!-- GETTING STARTED -->
# Getting Started

You can [invite the public TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915) to your Discord server now for convenience, or [self-host your own instance](#self-hosting) if you prefer full control over your privacy and API keys. TomoriBot uses best security practices and encryption that keeps data safe, but self-hosting ensures that all data remains entirely on your device:

## Self-Hosting

There are two easy ways to get TomoriBot running on your PC:

### Option 1: Setup Wizard (Recommended)

1. **Prerequisites:**
   - [Bun](https://bun.sh/) v1.3.2+ (v1.4.0+ recommended)
   - [PostgreSQL](https://www.postgresql.org/) or [Docker](https://www.docker.com/) (the setup wizard uses an existing PostgreSQL install or starts one in Docker for the database)
   - A [Discord bot token](https://discord.com/developers/applications) with `Presence Intent`, `Server Members Intent`, and `Message Content Intent` enabled
2. **Run the setup wizard:**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   bun run setup # installs dependencies, configures .env, and sets up PostgreSQL
   bun run dev # starts the bot and runs DB migrations automatically
   ```

### Option 2: Docker Compose

1. **Prerequisites:**
   - [Docker](https://www.docker.com/) and Docker Compose v2+
   - A [Discord bot token](https://discord.com/developers/applications) with `Presence Intent`, `Server Members Intent`, and `Message Content Intent` enabled
2. **Run with Docker Compose:**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   cp .env.example .env # set DISCORD_TOKEN, CRYPTO_SECRET, and POSTGRES_PASSWORD
   docker compose up
   ```

<!-- AFTER SETUP -->
### After Inviting / Setup

Simply mention the bot in a server or use the configured trigger words to start a conversation:
```
@TomoriBot yo wassup
```

Or slide into TomoriBot's DMs and say hi!

#### Basic Commands

- `/setup` - Initial bot setup for your server
- `/config` and `/personal config` - Multiple ways to tweak TomoriBot in the current Discord server or for yourself
- `/providers` and `/personal providers` - Add more model endpoints or cloud providers
- `/persona` - Give her a personality or add new characters (see [Multiple Personas](https://docs.tomoribot.app/en/features/chatting-personality/multiple-personas/))
- `/memories` - Teach her facts across conversations (see [Memory](https://docs.tomoribot.app/en/features/knowledge/memory/))

See the full [command reference](https://docs.tomoribot.app/en/features/command-reference/) for every slash command.


## Acknowledgements

Huge thanks to everyone, *especially* to the following lovely people for their significant contributions and advices that greatly helped shape TomoriBot for the better!

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

## License
This project is licensed under [AGPLv3](LICENSE).

---

If you find TomoriBot useful (and/or fun), consider ⭐ing the repo or supporting development via Ko-fi or Patreon!

<p align="left">
  <a href="https://ko-fi.com/bredrumb"><img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi"></a>
  <a href="https://www.patreon.com/cw/tomoribot"><img src="https://img.shields.io/badge/Support_on_Patreon-FF424D?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon"></a>
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
