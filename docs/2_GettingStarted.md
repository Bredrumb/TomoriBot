# 2. Getting Started with TomoriBot Development

This guide will walk you through setting up your development environment and running TomoriBot for the first time.

## Prerequisites

Before you begin, ensure you have the following installed on your machine:

### Required Software

#### 1. Bun Runtime
Bun is a fast JavaScript runtime and package manager that TomoriBot uses instead of Node.js.

```bash
# Install Bun (Linux/macOS)
curl -fsSL https://bun.sh/install | bash

# Windows (using PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify installation:
```bash
bun --version
```

#### 2. PostgreSQL Database
TomoriBot uses PostgreSQL for persistent data storage.

```bash
# Windows (using Chocolatey)
choco install postgresql

# macOS (using Homebrew)
brew install postgresql

# Linux (Ubuntu/Debian)
sudo apt-get install postgresql postgresql-contrib
```

#### 3. Discord Bot Account
You'll need to create a Discord bot and get its token:

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Navigate to the "Bot" section
4. Click "Add Bot"
5. Under "Token", click "Reset Token" and copy it (you'll need this later)
6. Enable these **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent
7. Navigate to "OAuth2" → "URL Generator"
8. Select scopes: `bot`, `applications.commands`
9. Select bot permissions: `Administrator` (or customize as needed)
10. Copy the generated URL and use it to invite the bot to a test server

#### 4. AI Provider API Key
TomoriBot requires an API key from either:

**Option A: Google Gemini (Recommended)**
- Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
- Create a new API key
- Free tier available with generous limits

**Option B: NovelAI (Alternative)**
- Requires a NovelAI subscription
- Get your API key from NovelAI settings

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

### 2. Install Dependencies

```bash
bun install
```

This will install all packages defined in `package.json`, including:
- Discord.js (Discord API library)
- @google/genai (Google Gemini SDK)
- PostgreSQL driver
- Encryption libraries
- And more...

### 3. Set Up PostgreSQL Database

First, log into PostgreSQL:

```bash
# Linux
sudo -u postgres psql

# macOS (Homebrew)
psql postgres

# Windows (SQL Shell)
psql -U postgres
```

Create the database and user for TomoriBot:

```sql
-- Replace 'your_username' and 'your_password' with your own values
CREATE USER tomori_dev WITH PASSWORD 'secure_password_here';
CREATE DATABASE tomoribot_dev;
GRANT ALL PRIVILEGES ON DATABASE tomoribot_dev TO tomori_dev;

-- Exit PostgreSQL
\q
```

**Important:** Remember the username, password, and database name - you'll need these for the `.env` file.

### 4. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# ============================================
# REQUIRED CONFIGURATION
# ============================================

# Discord Bot Token (from Discord Developer Portal)
DISCORD_TOKEN=your_discord_bot_token_here

# Security - 32 character encryption secret
# Generate with: openssl rand -base64 32
CRYPTO_SECRET=your_32_character_crypto_secret_here

# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=tomori_dev
POSTGRES_PASSWORD=secure_password_here
POSTGRES_DB=tomoribot_dev

# ============================================
# OPTIONAL CONFIGURATION
# ============================================

# Bot Display Name (defaults shown)
DEFAULT_BOTNAME=Tomori
DEFAULT_BOTNAME_JP=ともり

# Trigger Words (comma-separated, case-insensitive)
BASE_TRIGGER_WORDS=tomori,tomo,トモリ,ともり

# Environment
NODE_ENV=development
```

**Security Note:** Never commit your `.env` file to version control! It's already in `.gitignore`.

#### Generating a Secure CRYPTO_SECRET

The `CRYPTO_SECRET` is used to encrypt API keys in the database. Generate a secure one:

```bash
# Using OpenSSL (Linux/macOS)
openssl rand -base64 32

# Using Node.js (cross-platform)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using Bun (cross-platform)
bun -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Running TomoriBot

### Development Mode (Recommended for Development)

This mode includes hot-reloading - the bot will automatically restart when you change files:

```bash
bun run dev
```

You should see output like this:

```
┌──────────────────────────────────────────────────┐
│ Initializing Encryption Key Manager...          │
└──────────────────────────────────────────────────┘
✓ Encryption key manager initialized: V1 active, 1 version(s) available, rotation disabled

┌──────────────────────────────────────────────────┐
│ Initializing Database...                        │
└──────────────────────────────────────────────────┘
✓ PostgreSQL database schema verified
✓ PostgreSQL database seed verified

┌──────────────────────────────────────────────────┐
│ Cleaning up expired cooldowns...                │
└──────────────────────────────────────────────────┘
✓ Cooldowns cleanup completed: 0 expired entries removed

┌──────────────────────────────────────────────────┐
│ Initializing Tool Registry...                   │
└──────────────────────────────────────────────────┘
✓ Tool registry initialized successfully

┌──────────────────────────────────────────────────┐
│ Initializing Locales...                         │
└──────────────────────────────────────────────────┘
✓ Localizer initialized with 2 locale(s): en-US, ja

┌──────────────────────────────────────────────────┐
│ Initializing LLM Configuration Cache...         │
└──────────────────────────────────────────────────┘
✓ LLM configuration cache initialized successfully

