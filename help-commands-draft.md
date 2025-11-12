# TomoriBot Help Commands - Content Draft

This is a scratchpad for drafting the content of help commands before implementation. Make sure all replyInfoEmbeds use MessageFlags.SuppressNotifications (not MessageFlags.Ephemeral) so that all users can see it when the command is run.

---

## `/help features`
**Purpose**: Show users what TomoriBot can do (based on chatCapabilities.md)

**Embed Title**: What I Can Do! (Version XXXX, [take from package.json])

**Embed Description**:
**Vision & Media** 👁️
- I can see and analyze images, videos, stickers, and emojis
- I can watch YouTube videos from links
- I can see content within Tweets

**Search & Information** 🔍
- I can search the web for current information
- I can also do image, video, and news search (via `/config braveapi`)
- I can fetch and read content from URLs

**Personality & Customization** 💫
- I can change my name and avatar using `/config rename` and `/server avatar`
- I can switch between different personas using `/persona` (you can also share and save personas using `/persona export`!)
- My behavior and tone can be tweaked with `/teach`
- Learn more with `/help customization`

**Memory & Personalization** 🧠
- I can remember personal facts about you and server-wide information, persisting across conversations
- Personal memories persist across servers (try talking to me in another server!)
- Change what I call you using `/personal nickname`
- Use `/teach` to manually help me remember things, `/forget` to remove them
- Learn more with `/help memory`

**Time Awareness** 🕰️
- I know what time it currently is in the server (via `/config timezone`)
- I can set up reminders for you (try asking me to remind you about something!)

**Footer Text**: Note: Not all features are available for all providers. It is recommended to use Google's Gemini

---

## `/help setup`
**Purpose**: Guide new users through first-time server configuration

**Embed Title**: Getting Started with TomoriBot

**Embed Description**:
Here's how to set up TomoriBot in your server (or DMs!):

**Step 1: Get an API Key** 🔑
TomoriBot uses AI providers like Google Gemini, NovelAI, or OpenRouter. You'll need an API key from one of them.
- Use `/help apikey` to learn how to get one
  - Google's Gemini = general-purpose, free, and can run all of TomoriBot's features
  - NovelAI = role-playing and storytelling specialized
  - OpenRouter = various available AI models
- Do **NOT** share this API key with anyone else

**Step 2: Run the Setup Command** ⚙️
- Use `/config setup` to securely add your API key and initialize TomoriBot 
- Your API key is encrypted and stored safely
- Each server has its own configuration

**Step 3: Start Chatting!** 💬
- Just mention me or reply to my messages to chat
- Change how I get triggered using `/server trigger`
- I'll remember our conversations with my memory system (which you can disable using `/config permissions`!)
- Set up auto-trigger with `/server autotrigger` to chat without mentioning me

**Optional: Customize Me** 🎨
- Use `/persona` commands to completely change my personality
- Configure my settings with `/server`, `/personal`, and `/config` commands
- You can also manually teach me things with `/teach`

**Need Help?**
- `/help features` - See what I can do
- `/help memory` - Learn about my memory system
- `/help customization` - Learn about personality customization
- `/support server` - Join the official TomoriBot support server

---

## `/help data`
**Purpose**: Explain data management (export, import, delete) and privacy policy

**Embed Title**: Managing Your Data 🗂️

**Embed Description**:
**Export Your Data** 📤
Use `/data export` to download your data:
- **Personal data**: Your memories, preferences, and user settings
- **Server data**: Server memories, configurations, and bot settings
- **Personality data**: Custom personality presets you've created (use `/persona export` instead to share it with others)
- Data is sent to your DMs as a JSON or text file

**Import Your Data** 📥
Use `/data import` to restore previously exported data:
- Restore your personal data across servers
- Transfer server configurations to a new server
- Share personality presets with others
- Simply attach your exported file when using the command

**Delete Your Data** 🗑️
Use `/data delete` to permanently remove your data:
- **Personal deletion**: Removes all your user data, memories, and preferences
- **Server deletion**: Removes all server data
- Requires confirmation to prevent accidental deletion
- This action cannot be undone!

