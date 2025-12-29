# 1. Introduction to TomoriBot

Welcome to the TomoriBot Developer Documentation! This guide is designed to help you understand how TomoriBot works from the ground up.

## What is TomoriBot?

TomoriBot is a **customizable AI assistant Discord bot** built with TypeScript and Bun. She's designed to be an interactive, personality-driven chatbot that can:
- Have natural conversations using AI (Google Gemini or NovelAI)
- Remember information about users and servers
- Express emotions through server stickers and emojis
- See and understand images/videos in chat
- Search the internet for current information
- Switch between different personalities
- Communicate in multiple languages (English and Japanese)

Think of TomoriBot as a "waifu" bot - an AI companion with personality, memory, and expressiveness.

## Key Features at a Glance

### 🤖 AI-Powered Conversations
- Uses Large Language Models (LLMs) from Google Gemini, OpenRouter, or NovelAI
- Access to GPT, Claude, Llama, and more via OpenRouter
- Supports streaming responses for real-time interaction
- Context-aware conversations with memory

### 🧠 Persistent Memory System
- Remembers facts about individual users (personal memories)
- Remembers server-specific information
- User attributes (nicknames, preferences)
- Sample dialogues for personality consistency

### 🎭 Personality & Customization
- Multiple personality presets (personas)
- **Custom system prompts** for advanced behavior control
- Configurable behavior and response style
- Custom trigger words for activation
- Humanization options (emoji limiting, response shortening)
- Timezone configuration

### 🗿 Expressions & Media
- **AI image generation** via Gemini Imagen and OpenRouter models
- Function-based emoji and sticker usage
- Computer vision for understanding images/videos
- Avatar customization per server

### 🔍 Tool Integration
- **Image generation** (text-to-image, image-to-image)
- Web search capabilities (Brave Search, DuckDuckGo)
- YouTube video information extraction
- Message pinning
- Reminder system
- Profile picture viewing
- Media context expansion

### 🌐 Multi-Language Support
- Full internationalization (i18n) system
- Native English and Japanese support
- User-level language preferences

### 📊 Robust Data Layer
- PostgreSQL database for persistence
- Encrypted API key storage with key rotation
- **3-level privacy system** (MINIMAL, PARTIAL, FULL)
- GDPR compliance with export/import/delete functionality

### ⚙️ Modern Discord Integration
- Slash commands (60+ subcommands across 15 categories)
- Event-driven architecture
- Direct message support
- Per-server configuration

## Technology Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **TypeScript** | Primary programming language | 5.9.2 |
| **Bun** | Runtime & package manager | Latest |
| **Discord.js** | Discord API library | 14.22.1 |
| **PostgreSQL** | Database | 8.x+ |
| **Google Gemini API** | Primary AI provider | Latest |
| **NovelAI API** | Alternative AI provider | Latest |
| **MCP SDK** | Model Context Protocol tools | 1.17.3 |
| **Zod** | Schema validation | 3.24.4 |
| **libsodium** | Encryption | 0.7.15 |

## Project Philosophy

TomoriBot is designed with several core principles:

1. **Modularity**: Components are loosely coupled and can be extended independently
2. **Type Safety**: Full TypeScript with strict mode for reliability
3. **User Privacy**: Encrypted storage, opt-out controls, GDPR compliance
4. **Configurability**: Nearly every aspect can be customized per server/user
5. **Internationalization**: Multi-language from the ground up
6. **Error Resilience**: Graceful degradation and comprehensive error handling

## Who Should Use This Documentation?

This documentation is written for:
- **Junior developers** joining the TomoriBot project
- **Contributors** looking to add features or fix bugs
- **Developers** wanting to understand Discord bot architecture
- **Anyone** curious about building sophisticated AI chatbots

## Documentation Structure

This documentation follows a progressive learning path:

1. **Introduction** (you are here) - Overview and key concepts
2. **Getting Started** - Setup, configuration, and first run
3. **Architecture** - High-level design patterns and principles
4. **Entry Point** - How the bot initializes (index.ts walkthrough)
5. **Database Schema** - Data model, tables, and relationships
6. **Event System** - Discord event handling
7. **Command System** - Slash command structure
8. **AI Providers** - LLM integration (Gemini, NovelAI)
9. **Tool System** - Function calls and external integrations
10. **Streaming & Response** - Real-time message delivery
11. **Utils & Helpers** - Common utilities explained
12. **Localization** - Multi-language support
13. **Security & Privacy** - Encryption and user protection
14. **Development Tasks** - Practical guides for common changes

## What Makes TomoriBot Special?

Unlike simple chatbots, TomoriBot features:

- **Stateful Conversations**: She remembers who you are and what you've told her
- **Personality System**: Different presets change her behavior and responses
- **Tool Usage**: She can autonomously decide when to search the web, set reminders, or use other tools
- **Expression**: She doesn't just talk - she reacts with emojis and stickers based on context
- **Privacy First**: Users can opt out, export their data, or be forgotten entirely
- **Production Ready**: Error handling, rate limiting, cooldowns, encrypted secrets

## Next Steps

Ready to dive in? Here's what to do next:

1. **Read "Getting Started"** (document 2) to set up your development environment
2. **Understand the Architecture** (document 3) to grasp the big picture
3. **Follow the Initialization Flow** (document 4) to see how the bot starts up
4. **Explore specific systems** (documents 5-13) based on what you're working on
5. **Use Development Tasks** (document 14) as a reference when implementing features

Let's get started! 🚀
