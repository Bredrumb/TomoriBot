# Stage 05 — `buildServerStickerContextItem`

List of the server's custom stickers with metadata, framed for tool use.

**File:** `src/utils/text/context/serverAssets.ts:128-221`

## Mission

Emit one context item listing every server-custom sticker available, with
optional emotion-key and description metadata. Unlike emojis (which the LLM
can use inline via `:name:`), stickers must be emitted via the
`{sticker_tool}` function call — so the framing includes a tool-usage
instruction expanded via the tool-prompt macro resolver.

## Input

- `client`, `guildId`, `serverName`, `botName`
- `isDMChannel`, `isUserImpersonation`
- `tomoriConfig.sticker_usage_enabled`,
  `tomoriConfig.personal_memories_enabled`
- `tomoriState` (provides `server_id`)
- `preloadedStickers` — sticker metadata pre-loaded by the chat pipeline's
  `loadPersonaAssets`; falls back to
  `serverRepository.loadStickersByInternalId` if not provided
- `toolPromptMacroResolver`, `convertMentions`

## Output

`Promise<StructuredContextItem | null>` — `null` if any precondition fails,
otherwise one `system`-role item tagged `KNOWLEDGE_SERVER_STICKERS`.

Content shape:

```
## {serverName}'s Stickers
This server has the following stickers available for {botName} to use with the
'{sticker_tool}' function:
- "name1" (Expresses happy; "celebration mood")
- "name2"
- "name3" (Expresses sad)

To use a sticker, call '{sticker_tool}' with the sticker's name (case-insensitive).
```

The `{sticker_tool}` macros expand to the provider-correct function name
(e.g. `send_sticker_image` for OpenRouter, etc.).

## Side effects

- **Discord cache read** — `client.guilds.cache.get(guildId).stickers.cache`
  for the live sticker list.
- **DB read (conditional)** — falls back to
  `serverRepository.loadStickersByInternalId(server_id)` when
  `preloadedStickers` is empty.
- **Metadata dedup** — same pattern as emojis: pick richest metadata, then
  latest timestamp.
- **Sort stability** — sorted by `createdTimestamp` ascending.
- **Tool-prompt macro expansion** — the `{sticker_tool}` macro is expanded
  to the provider-correct function name before mention conversion.
- **Mention conversion** — final text passes through `convertMentions`.

## Invariants

After this stage runs:

- Returns `null` if: `sticker_usage_enabled === false`, DM channel,
  impersonation, `tomoriState === null`, or the guild sticker cache is
  empty.
- Stickers are referenced by *name* in the function call (case-insensitive),
  not by Discord sticker ID — the LLM never needs the ID.
- Skipped on impersonation (stickers are persona-flavored output, not
  user-flavored).

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `sticker_usage_enabled` | Master switch; `false` returns `null` |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| `StickerMetadata` shape | Defined in `serverAssets.ts:20-29`; tightly coupled to the `server_stickers` table schema. A plugin adding sticker-source kinds would extend the metadata-load path. |
| `{sticker_tool}` tool-prompt macro | The macro expansion makes the contributor provider-agnostic — adding a new provider that names the sticker tool differently is a single registration in `toolPromptMacros.ts`, not an edit here. |
| Sister contributor: emojis (stage 04) | Stickers and emojis share the same metadata + dedup pattern. A plugin formalizing "server asset" as a category should consider whether these two should generalize over a shared interface. → plugin plan candidate. |

## Related docs

- Emoji contributor: [`04-server-emojis.md`](./04-server-emojis.md)
- Sticker tool execution: tool registry (→ [tool-loop pipeline](../../../tool-loop/))
- Tool-prompt macros: covered in
  [native-assembly README](./README.md#shared-helpers-used-across-contributors).