**Privacy Notice** 🔒
**What I Store:**
- Server/personal memories
- My settings and persona
- Server configurations
- Encrypted API keys

**What I Do NOT Store:**
- Your Discord messages
- Chat history

**What is Sent to Me and your Chosen AI Provider:**
Whenever I'm triggered, I fetch the **latest messages** in the text channel as well as any **relevant memories** as context to form my reply

You may opt out of my Memory features by using the `/personal privacy` command, as well as turn off my self-learning using the `/config permissions` command.

**Embed Footer:**
**Important**: Your chosen AI provider (Google, NovelAI, OpenRouter) processes your messages according to their own privacy policies. Never share personal information with me if you're concerned about privacy.

---

## `/help apikey`
**Purpose**: Provider-specific instructions for getting and setting up API keys

### Option: `brave` (Brave Search - Optional)

**Embed Title**: Setting Up Brave Search API Key

**Embed Description**:
Brave Search is optional and only enhances my search capabilities. It does NOT power my AI as that's handled by your main provider.
- Enables image, video, and news search
- Provides real-time information from the internet
- Enhances my ability to answer current questions
- Free Tier includes 2,000 queries per month

**Getting Your API Key:**
1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Navigate to your [API Keys](https://api-dashboard.search.brave.com/app/keys) section in the Dashboard
4. Create a new API key
5. Copy and input your API key using the `/config braveapi set` command

**Important Notes:**
- Your API key is encrypted and stored securely
- This is separate from your main LLM provider
- Without Brave API key, I can still function and use built-in web search

**Footer Text**: Want to set up your main AI provider? Check the other `/help apikey` options!

---

### Option: `google` (Google Gemini)

**Embed Title**: Setting Up Google Gemini API Key

**Embed Description**:
Google Gemini offers free and paid tiers with powerful AI models.
- Free tier available with generous limits
- Supports all TomoriBot features such as vision and persona generation
- [Gemini Privacy Policy](https://ai.google.dev/gemini-api/terms)

**Getting Your API Key:**
1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Click `Create API Key` on the top-right
3. Copy this API key into `/config setup` or `/config apikey set`

**Footer Text**: After setting up this provider, change its default model with `/config model`!
---

### Option: `novelai` (NovelAI)

**Embed Title**: Setting Up NovelAI API Key

**Embed Description**:
NovelAI is a subscription-based service focused on creative storytelling and roleplay.
- Unlimited uncensored messages
- Currently does not support all TomoriBot features
- [NovelAI Terms of Service](https://novelai.net/terms)

**Getting Your API Key:**
1. Visit [NovelAI](https://novelai.net/stories)
2. Navigate to settings through the ⚙️ icon on the top-left
3. Go to `Account`
4. Look for `Get Persistent API Token`
5. Copy this API key `/config setup` or `/config apikey set`

**Footer Text**: After setting up this provider, change its default model with `/config model`!

---

### Option: `openrouter` (OpenRouter)

**Embed Title**: Setting Up OpenRouter API Key

**Embed Description**:
OpenRouter provides access to multiple AI models from different providers on a pay-as-you-go basis.
- Access to latest and most powerful AI models
- Currently does not support all TomoriBot features
- [OpenRouter Terms of Service](https://openrouter.ai/terms)

**Getting Your API Key:**
1. Visit [OpenRouter](https://openrouter.ai/settings/keys)
2. Click `Create API Key`
3. Copy this API key `/config setup` or `/config apikey set`
3. Add credits to your account (pay-as-you-go)

**Footer Text**: After setting up this provider, change its default model with `/config model`!
---

## `/help memory`
**Purpose**: Explain the teach/forget memory system

**Embed Title**: How My Memory Works 🧠

**Embed Description**:
I have a persistent memory system that helps me remember facts and information about users and servers across conversations! This is about **what I know** (facts, context, information). For **how I behave** (personality, tone, settings), see `/help customization` instead!

**Teaching Me Things** 📝
Use `/teach` to help me remember **facts and information**:
- **Personal memories** (`/teach memory personal`): Facts about individual users
  - Example: "Alex loves cats", "Prefers dark mode", "Is allergic to peanuts"
- **Server memories** (`/teach memory server`): Information relevant to the whole server
  - Example: "Game night is every Friday at 8 PM", "No posting of NSFW", "We use #general for announcements"

**Forgetting Things** 🗑️
Use `/forget` to make me forget memories:
- **`/forget memory personal`** - Remove personal facts about users
- **`/forget memory server`** - Remove server-wide information

**How It Works:**
- **Personal memories** are tied to you specifically across all servers which I only keep in mind when replying in conversations you are actively participating in
- **Server memories** only stay within the server, I always keep them in mind when replying in a conversation within the server
- Memories persist until you use the `/forget` command on them

**Memory Tips:**
- Teach me your preferences, nicknames, and important facts
- Use server memories for shared information, inside jokes, or server culture
- Review your memories periodically with `/data export` or `/status`
- Keep memories concise and clear for best results

---

## `/help customization`
**Purpose**: Comprehensive guide to customizing TomoriBot's behavior and personality, sent as multiple embeds with the first one being the reply

**💡 KEY DISTINCTION:**
- **`/help customization`** = How TomoriBot **behaves** (personality, tone, settings)
- **`/help memory`** = What TomoriBot **knows** (facts, information, context)

---

### **EMBED 1** (replyInfoEmbed) - Overview + Presets

**Embed Title**: Customizing TomoriBot 🎨

**Embed Description**:
TomoriBot is highly customizable! Here's everything you can configure to make me truly yours. This is about **how I behave** (personality, tone, settings). For **what I remember** (facts, memories), see `/help memory` instead!

## 🎭 Personality Personas
Control my core personality and behavior:

**Persona Commands** (`/persona`):
- `/persona create` - Create a custom personality from scratch
- `/persona generate` - AI-generate a personality based on your description (Requires Gemini)
- `/persona default` - Switch to a default personality
- `/persona export` - Export your persona to share or backup
- `/persona import` - Import a persona from a file
- `/teach` - Teach me on how I should talk and act
- `/server avatar` - Change my profile picture

**What Personas Include:**
- Personality attributes (traits, characteristics, and quirks)
- Sample dialogues (example conversations that teach me on how I should speak)
- Custom server avatar for that personality
- Behavior and tone settings

**Footer Text**: Next: Teaching Commands

---

### **EMBED 2** (sendStandardEmbed) - Teaching System

**Embed Title**: Teaching Commands ✍️

**Embed Description**:

## ✍️ Teaching Commands (`/teach`)
Fine-tune my personality and knowledge:

**Personality Shaping:**
- `/teach attribute` - Add personality traits (e.g., "friendly", "sarcastic", "formal")
- `/teach sampledialogue` - Add example conversations to shape how I talk
- `/config rename` - Set what I should call myself

**Writing Sample Dialogues:**
Use `{user}` and `{bot}` placeholders in your examples:
- `{user}` = Replaced with the actual user's name/nickname
- `{bot}` = Replaced with my current name

**Example:**
```
User message: {user}: Hey, how are you?
Bot response: {bot}: Yoooo {user}! I'm doin' great, ya feel me?
```

**Tips for Great Sample Dialogues:**
- Write natural, conversational exchanges
- Include personality traits you want me to exhibit
- Demonstrate the tone you want
- Add variety to help me learn better
- Use placeholders so dialogues work for everyone when sharing me with `/persona export`

**Footer Text**: Next: Configuration

---

### **EMBED 3** (sendStandardEmbed) - Unlearning + Server Config

**Embed Title**: Configuration & Management ⚙️

**Embed Description**:

## 🗑️ Unlearning Commands (`/forget`)
Remove personality customizations:

- `/forget attribute` - Remove specific personality attributes
- `/forget sampledialogue` - Remove sample dialogue examples

---

## ⚙️ Server Configuration (`/server`)
Server-wide settings and behavior:

**Learning & Privacy:**
- `/server memberpermissions` - Control who can teach me things
- `/server blacklist` - Prevent me from learning and using memories from specific users

**Auto-Trigger Behavior:**
- `/server autotrigger channels` - Set channels where I respond without mentions
- `/server autotrigger threshold` - Set message threshold for auto-responses

**Triggers & Appearance:**
- `/server trigger add` - Add custom trigger words I respond to
- `/server trigger delete` - Remove trigger words
- `/server avatar` - Set my custom profile picture for this server

**Footer Text**: Next: Bot Settings

---

### **EMBED 4** (sendStandardEmbed) - Bot Config

**Embed Title**: Advanced Settings 🔧

**Embed Description**:

## 🔧 Bot Configuration (`/config`)
Personal bot settings:

**AI Settings:**
- `/config model` - Choose which AI model to use
- `/config temperature` - Adjust creativity/randomness. The higher, the more varied the responses (1.0-2.0)
- `/config humanizer` - Change how humanlike my responses should be

**API Keys:**
- `/config apikey set` - Set your AI provider API key
- `/config apikey delete` - Remove your API key
- `/config braveapi set` - Set Brave Search API key (optional)
- `/config braveapi delete` - Remove Brave Search API key

**Personalization:**
- `/config rename` - Change what I refer to myself as
- `/config timezone` - Set timezone for time-aware responses and reminders
- `/config permissions` - Configure what I'm allowed to do

### **EMBED 5** (sendStandardEmbed) - Pro Tips

**Embed Title**: Pro Tips 💡

**Embed Description**:
- Start with a persona (default or generated) as a foundation
- Use `/teach attribute` for quick personality tweaks
- For Sample Dialogues, using examples that exhibit their attributes and traits as well is effective:
```
User message: {user}: What's your favorite hobby?
Bot response: {bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```
- Test changes by chatting, iterate until it feels right
- Export your persona to back it up or share with other servers!

---

## Notes for Implementation

**Embed Colors** (suggestion):
- `/help features` - Blue/Info color (informational)
- `/help setup` - Green/Success color (getting started/welcoming)
- `/help apikey` - Blue/Info color (instructional)
- `/help memory` - Purple/Neutral color (feature explanation)
- `/help customization` - Purple/Neutral color (feature explanation) - **4 embeds total**
- `/help data` - Blue/Info color (informational with privacy focus)

**Command Structure**:
- All commands should use `replyInfoEmbed` utility
- `/help apikey` needs a required string choice option for provider: `brave`, `google`, `novelai`, `openrouter`
- Keep embeds concise but informative
- Use emojis sparingly but effectively for visual scanning

**Command Summary** (6 total help commands):
1. `/help features` - What TomoriBot can do
2. `/help setup` - First-time configuration guide
3. `/help apikey <provider>` - Provider-specific API key setup (4 providers: Brave, Google, NovelAI, OpenRouter)
4. `/help memory` - Memory system (personal/server memories)
5. `/help customization` - Comprehensive personality & behavior customization guide
6. `/help data` - Data management and privacy policy

**Special Notes for `/help customization`:**
- **Split into 5 consecutive embeds** to avoid Discord size limits:
  1. **replyInfoEmbed**: Overview + Personality Personas (`/persona` commands)
  2. **sendStandardEmbed**: Teaching System (`/teach` non-memory, placeholder documentation)
  3. **sendStandardEmbed**: Configuration & Management (`/forget` non-memory, `/server`)
  4. **sendStandardEmbed**: Advanced Settings (`/config`)
- Includes detailed placeholder documentation (`{user}` and `{bot}`) with code examples
- **Clear distinction** from `/help memory`: customization = behavior, memory = facts
- Cross-references `/help memory` multiple times to reinforce the distinction
  5. **sendStandardEmbed**: Pro Tips

**Special Notes for `/help memory`:**
- Emphasizes "facts and information" vs "behavior and personality"
- Updated command examples to use subcommand groups (`/teach memory personal`, `/forget memory server`)
- Better examples showing the type of information stored
- Cross-references `/help customization` in footer
