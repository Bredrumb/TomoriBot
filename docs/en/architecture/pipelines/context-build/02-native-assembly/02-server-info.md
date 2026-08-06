---
title: "02.2: Server Info"
---

The "where am I" framing — server name and description.

**File:** `src/utils/text/context/serverInfo.ts:6-51`

## Mission

Emit a single `system`-role context item that tells the LLM what server (or
DM context) it's operating in. Server name and description for guild
channels; "currently in a Direct Message with User" for DMs. Impersonation
variant uses "You are X" phrasing instead of third-person "[bot] is in Y".

## Input

Subset of `BuildContextParams`:

- `serverName`, `serverDescription`, `guildId`
- `isDMChannel`, `isUserImpersonation`, `impersonatedIdentityName`
- `botName`, `tomoriConfig.personal_memories_enabled`
- `client`, `snapshot` (for `convertMentions`)

## Output

`Promise<StructuredContextItem>` — exactly one item. Tagged
`KNOWLEDGE_SERVER_INFO`. Content shape:

```
# Knowledge Base
{botName} is currently in the Discord server named "{serverName}".
## {serverName}'s Description
{serverDescription}
```

DM variant: `# Knowledge Base\n{botName} is currently in a Direct Message
with User.\n`

Impersonation variant: replaces `{botName} is in` with `You are
{impersonatedIdentityName}, currently in`.

## Side effects

- **Mention conversion** — the assembled text passes through
  `convertMentions` (server descriptions can contain mentions/channel
  links).

## Invariants

After this stage runs:

- Exactly one item is appended (never zero, never multiple).
- The output is tagged `KNOWLEDGE_SERVER_INFO` so preset reassembly can
  slot it correctly.

## Extension points

**Internal — fixed shape.** This contributor exists to give the LLM a
two-sentence "you are here" framing. A plugin wanting to add additional
server-context kinds (e.g. "verified server," "NSFW server tier," "rules
channel link") would either:

- (a) Extend `serverDescription` upstream (via the user-facing description
  the server admin sets) — no code change needed.
- (b) Add a new contributor with a new tag, e.g. `KNOWLEDGE_SERVER_RULES`,
  registered separately. → plugin plan candidate.

## Related docs

- Mention conversion: covered in
  [native-assembly README](/architecture/pipelines/context-build/02-native-assembly/#shared-helpers-used-across-contributors).
