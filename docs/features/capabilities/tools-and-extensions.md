---
title: "Tools & Extensions"
sidebar:
  order: 1
---

TomoriBot is agentic: beyond chatting, she can call **tools** to search the web, read
documents, generate media, set reminders, act in other channels, and more. She decides when
to use them based on the conversation. This page covers the built-in tools, how to extend
her with MCP servers, and how to keep tool declarations lean with Deliberate Tool Mode.

## Built-In Tools

Tools depend on the active provider/model supporting tool calling, and many are gated behind
a feature flag (a `/capabilities` toggle), a Discord permission, a model capability, or
an optional API key.

| Tool | Prompt macro | Requires | What it does |
|---|---|---|---|
| Review capabilities | `{capabilities_tool}` | — | Check current chat abilities, commands, or settings before answering. |
| Create / update long-term memory | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Save or replace a stable server fact or user preference. |
| Update short-term memory | `{short_term_memory_tool}` | — (not on NovelAI) | Save temporary working memory for the current channel/story arc. |
| Create / update task | `{task_tool}` / `{task_update_tool}` | — | Schedule or edit reminders and self-tasks (see [Scheduled Tasks](/features/capabilities/scheduled-tasks/)). |
| Cross-channel message | `{cross_channel_tool}` | — (not on NovelAI) | Act in another channel/thread, with an optional report-back. |
| Create thread | `{create_thread_tool}` | `thread_creation_enabled` + thread perms | Open a public thread and post its starter message. |
| Select sticker | `{sticker_tool}` | `sticker_usage_enabled` | Add a matching server sticker to a reply. |
| Manage message | `{manage_message_tool}` | `manage_message_enabled` | Pin, edit, or delete recent messages (pin needs `Manage Messages`). |
| Block / unblock user | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Persona-scoped mute/block of a user (does not touch memories). |
| Interact with recent message | `{message_interaction_tool}` | — | React to or send a short reply to a recent message. |
| Peek profile picture | `{profile_picture_tool}` | vision model or `vision_llm` | Inspect a user's or the persona's avatar. |
| Read document | `{document_tool}` | — | Extract text from a PDF or **any** UTF-8 text file — source code (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt`, and any non-binary attachment. |
| Reveal message metadata | `{message_metadata_tool}` | — | Annotate recent turns with handles/timestamps for precise targeting. |
| Increase media context | `{media_context_tool}` | vision model | Pull older windowed-out images/videos back into context. |
| Process YouTube video | `{youtube_tool}` | model with video support | Analyze a specific YouTube link on demand. |
| Analyze image | `{image_analysis_tool}` | configured `vision_llm` | Delegate image understanding to a separate vision model. |
| Generate image / anime image | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + capable provider | Generate or edit images (see [Media Generation](/features/capabilities/media-generation/)). |
| Generate voice message | `{voice_message_tool}` | ElevenLabs key + persona voice + `voice_message_enabled` | Send a spoken Discord voice reply. |

:::note[For prompt authors]
When customizing her system prompt or persona instructions, reference tools by their **prompt
macros** from the table above rather than hardcoding tool names — the macros expand to the
correct names at context-assembly time and degrade gracefully when a tool isn't available.
`{pin_tool}` and `{timestamp_refresh_tool}` still work as compatibility aliases for
`{manage_message_tool}` and `{message_metadata_tool}`. The web search and URL tools below
have macros too: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`,
`{news_search_tool}`, `{url_fetch_tool}`, and `{url_metadata_tool}` — these resolve
dynamically to the best available engine, including guild MCP replacements.
:::

## Web Search & URL Reading

The model sees a single unified `web_search(query, category)` tool. Behind it, a dispatcher
routes each call through an engine chain and returns the first success:

**Brave → SearXNG → DuckDuckGo → Felo**

- **Brave** runs first when a Brave API key is configured (set it with
  `/optional-key brave set`); it adds image, video, and news search. ⚠️ Set a $5 usage limit
  in the Brave dashboard to avoid surprise charges.
- **DuckDuckGo** is the default when no key is set, cascading to **Felo** on rate limits.
- **SearXNG** and **Crawl4AI** are optional self-hosted sidecars that unlock more categories
  and browser-rendered page fetches — see [Self-Hosting](/self-hosting/).

For reading a specific page, she uses `fetch_url`. It's unavailable on NovelAI.

## MCP Servers

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) servers extend her with
external tools you register yourself.

### Adding an Online MCP

Any publicly hosted MCP server with an HTTPS endpoint works. Using
[Smithery.ai](https://smithery.ai) as an example:

1. Create an account and generate an API key from your profile.
2. Open an MCP in the catalog and copy its **connection URL** (e.g. `https://youtube.run.tools`).
3. Run `/mcp add`, paste the connection URL into **URL**, and paste your Smithery key into
   **Auth Token**.

If a server needs no auth, leave **Auth Token** blank. Your auth token is encrypted at rest
and never shown again. Remove a server anytime with `/mcp remove`, which disconnects it
immediately and frees a slot.

### Local MCP Servers

Local MCP servers are **only supported on self-hosted instances** — the public hosted bot
requires HTTPS and blocks local/private addresses. If you run your own instance, see
[Setup: Local MCP Server](/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Only add MCP servers you trust]
A malicious MCP server can **prompt-inject** her with hidden instructions, **exfiltrate**
data users pass to its tools, or return **harmful/false results** she'll relay to your
server. Treat MCP servers like browser extensions — if in doubt, don't add it. Always review
an MCP's described tools before adding it.
:::

## Deliberate Tool Mode

Every declared tool adds to the prompt. **Deliberate Tool Mode** keeps tool declarations out
of ordinary chat turns unless the message looks like it actually needs a tool — this reduces
prompt size and helps smaller/local models answer faster.

- She first checks the message for **tool intent**. Built-in triggers cover common requests
  (reminders, web search, memory updates, cross-channel messages, image/video/voice
  generation, media analysis, thread creation, message actions). Follow-up wording works too,
  like "do that again but angrier" after a voice-message request.
- Server managers can add literal **custom trigger phrases** with `/server trigger add` — for
  example mapping `pic`, `img`, or `pfp` to image generation.

### Controls

- `/server dtm` — server managers toggle it.
- `/personal dtm` — users override it for themselves.
- With a thought-log channel configured (`/server thought-logs`), successful deliberate-mode
  tool calls are logged there along with the trigger that exposed the tool.

Deliberate Tool Mode only decides which tools are *shown* to the model — the model still has
to choose to call one. Run `/help deliberate-tool-mode` for the Discord summary.

:::note
**Deliberate Tool Mode** (this section) is unrelated to **Deliberate Trigger Mode**, which
controls how *she* is triggered — see
[Chatting & Triggers](/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Both are
abbreviated "DTM" in Discord.
:::
