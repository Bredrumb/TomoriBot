---
title: "Adding an Event Handler"
---

This guide walks through adding a new Discord event handler in TomoriBot.

## Steps

1. Create a folder under `src/events/{folderName}` if one does not already exist for the event type.

2. Add the handler file with a default export function. The function signature should match the Discord.js event payload for the target event.

3. Map the Discord event name to the folder in `src/handlers/eventHandler.ts` inside `eventFolderMap`.

4. Restart the dev server and verify the event fires in logs.

## Quality Gate

```bash
bun run check    # TypeScript strict mode
bun run lint     # Biome formatting
```

Then trigger the event in Discord (join a server, send a message, etc.) and confirm the handler runs without errors.

## Related Docs

- [`docs/en/architecture/subsystems/event-system.md`](../subsystems/event-system) — event registration pattern, handler conventions
