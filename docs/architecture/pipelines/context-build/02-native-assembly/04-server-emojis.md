---
title: "02.4: Server Emojis"
---

List of the server's custom emojis with metadata, framed for LLM use.

**File:** `src/utils/text/context/serverAssets.ts:31-126`

## Mission

Emit one context item describing every server-custom emoji available, with
optional emotion-key and description metadata. Format each emoji as
`:name:` or `:name: (Expresses emotion; description)` so the LLM can use
them naturally in replies via raw `:name:` syntax (Discord auto-resolves
when the emoji exists in the active server).

## Input

- `client`, `guildId`, `serverName`, `botName`
- `isDMChannel`, `isUserImpersonation`
- `tomoriConfig.emoji_usage_enabled`,
  `tomoriConfig.personal_memories_enabled`
- `tomoriState` (provides `server_id`)
- `preloadedEmojis` — emoji metadata pre-loaded by the chat pipeline's
  `loadPersonaAssets`; falls back to `serverRepository.loadEmojis` if not
  provided
- `snapshot`, `convertMentions`

## Output

`Promise<StructuredContextItem | null>` — `null` if any precondition fails,
otherwise one `system`-role item tagged `KNOWLEDGE_SERVER_EMOJIS`.

Content shape:

```
## {serverName}'s Emojis
- :name1:
- :name2: (Expresses happy; "celebration vibe")
- :name3: (Expresses sad)

To use {serverName}'s emojis, just write :name: (name only, no IDs). Names are
case-insensitive, and {bot} will expand them to the correct custom emoji.
```

## Side effects

- **Discord cache read** — `client.guilds.cache.get(guildId).emojis.cache`
  for the live emoji list.
- **DB read (conditional)** — falls back to
  `serverRepository.loadEmojis(server_id)` when `preloadedEmojis` is empty.
- **Metadata dedup** — when Discord has multiple emojis with the same
  name, picks the one with richer metadata (emotion key or description),
  then the one with the most recent timestamp.
- **Sort stability** — emojis are sorted by `createdTimestamp` ascending,
  so the LLM sees them in creation order.
- **Mention conversion** — final assembled text passes through
  `convertMentions`.

## Invariants

After this stage runs:

- Returns `null` if: DM channel, `emoji_usage_enabled === false`,
  `tomoriState === null`, or the guild emoji cache is empty.
- Each emoji name appears at most once in the output even if Discord has
  duplicates (deduped by `latestEmojiByName`).
- The closing usage instruction adapts to impersonation mode (simplified
  phrasing).

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `emoji_usage_enabled` | Master switch; `false` returns `null` |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `EmojiMetadata` shape | Defined in `serverAssets.ts:8-18`; tightly coupled to the `server_emojis` table schema. A plugin adding emoji-source kinds would extend the metadata-load path. |
| Sister contributor: stickers (stage 05) | Stickers share the metadata + dedup logic pattern. Future "GIF library" or "voice clip library" contributors would mirror this shape. |
| Emoji-metadata enrichment (emotion key, description) | The `/refresh` and `/emoji` commands populate this; the contributor only formats. New enrichment kinds would extend the DB schema + the formatter here. |

**A plugin adding a new server-asset kind** (e.g. custom GIF reactions)
would add a new contributor with its own tag, parallel to this one — see
the native-assembly README's extension-point discussion for the
"new contributor" question.

## Related docs

- Sticker contributor: [`05-server-stickers.md`](./05-server-stickers)
- Emoji metadata sources: → no dedicated doc; the `/refresh` command
  and `refreshEmojis` event handler populate it
- Persona asset pre-loading (chat pipeline):
  [`buildChatTurnContext`](../../chat/06-per-turn/01-build-context)
