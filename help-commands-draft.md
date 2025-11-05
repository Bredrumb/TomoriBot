# TomoriBot Help Commands - Content Draft

This is a scratchpad for drafting the content of help commands before implementation.

---

## `/help features`
**Purpose**: Show users what TomoriBot can do (based on chatCapabilities.md)

**Embed Title**: What I Can Do! ✨

**Embed Description**:
Hi! I'm TomoriBot, your AI companion with some pretty cool abilities. Here's what I can do:

**Vision & Media** 👁️
- I can see and analyze images, videos, stickers, and emojis you share
- Never hesitate to share visual content with me!

**Search & Information** 🔍
- Web search for current information via Brave Search
- Image, video, and news search
- Fetch and read content from URLs you share

**Memory & Personalization** 🧠
- I remember personal facts about you and server-wide information
- My memories persist across conversations
- Use `/teach` to help me remember things, `/forget` to forget
- Learn more with `/help memory`

**Personality & Expression** 💫
- I can switch between different personalities/presets
- I can send emojis and stickers to express myself
- My behavior and tone can be customized
- Learn more with `/help customization`

**Helpful Tools** 🛠️
- Pin important messages (reply to a message and mention it!)
- Set up reminders for you
- Look at Discord profile pictures
- Multi-language support

**Footer Text**: Want to get started? Try `/help setup` • Need an API key? Try `/help apikey`

---

## `/help setup`
**Purpose**: Guide new users through first-time server configuration

**Embed Title**: Getting Started with TomoriBot 🚀

**Embed Description**:
Welcome! Here's how to set up TomoriBot in your server:

**Step 1: Get an API Key** 🔑
TomoriBot uses AI providers like Google Gemini, NovelAI, or OpenRouter. You'll need an API key from one of them.
- Use `/help apikey` to learn how to get one

**Step 2: Configure Your API Key** ⚙️
- Use `/apikey set` to securely add your API key
- Your key is encrypted and stored safely
- Each server has its own configuration

**Step 3: Start Chatting!** 💬
- Just mention me or reply to my messages to chat
- I'll remember our conversations with my memory system
- Teach me things with `/teach` so I remember them

**Optional: Customize Me** 🎨
- Use `/preset` commands to change my personality
- Configure server settings with `/server` commands
- Set up autochannel with `/server autochchannels` to chat without mentioning me

**Need Help?**
- `/help features` - See what I can do
- `/help memory` - Learn about my memory system
- `/help customization` - Learn about personality customization

**Footer Text**: Questions? Just ask me directly - I'm here to help!

---

## `/help data`
**Purpose**: Explain data management (export, import, delete) and privacy policy

**Embed Title**: Managing Your Data 🗂️

**Embed Description**:
TomoriBot gives you complete control over your data. Here's what you can do:

**Export Your Data** 📤
Use `/data export` to download your data:
- **Personal data**: Your memories, preferences, and user settings
- **Server data**: Server memories, configurations, and bot settings
- **Personality data**: Custom personality presets you've created
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
- **Server deletion**: Removes all server data (requires Manage Server permission)
- Requires confirmation to prevent accidental deletion
- This action cannot be undone!

**Privacy Notice** 🔒
**What TomoriBot Stores:**
- ✅ Memories you teach me with `/teach`
- ✅ Your preferences and settings
- ✅ Server configurations
- ✅ Encrypted API keys

**What TomoriBot Does NOT Store:**
- ❌ Your Discord messages (except when explicitly taught as memories)
- ❌ Message content from conversations
- ❌ Chat history

**Important**: Your chosen AI provider (Google, NovelAI, OpenRouter) processes your messages according to their own privacy policies. Never share personal information in conversations if you're concerned about privacy.

**Footer Text**: Questions about data? Use `/data export` to see exactly what's stored • Need help? Try `/help setup`

---

## `/help apikey`
**Purpose**: Provider-specific instructions for getting and setting up API keys

### Option: `brave` (Brave Search - Optional)

**Embed Title**: Setting Up Brave Search API Key 🔍

**Embed Description**:
**Note**: Brave Search is optional and only enhances my search capabilities. It does NOT power my AI - that's handled by your main provider (Google, NovelAI, or OpenRouter).

**What Brave Search Does:**
- Enables web, image, video, and news search
- Provides real-time information from the internet
- Enhances my ability to answer current questions

**Getting Your API Key:**
1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Navigate to your API Keys section
4. Create a new API key
5. Copy your API key

**Free Tier Includes:**
- 2,000 queries per month
- No credit card required
- All search types available

**Setting Up in TomoriBot:**
Use the command:
```
/apikey set provider:Brave key:YOUR_API_KEY_HERE
```

**Important Notes:**
- Your API key is encrypted and stored securely
- This is separate from your main LLM provider
- Without Brave API key, I can still function but won't have search capabilities

**Footer Text**: Want to set up your main AI provider? Check the other `/help apikey` options!

