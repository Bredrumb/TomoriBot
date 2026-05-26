# 6. Event System

TomoriBot routes Discord events through one dispatcher: `src/handlers/eventHandler.ts`.

## Dispatcher Model

- `eventFolderMap` maps Discord event names -> folder names under `src/events/`.
- Direct `.ts` files in the mapped folder are eagerly imported at startup, cached by Discord event name, and executed in lexical order.
- Multiple Discord events can map to one folder (emoji/sticker fan-in).

## Current Event Folders

- `clientReady`
- `guildCreate`
- `guildEmojisUpdate`
- `guildMemberAdd`
- `guildStickersUpdate`
- `interactionCreate`
- `messageCreate`
- `rateLimit`

## Current Important Mappings

- `messageCreate` -> `messageCreate`
- `interactionCreate` -> `interactionCreate`
- `clientReady` -> `clientReady`
- `guildCreate` -> `guildCreate`
- `guildMemberAdd` -> `guildMemberAdd`
- `emojiCreate`/`emojiDelete`/`emojiUpdate` -> `guildEmojisUpdate`
- `stickerCreate`/`stickerDelete`/`stickerUpdate` -> `guildStickersUpdate`
- `rateLimit` -> `rateLimit`

`voiceStateUpdate` and `presenceUpdate` are also mapped by the dispatcher, but no active handler folders are currently present, so those mappings no-op.

## Typical Flows

### Message event

`messageCreate` -> `events/messageCreate/tomoriChat.ts` -> `utils/chat/invocation.ts` -> `utils/chat/admission.ts` -> `utils/chat/channelQueue.ts` -> turn planning/context/response/generation/post-turn stages under `utils/chat/`.

The dispatcher shallow-scans direct `.ts` files under `src/events/messageCreate/`, so helper modules for chat orchestration must not live beside `tomoriChat.ts`. Subfolders under `src/events/<eventName>/` are not scanned. Chat-specific helpers belong under `src/utils/chat/`; invocation normalization lives in `src/utils/chat/invocation.ts`, reply/no-reply admission lives in `src/utils/chat/admission.ts`, channel locks/queues live in `src/utils/chat/channelQueue.ts`, trigger/reply/persona-routing decisions live in `src/utils/chat/triggerProcessor.ts`, webhook/embed emission helpers live in `src/utils/chat/responseEmitter.ts`, and chat-only utility helpers live under `src/utils/chat/helpers/`.

Current message preprocessing enriches fetched history before `buildContext()`:
- reply-reference system annotations (opaque `ref_N` handle + full quoted content)
- forwarded-message snapshot annotations (forwarder + original author + source channel + quoted content)
- media extraction and opaque `media_N` source-message handles for message-targeted tools
- forwarded/referenced media extraction so image/video attachments from quoted snapshots reach multimodal models
- consecutive same-author messages only collapse when both sides are pure text; any turn with media stays separate so media references remain message-local
- reaction context annotations (emoji/counts plus budgeted reactor identity fetches with counts-only fallback)

### Slash command event

`interactionCreate` -> `events/interactionCreate/handleCommands.ts` -> command lookup and execution.

### Ready event

`clientReady` handlers run startup tasks such as command registration and MCP registration.

### Member join event

`guildMemberAdd` -> `events/guildMemberAdd/newUser.ts`

- registers the joining Discord user in the database
- optionally triggers a configured welcome message in the server's welcome channel
- welcome greetings reuse the normal chat coordinator manual-trigger pipeline, including persona selection, queueing, and mention fallback checks

## Adding a New Event Handler

1. Create `src/events/{folderName}/`.
2. Add a default-export handler file.
3. Add/update mapping in `eventFolderMap`.
4. Restart and verify logs.
