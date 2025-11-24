# TomoriBot Privacy Policy
Last updated: 2025-11-24

This Privacy Policy explains how the official hosted TomoriBot instance handles data. If you self-host TomoriBot from this repository, you control your own data pipeline; this document is a reference template and does not govern your self-hosted deployment. The codebase is licensed under AGPLv3 (`LICENSE`).

## 1) What We Collect
- **Discord identifiers and preferences:** User IDs, server IDs, nicknames, language/locale preferences, and privacy opt-out status to route commands and localize responses.
- **Server configuration and persona data:** TomoriBot nicknames, persona attributes, sample dialogues, trigger words, LLM/provider selections, timezone offsets, and feature toggles stored per server.
- **Memories and content you provide:** Personal memories, server memories, and persona/attribute/dialogue text you submit via commands. These may reference Discord users and message content you supply.
- **Reminders:** Reminder text, target user/channel, scheduled time, recurrence settings, and timezone information stored when you create reminders via bot commands.
- **Attachments and server assets:** Images you upload for persona avatars or metadata embedding. Server emoji and sticker metadata (names, IDs, image URLs) may be sent to AI providers as conversation context when enabled.
- **API keys (optional):** Provider keys (e.g., AI or search) you choose to store. Keys are encrypted at rest using the configured `CRYPTO_SECRET` and stored with a key version for rotation.
- **Operational logs:** Error logs containing interaction IDs, user/server IDs, command names, error types, and stack traces for debugging. No message content or personal conversations are logged except when explicitly included in error metadata (e.g., failed tool calls). Routine successful operations are not logged.
- **Ephemeral processing:** Recent Discord messages and attachments may be read in-memory to build context for replies, safety checks, search queries, or tool calls. We do not persist this contextual data unless you explicitly save it (e.g., teaching a memory or persona).

## 2) How We Use Data
- Operate and improve bot functionality, including localization, persona rendering, safety checks, and permission gating.
- Store and recall memories/persona data to keep conversations contextual.
- Send your prompts, relevant context, and optional attachments to the AI/search providers you select so they can generate responses.
- Provide reminders, exports, imports, and server management tools.
- Detect and mitigate abuse, errors, and service stability issues.

## 3) Third-Party Disclosure
- **AI and model providers:** Content you send (including prompts, persona data, sample dialogues, relevant context, and optional media) may be transmitted to providers you configure, such as Anthropic, Google Gemini, OpenAI/OpenRouter, or NovelAI. Their terms, privacy policies, safety filters, and retention rules apply.
- **Search providers:** If enabled, search queries and relevant context may be sent to the configured provider (e.g., Brave Search). Their policies apply.
- We do not sell personal data. Sharing occurs only as necessary to operate the features you invoke or to comply with law.

## 4) Your Choices and Controls
- **Opt out of personal memories:** Use `/personal privacy` to stop saving personal memories about you across servers. Other server-level data (e.g., persona, server memories) may still exist if maintained by admins.
- **Export data:** Use `/data export` to retrieve personal or server data (Manage Server permission required for server exports) and `/data export personality` for persona text.
- **Delete data:** Use `/data delete personal` to remove your user record (cascades related personal data) or `/data delete server` (Manage Server permission required) to remove a server's TomoriBot data.
- **Server governance:** Server admins can disable features such as sample dialogue teaching, personal memories, web search, or other permissions using configuration commands.

## 5) Retention
- Stored data (memories, persona, reminders, server configuration, and encrypted keys) persists until removed through the commands above or when the bot is removed from a server.
- When TomoriBot is removed from a server, server data may be retained for up to 90 days to allow for re-invitation, after which it will be automatically purged.
- User data persists across servers until explicitly deleted via `/data delete personal`.
- Error logs are kept for operational stability and may be rotated periodically.
- Transient context built from recent Discord messages is kept in memory only for the duration of request processing unless you explicitly save it.

## 6) Security
- Provider API keys are encrypted at rest using the active `CRYPTO_SECRET` key version, with support for rotation.
- The database is restricted to the bot's runtime and operators with server access. No method is perfectly secure; do not submit highly sensitive or regulated data.

## 7) Children's Data
- TomoriBot is intended for users 13+ (or the local minimum age for Discord). We do not knowingly collect data from younger users.

## 8) Changes
- We may update this Privacy Policy; the "Last updated" date will change accordingly. Continued use after updates means you accept the revisions.

## 9) Contact
- For hosted-instance privacy questions or requests beyond the commands above, contact us through the project GitHub issues or the support Discord linked in the `/support discord` command.

## 10) International Users and GDPR
- TomoriBot's hosted service operates globally with data stored according to the hosting provider's infrastructure.
- For users in the European Economic Area (EEA), UK, or Switzerland: You have additional rights under the General Data Protection Regulation (GDPR), including the right to access, rectify, erase, restrict processing, data portability, and to object to processing of your personal data.
- The data controls described in Section 4 fulfill most GDPR rights (export, deletion, opt-out). For additional requests, contact us via the methods in Section 9.
- Legal basis for processing: Legitimate interest (bot functionality), Contract (service provision), and Consent (optional features like memories and reminders).
