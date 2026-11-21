---
title: "Built-in tools"
sidebar:
  order: 0
---

Tools depend on the active provider and model supporting tool calling. Many are gated behind
a feature flag (`/config` > Permissions), a Discord permission, a model capability, or an
optional API key.

:::tip
If a capability seems unavailable, ask her why. She can report the server's feature flags and
whether the active model supports tool calling, which usually names the setting to fix.
:::

| Tool | Prompt macro | Requires | What it does |
|---|---|---|---|
| Review capabilities | `{capabilities_tool}` | - | Check current chat abilities, commands, or settings before answering. |
| Create / update long-term memory | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Save or replace a stable server fact or user preference. |
| Update short-term memory | `{short_term_memory_tool}` | - | Save temporary working memory for the current channel or story arc. |
| Create / update task | `{task_tool}` / `{task_update_tool}` | - | Schedule or edit reminders and self-tasks (see [Scheduled Tasks](/features/capabilities/scheduled-tasks/)). |
| Cross-channel message | `{cross_channel_tool}` | - | Act in another channel or thread, with an optional report-back. |
| Create thread | `{create_thread_tool}` | `thread_creation_enabled` + thread perms | Open a public thread and post its starter message. |
| Roll dice | - | `dice_rolling_enabled` | Roll dice publicly and use the returned result in roleplay. |
| Select sticker | `{sticker_tool}` | `sticker_usage_enabled` | Add a matching server sticker or custom expression to a reply. |
| Manage message | `{manage_message_tool}` | `manage_message_enabled` | Pin, edit, or delete recent messages (pin needs `Manage Messages`). |
| Block / unblock user | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Persona-scoped mute/block of a user (does not touch memories). |
| Interact with recent message | `{message_interaction_tool}` | - | React to or send a short reply to a recent message. |
| Peek profile picture | `{profile_picture_tool}` | vision model or `vision_llm` | Inspect a user's or the persona's avatar. |
| Read document | `{document_tool}` | - | Extract text from a PDF or any UTF-8 text file: source code (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt`, and any non-binary attachment. |
| Reveal message metadata | `{message_metadata_tool}` | - | Annotate recent turns with handles and timestamps for precise targeting. |
| Process YouTube video | `{youtube_tool}` | model with video support | Analyze a specific YouTube link on demand. |
| Analyze image | `{image_analysis_tool}` | configured `vision_llm` | Delegate image understanding to a separate vision model. |
| Generate image / anime image | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + capable provider | Generate or edit images (see [Media Generation](/features/capabilities/media-generation/image-generation/)). |
| Danbooru tag lookup | `{tag_search_tool}` | `danbooru_enabled` | Turn character names, nicknames, and tag guesses into exact Danbooru tags (see [Danbooru Tag Lookup](/features/capabilities/tools-and-extensions/danbooru/)). |
| Danbooru art search | `{booru_post_search_tool}` | `danbooru_enabled` | Post up to 4 existing Danbooru images for 1 or 2 tags (see [Art Search and Post Reading](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)). |
| Danbooru post read | - | `danbooru_enabled` | Read the grouped tags of one Danbooru post from its ID or link. |
| Generate voice message | `{voice_message_tool}` | ElevenLabs key + persona voice + `voice_message_enabled` | Send a spoken Discord voice reply. |

### Conditional prompt blocks
<!-- anchor: conditional-prompt-blocks -->

Use [tool macros](/features/prompt-macros/#tool-macros) to insert function names into
saved instructions. Use [conditional blocks](/features/prompt-macros/#conditional-prompt-blocks)
to include those instructions only when a tool or capability is available.
