---
title: "02.4: Server Emojis"
aiGenerated: true
---

Server emojis list the custom emojis available in the guild, augmented with optional emotion keys and descriptive metadata.

## Flow and ownership

The contributor `buildServerEmojiContextItem` in `src/utils/text/context/serverAssets.ts` emits a `system`-role context item tagged `KNOWLEDGE_SERVER_EMOJIS`:

1. Omit the emoji list in DMs or when emoji usage is disabled, persona state is missing, or the guild has no usable cached emojis.
2. Use `preloadedEmojis` from turn asset loading or query `serverRepository.loadEmojis(serverId)`. For shared names, choose the richest metadata from rows that Discord has not marked unavailable. Break ties by the most recent update timestamp.
3. **Ordering and formatting**: Emojis are sorted by `createdTimestamp` ascending. Each entry formats as `:name:` or `:name: (Expresses <emotion>; <description>)`.
4. **Usage instructions**: Appends guidance instructing the model to write `:name:` without numeric Discord IDs. In impersonation mode, the wording simplifies to generic instructions.

The assembled text passes through `convertMentions` before emission.

## Constraints and rationale

- **Name deduplication**: Each emoji name appears at most once in the prompt so the LLM is not presented with duplicate choices.
- Discord can mark an emoji unavailable after a server loses boosts. The prompt and shortcode resolver use availability flags from `GUILD_EMOJIS_UPDATE` and `GUILD_UPDATE`. `GUILD_CREATE` refreshes those flags when Discord sends guild state after an outage or reconnect. The emoji returns with its saved description when Discord makes it available again.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_EMOJIS`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/serverAssets.ts`: `buildServerEmojiContextItem`.
- `src/utils/db/repositories/ServerRepository.ts`: `loadEmojis`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
- [05: Server Stickers](/architecture/pipelines/context-build/02-native-assembly/05-server-stickers/): companion asset contributor.