---

### Option: `google` (Google Gemini)

**Embed Title**: Setting Up Google Gemini API Key 🔑

**Embed Description**:
Google Gemini offers free and paid tiers with powerful AI models.

**Getting Your API Key:**
1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click "Get API Key" or "Create API Key"
4. Copy your API key

**Setting Up in TomoriBot:**
Use the command:
```
/apikey set provider:Google key:YOUR_API_KEY_HERE
```

**Important Notes:**
- Your API key is encrypted and stored securely
- Free tier available with generous limits
- Supports vision, search, and all TomoriBot features

**Models Available:**
- Gemini 2.0 Flash (Experimental, Thinking Mode)
- Gemini 1.5 Flash/Pro

**Footer Text**: Key set up? Start chatting by mentioning me!

---

### Option: `novelai` (NovelAI)

**Embed Title**: Setting Up NovelAI API Key 🔑

**Embed Description**:
NovelAI is a subscription-based service focused on creative storytelling and roleplay.

**Getting Your API Key:**
1. Visit [NovelAI](https://novelai.net/)
2. Subscribe to a paid tier (Tablet, Scroll, or Opus)
3. Go to your Account Settings
4. Navigate to the API section
5. Generate or copy your API key

**Setting Up in TomoriBot:**
Use the command:
```
/apikey set provider:NovelAI key:YOUR_API_KEY_HERE
```

**Important Notes:**
- Your API key is encrypted and stored securely
- Requires active NovelAI subscription
- Great for creative and roleplay conversations

**Subscription Tiers:**
- **Tablet**: $10/month - Access to Kayra model
- **Scroll**: $15/month - Access to Kayra + Clio models
- **Opus**: $25/month - All models + higher limits

**Footer Text**: Key set up? Start chatting by mentioning me!

---

### Option: `openrouter` (OpenRouter)

**Embed Title**: Setting Up OpenRouter API Key 🔑

**Embed Description**:
OpenRouter provides access to multiple AI models from different providers through one API.

**Getting Your API Key:**
1. Visit [OpenRouter](https://openrouter.ai/)
2. Sign up for an account
3. Go to your [API Keys page](https://openrouter.ai/keys)
4. Create a new API key
5. Add credits to your account (pay-as-you-go)

**Setting Up in TomoriBot:**
Use the command:
```
/apikey set provider:OpenRouter key:YOUR_API_KEY_HERE
```

**Important Notes:**
- Your API key is encrypted and stored securely
- Pay-as-you-go pricing - only pay for what you use
- Access to many models: GPT-4, Claude, Gemini, and more

**Why OpenRouter?**
- Try different AI models without multiple subscriptions
- Competitive pricing
- Easy model switching

**Footer Text**: Key set up? Start chatting by mentioning me!

---

## `/help memory`
**Purpose**: Explain the teach/forget memory system

**Embed Title**: How My Memory Works 🧠

**Embed Description**:
I have a persistent memory system that helps me remember **facts and information** about users and servers across conversations!

**Note**: This is about **what I know** (facts, context, information). For **how I behave** (personality, tone, settings), see `/help customization` instead!

**Teaching Me Things** 📝
Use `/teach` to help me remember **facts and information**:
- **Personal memories** (`/teach personalmemory`): Facts about individual users
  - Example: "Alex loves cats", "Prefers dark mode", "Is allergic to peanuts"
- **Server memories** (`/teach servermemory`): Information relevant to the whole server
  - Example: "Game night is every Friday at 8 PM", "Server motto is 'Stay positive!'", "We use #general for announcements"

**Forgetting Things** 🗑️
Use `/forget` to make me forget memories:
- **`/forget personalmemory`** - Remove personal facts about users
- **`/forget servermemory`** - Remove server-wide information
- View all memories first, then delete specific ones by their ID

**How It Works:**
- **Personal memories** are tied to you specifically across all servers
- **Server memories** are shared by everyone in the server
- I automatically recall relevant memories during conversations
- Memories persist forever until you forget them

**Memory Tips:**
- Teach me your preferences, nicknames, and important facts
- Use server memories for shared information, inside jokes, or server culture
- Review your memories periodically with `/forget list`
- Keep memories concise and clear for best results

**Footer Text**: Pro tip: The more you teach me, the more personalized our conversations become! • Want to change my personality? Try `/help customization`

---

## `/help customization`
**Purpose**: Comprehensive guide to customizing TomoriBot's behavior and personality

**💡 KEY DISTINCTION:**
- **`/help customization`** = How TomoriBot **behaves** (personality, tone, settings)
- **`/help memory`** = What TomoriBot **knows** (facts, information, context)

---

### **EMBED 1** (replyInfoEmbed) - Overview + Presets

**Embed Title**: Customizing TomoriBot 🎨

**Embed Description**:
TomoriBot is highly customizable! Here's everything you can configure to make me truly yours.

**Note**: This is about **how I behave** (personality, tone, settings). For **what I remember** (facts, memories), see `/help memory` instead!

## 🎭 Personality Presets
Control my core personality and behavior:

**Preset Commands** (`/preset`):
- `/preset create` - Create a custom personality from scratch
- `/preset generate` - AI-generate a personality based on your description
- `/preset default` - Switch to default personality
- `/preset export` - Export your preset to share or backup
- `/preset import` - Import a preset from a file

**What Presets Include:**
- Personality attributes (traits, characteristics)
- Sample dialogues (example conversations I learn from)
- Custom avatar for that personality
- Behavior and tone settings

**Footer Text**: Presets are the foundation of my personality! • Next: Teaching Commands

---

### **EMBED 2** (sendStandardEmbed) - Teaching System

**Embed Title**: Teaching Commands ✍️

**Embed Description**:

## ✍️ Teaching Commands (`/teach`)
Fine-tune my personality and knowledge:

**Personality Shaping:**
- `/teach attribute` - Add personality traits (e.g., "friendly", "sarcastic", "formal")
- `/teach sampledialogue` - Add example conversations to shape how I talk
- `/teach nickname` - Set what I should call myself

**Writing Sample Dialogues:**
Use `{user}` and `{bot}` placeholders in your examples:
- `{user}` = Replaced with the actual user's name/nickname
- `{bot}` = Replaced with my current nickname

**Example:**
```
User message: {user}: Hey, how are you?
Bot response: {bot}: I'm doing great! Thanks for asking!
```

**Tips for Great Sample Dialogues:**
- Write natural, conversational exchanges
- Include personality traits you want me to exhibit
- Show don't tell - demonstrate the tone you want
- Add variety - different situations help me learn better
- Use placeholders so dialogues work for everyone

**Footer Text**: Sample dialogues are powerful for shaping personality! • Next: Configuration

---

### **EMBED 3** (sendStandardEmbed) - Unlearning + Server Config

**Embed Title**: Configuration & Management ⚙️

**Embed Description**:

## 🗑️ Unlearning Commands (`/forget`)
Remove personality customizations:

- `/forget attribute` - Remove specific personality attributes
- `/forget sampledialogue` - Remove sample dialogue examples
- `/forget nickname` - Reset my nickname to default

---

## ⚙️ Server Configuration (`/server`)
Server-wide settings and behavior:

**Learning & Privacy:**
- `/server memberpermissions` - Control who can teach me things
- `/server blacklist` - Prevent me from learning from specific users

**Channel Behavior:**
- `/server autochchannels` - Set channels where I respond without mentions
- `/server autochthreshold` - Set message threshold for auto-responses

**Triggers & Appearance:**
- `/server triggeradd` - Add custom trigger words I respond to
- `/server triggerdelete` - Remove trigger words
- `/server avatar` - Set a custom avatar for this server

**Footer Text**: Server config controls behavior across the server! • Next: Bot Settings

---

### **EMBED 4** (sendStandardEmbed) - Bot Config + Self-Learning + Tips

**Embed Title**: Advanced Settings 🔧

**Embed Description**:

## 🔧 Bot Configuration (`/config`)
Personal bot settings:

**AI Settings:**
- `/config model` - Choose which AI model to use
- `/config temperature` - Adjust creativity/randomness (0.0-2.0)
- `/config humanizerdegree` - Control response length (concise/normal/detailed)

**Personalization:**
- `/config rename` - Change what you want to call me
- `/config language` - Change my response language
- `/config timezone` - Set timezone for time-aware responses
- `/config permissions` - Configure what I'm allowed to do

---

## 📚 Memory Self-Learning
Control how I learn from interactions:

**Member Teaching Permissions** (`/server memberpermissions`):
- Enable/disable attribute teaching by members
- Enable/disable sample dialogue teaching by members
- Admins can always teach regardless of settings

**Blacklist System** (`/server blacklist`):
- Prevent me from learning from specific users
- Useful for preventing spam or unwanted influence
- Blacklisted users can still chat, but I won't learn from them

**Note:** This controls **personality learning**, not memories! For managing **facts and information** I remember, see `/help memory` instead!

---

## 💡 Pro Tips
- Start with a preset (default or generated) as a foundation
- Use `/teach attribute` for quick personality tweaks
- Sample dialogues are powerful - use them for complex behaviors
- Test changes by chatting - iterate until it feels right
- Export your preset to back it up or share with other servers!

**Footer Text**: Ready to create? Start with `/preset generate` for AI assistance! • Learn more: `/help memory`

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
- This is a LARGE embed with multiple sections (may need to be split or paginated if Discord has size limits)
- Covers: `/preset`, `/teach` (non-memory), `/forget` (non-memory), `/server` (blacklist, memberpermissions), `/config` (excluding API keys)
- Includes detailed placeholder documentation (`{user}` and `{bot}`)
- Cross-references `/help memory` for memory-related commands