┌──────────────────────────────────────────────────┐
│ Initializing Preset Avatar Cache...             │
└──────────────────────────────────────────────────┘
✓ Preset avatar cache initialized successfully

✓ TomoriBot is now online!
✓ Registered 0 global commands
✓ Refreshed 54 commands in 1 guild(s)
✓ Registered 3 MCP servers
```

### Production Mode

For production deployments:

```bash
# Build the project
bun run build

# Run the built version
bun run start
```

### Using Docker Compose (Alternative)

If you prefer containerization:

```bash
# Build the container (first time or after code changes)
docker compose build

# Start TomoriBot and PostgreSQL
docker compose up

# Run in detached mode
docker compose up -d

# Stop containers
docker compose down
```

**Note:** For Docker, your `.env` only needs `POSTGRES_PASSWORD` - other database variables are handled by Docker Compose.

## Initial Bot Setup

Once TomoriBot is running, go to your Discord test server and run:

```
/config setup
```

This will:
- Create a server entry in the database
- Set up default configuration
- Initialize the bot for your server

Then configure an API key:

```
/config apikey set provider:google key:your_gemini_api_key_here
```

Or for NovelAI:

```
/config apikey set provider:novelai key:your_novelai_key_here
```

## Testing TomoriBot

Try these commands to verify everything works:

### 1. Ping Test
```
/tool ping
```
Response: Shows latency and uptime.

### 2. Check Status
```
/tool status
```
Response: Shows memory configuration and bot health.

### 3. Chat Test
Mention the bot or use a trigger word:
```
@TomoriBot hello!
```
or
```
tomori how are you?
```

TomoriBot should respond with a streaming message!

## Common Scripts

TomoriBot includes several utility scripts in `package.json`:

| Script | Command | Purpose |
|--------|---------|---------|
| **Development** | `bun run dev` | Run with hot-reload |
| **Build** | `bun run build` | Compile TypeScript to dist/ |
| **Start** | `bun run start` | Run built version |
| **Lint** | `bun run lint` | Check and fix code style |
| **Type Check** | `bun run check` | Verify TypeScript types |
| **Clean** | `bun run clean-dist` | Remove dist/ folder |
| **Purge Commands** | `bun run purge-commands` | Remove all slash commands |
| **Seed DB** | `bun run seed-db` | Add sample data to database |
| **Nuke DB** | `bun run nuke-db` | ⚠️ Delete all database data |
| **Backup DB** | `bun run backup-db` | Create database backup |
| **Check Locales** | `bun run check-locales` | Verify i18n key consistency |
| **Check Limits** | `bun run check-limits` | Verify Discord API limits compliance |
| **Audit Keys** | `bun run audit-keys` | Audit encryption key versions |
| **Rotate Keys** | `bun run rotate-keys` | Rotate encryption keys |
| **Check Keys** | `bun run check-keys` | Check for exposed keys in code |

## Project Structure Quick Reference

```
TomoriBot/
├── src/                    # Source code
│   ├── index.ts           # Entry point
│   ├── commands/          # Slash command definitions
│   ├── events/            # Discord event handlers
│   ├── providers/         # AI provider integrations
│   ├── tools/             # Function calls & MCP servers
│   ├── utils/             # Helper functions
│   ├── db/                # Database schema & images
│   ├── locales/           # i18n translations
│   └── types/             # TypeScript type definitions
├── scripts/               # Utility scripts
├── docker/                # Docker configuration
├── .env                   # Environment variables (create this)
├── package.json           # Dependencies & scripts
├── tsconfig.json          # TypeScript configuration
└── compose.yaml           # Docker Compose configuration
```

## Troubleshooting

### Database Connection Failed
**Problem:** `Error: connect ECONNREFUSED`

**Solution:**
1. Ensure PostgreSQL is running: `sudo service postgresql status`
2. Check `.env` database credentials match what you created
3. Verify PostgreSQL is listening on port 5432

### Discord Login Failed
**Problem:** `Error: Incorrect login details`

**Solution:**
1. Verify `DISCORD_TOKEN` in `.env` is correct
2. Check the token hasn't been regenerated in Discord Developer Portal
3. Ensure no extra spaces or quotes around the token

### Commands Not Showing Up
**Problem:** Slash commands aren't visible in Discord

**Solution:**
1. Wait 1-2 minutes for Discord to register commands
2. Try `/config setup` to re-register
3. Verify bot has `applications.commands` scope
4. Check bot permissions in server settings

### Hot Reload Not Working
**Problem:** Changes aren't reflected when running `bun run dev`

**Solution:**
1. Ensure you're editing files in `src/`, not `dist/`
2. Check for syntax errors in your changes
3. Restart the dev server manually

### Missing Dependencies
**Problem:** Import errors or missing modules

**Solution:**
```bash
# Reinstall all dependencies
rm -rf node_modules bun.lock
bun install
```

## Next Steps

Now that you have TomoriBot running locally:

1. **Read "Architecture Overview"** (document 3) to understand the design
2. **Explore "Entry Point & Initialization"** (document 4) to see startup flow
3. **Make a test change** to a command and see it hot-reload
4. **Browse the code** in your editor with TypeScript intellisense

Happy coding! 🎉
