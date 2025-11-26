



<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="img/tomoricon.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

A highly customizable chatbot/waifu for Discord featuring smart agentic AI features such as memory, personas, tool usage, and more!

<p align="center">

English | [日本語](README_ja.md)
<br />
      <br />
      <a href="https://github.com/Bredrumb/TomoriBot/releases">Latest Releases</a>
      &middot;
      <a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invite TomoriBot</a>
      &middot;
      <a href="https://discord.gg/bjCfHm9QsB">Discord Server</a>
      &middot;
      <a href="https://github.com/Bredrumb/TomoriBot/issues/new?labels=bug&template=bug-report---.md">Report Bug </a>
      &middot;
      <a href="https://github.com/Bredrumb/TomoriBot/issues/new?labels=enhancement&template=feature-request---.md"> Request Feature</a>

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)

  </p>




<!-- PROJECT LOGO -->
![TomoriBot Banner](img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>


<!-- ABOUT THE PROJECT -->
## About the Project

TomoriBot is a free and open-source hobby project inspired by [SillyTavern](https://github.com/SillyTavern/SillyTavern) and Discord's discontinued Clyde. It was created to bring both practical AI assistants and custom AI companions into Discord, all with configurable settings and behaviors.

## Feature Showcase

* 🤖 **AI-Powered Chat**: Advanced conversational AI using Large Language Models
* 🧠 **Memory System**: Persistent user and server memory for contextual conversations
* 🗿 **Emoji/Sticker Expressions**: Uses function calls to send your favorite Server Stickers and Emojis
* 👁️ **Computer Vision**: Utilizes Gemini API to see images and videos in Discord chats
* 🔍 **Search Grounding**: Searches the Internet for latest information
* 🌐 **Multi-Language Support**: Built-in internationalization with Japanese and English support
* 🎭 **Personality Switching**: Configurable personas and behavioral presets
* ⚙️ **Highly Configurable**: Extensive settings for customizing bot behavior
* 📊 **PostgreSQL Database**: Robust data persistence and user management
* 🔧 **Slash Commands**: Modern Discord interaction system with comprehensive command structure

<!-- GETTING STARTED -->
## Self-Hosting

This guide will help you set up TomoriBot locally for development or personal use.

### Prerequisites

Before running TomoriBot, ensure you have the following installed:

* **Bun** - JavaScript runtime and package manager
  ```sh
  curl -fsSL https://bun.sh/install | bash
  ```
* **PostgreSQL** - Database server
  ```sh
  # Windows (using Chocolatey)
  choco install postgresql
  
  # macOS (using Homebrew)
  brew install postgresql
  
  # Linux (Ubuntu/Debian)
  sudo apt-get install postgresql postgresql-contrib
  ```
  - After installing PostgreSQL, login:
  ```sh
  # Linux
   sudo -u postgres psql
   
   # macOS (Homebrew)
   psql postgres
   
   # Windows
   # Use "SQL Shell (psql)" from Start Menu or:
   psql -U postgres
  ```
  - Create the required database and user for TomoriBot. Replace `your_` variables with your own and take note of them:
  ```sql
  CREATE USER your_username WITH PASSWORD 'your_password';
  CREATE DATABASE your_dbname;
  GRANT ALL PRIVILEGES ON DATABASE your_dbname TO your_username;
  \q
  ```

### Installation

1. **Clone the repository**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **Install dependencies**
   ```sh
   bun install
   ```

### Configuration

**Create environment file** `.env` and then fill in the required variables:
   ```
    # Discord Bot Configuration (Required)
    DISCORD_TOKEN=your_discord_bot_token_here

    # Security (Required)
    CRYPTO_SECRET=your_32_character_crypto_secret_here

    # Database Configuration (Required)
    POSTGRES_HOST=localhost
    POSTGRES_PORT=5432
    POSTGRES_USER=your_username
    POSTGRES_PASSWORD=your_password
    POSTGRES_DB=your_dbname

    # Bot Configuration (Optional)
    DEFAULT_BOTNAME=Tomori
    DEFAULT_BOTNAME_JP=ともり
    BASE_TRIGGER_WORDS=tomori,tomo,トモリ,ともり
    
   ```

### Environment Variables Reference

#### Required Variables
- **DISCORD_TOKEN**: Your Discord bot authentication token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **CRYPTO_SECRET**: A 32-character secret key for encrypting API keys stored in the database
- **POSTGRES_HOST**: PostgreSQL server hostname (default: `localhost`)
- **POSTGRES_PORT**: PostgreSQL server port (default: `5432`)
- **POSTGRES_USER**: PostgreSQL database username
- **POSTGRES_PASSWORD**: PostgreSQL database password
- **POSTGRES_DB**: PostgreSQL database name

To find all optional variables you can adjust, check out the `.env.example` file in the repository.


<!-- USAGE EXAMPLES -->
## Usage

### Starting the Bot

There are two ways to start the bot, both of which uses your local `.env` file.

#### Launching with Bun
```sh
# Development mode with hot reload
bun run dev
```

#### Launching with Docker Compose
**Required .env variables for Docker Compose:**
- `DISCORD_TOKEN` - Your Discord bot token
- `CRYPTO_SECRET` - 32-character encryption key
- `POSTGRES_PASSWORD` - Database password (other DB settings are auto-configured)

```sh
# Build TomoriBot's container (first time or after code changes)
docker compose build

# Start TomoriBot and her database (uses docker-compose.yaml)
docker compose up
```

**Note:** Docker Compose automatically configures the database connection. The PostgreSQL service runs in development mode (no SSL) and connects to the internal Docker network.

### Basic Commands

- `/config setup` - Initial bot setup for your server
- `/config` - Multiple ways to tweak TomoriBot
- `/teach` - Add memories for TomoriBot
- `/forget` - Remove memories from TomoriBot
- `/server` - Add / Remove permissions from TomoriBot

### Chat Interaction

Simply mention the bot in a server or use the configured trigger words to start a conversation:
```
@TomoriBot yo wassup
```

Or slide into TomoriBot's DMs and say hi!

<!-- ROADMAP -->
## Roadmap

- [x] Core AI chat functionality
- [x] Memory system implementation
- [x] Slash command structure
- [x] Multi-language Support (Locale system)
- [x] Multiple Provider Support
- [ ] TomoriBot Wiki (for local set-up and locale contributions)
- [ ] Replace AI-generated placeholder assets
- [ ] Image/Video generation capabilities
- [ ] KoboldCPP integration (local only)
- [ ] Voice channel integration
- [ ] Web dashboard for configuration
- [ ] Create "easy install" file for non-technical users wishing to host their own TomoriBot

See the [open issues](https://github.com/Bredrumb/TomoriBot/issues) for a full list of proposed features and known issues.

<!-- CONTRIBUTING -->
## Contributing

Any contributions made  are **greatly appreciated**.

If you have a suggestion that would make TomoriBot better, please fork the repo and create a pull request. You can also simply open an issue with the tag "Enhancement".


<!-- LEGAL -->
## Legal

For users of the official hosted TomoriBot instance:
- **[Terms of Service](legal/en-US/terms-of-service.md)** - Rules and guidelines for using the bot
- **[Privacy Policy](legal/en-US/privacy-policy.md)** - How we handle your data

These documents are also accessible within Discord using `/legal terms` and `/legal privacy` commands.

**Note:** If you're self-hosting TomoriBot, these documents serve as reference templates. Instead, you control your own data pipeline and are responsible for your deployment's compliance under the GNU Affero General Public License v3.0.

<!-- LICENSE -->
## License

Distributed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See `LICENSE` for details. For questions, reach me via bredrumb@gmail.com, the GitHub issues page, or the [official support Discord server](https://discord.gg/bjCfHm9QsB).

<!-- CONTACT -->
## Contact

Project Link: [https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)
Email: bredrumb@gmail.com


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
