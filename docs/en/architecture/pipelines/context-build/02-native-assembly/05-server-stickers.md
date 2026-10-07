---
title: "02.5: Server Stickers"
---

`buildServerStickerContextItem` in `src/utils/text/context/serverAssets.ts` emits one
`KNOWLEDGE_SERVER_STICKERS` system item for the responding persona.

## Input and output

The contributor receives the client, guild ID, server and persona names, turn flags,
server configuration, active persona state, optional preloaded native and custom rows,
and the tool-prompt macro resolver and mention converter. Missing preloads are read
through `ServerRepository`; an empty preload is a complete empty result.

`projectStickerCandidates` in `src/utils/discord/stickerCandidates.ts` is shared with
`select_sticker_for_response`. It projects sendable native stickers and customs eligible
for the active persona. Native entries retain name deduplication, richest/latest metadata,
and creation ordering. Customs append without a per-list limit; global context budgeting
still applies. A server with only eligible customs receives this context item.

The list exposes each name, description, and emotion, followed by the instruction to call
`{sticker_tool}` with a case-insensitive name. Source URLs, file formats, storage references,
delivery kinds, and persona membership rules stay outside the model-visible list. The macro
resolver expands the function name before mention conversion.

## Eligibility and cache

The stage returns `null` when sticker usage is disabled, the turn is a DM or impersonation,
there is no active server state or cached guild, or the projected list is empty. Roleplay
uses the existing turn configuration that disables sticker usage. Provider availability
remains enforced by tool assembly and execution.

Native candidates pass `isStickerSendable`. Explicit `available === false` and IDs rejected
by Discord are excluded; partial availability is accepted. Own-guild stickers need no
external-sticker permission. Tool lookup still checks that permission for external assets.

Custom rows are cached server-wide with their persona membership IDs. Unrestricted rows
are eligible for every server persona. Restricted rows require the active persona's ID;
a restricted empty list allows nobody. Each turn applies this filter independently.
The tool reloads current rows before resolving a supplied name or ID and uses the same
eligible projection for retry suggestions. A later native/custom normalized-name collision
returns ambiguity. Delivery, which happens when the tool is invoked, rechecks current
custom access and revision immediately before sending.

## Related docs

- [Emoji contributor](/architecture/pipelines/context-build/02-native-assembly/04-server-emojis/)
- [Caching](/architecture/subsystems/caching/)
- [Tool loop](/architecture/pipelines/tool-loop/)
- [Expression delivery](/architecture/pipelines/tool-loop/02-execute-tool-call/)
