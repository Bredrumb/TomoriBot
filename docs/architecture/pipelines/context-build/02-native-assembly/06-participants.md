---
title: "02.6: Participants"
---

The densest single contributor: list every conversation participant with
per-user details (presence, roles, **personal memories**, reminders),
mention aliases with conflict detection, the active persona's pending
self-tasks, and the closing
channel/time-of-day footer.

**File:** `src/utils/text/context/participants.ts:38-236`

## Mission

For every user ID in `userList` (message authors plus eligible users resolved
from references in the visible history), emit a rich detail block: display name, mention aliases
(unique-resolution computed), online/presence status, server roles,
per-user personal memories (with tag-filtering against the conversation
corpus, like server memories in stage 03), pending reminders, and public
Physical Appearance tags for image generation. Then fold in Matrix bridge users and
synthetic webhook users (persona-flavored). Independently append every pending
self-task assigned to the active persona, even when its creator is not a
conversation participant. Close with channel name +
current time-of-day (timezone-aware).

The output is *one* context item — all participants live in a single
`[System: The following users are having a conversation: ...]` block.

## Input

Substantial — see signature in `participants.ts:38-58`. Notable:

- `userList: string[]` — Discord author IDs from history plus eligible
  reference-discovered user IDs
- `triggererName`, `botName`, `personaLineageId`
- `tomoriState`, `tomoriConfig` (provides `personal_memories_enabled`,
  `timezone_offset`)
- `isDMChannel`, `isUserImpersonation`, `impersonatedUserId`,
  `impersonatedIdentityName`
- `matrixUsers: Map<string, string>` — Matrix user ID → stripped display name
- `syntheticUsers: Map<string, { displayName, type: "persona" | "webhook" }>`
- `publicPersonaProfiles` — referenced/history/responder personas' public
  attributes plus normalized Physical Appearance tags
- `preloadedReferencedUserRows`, `referencedUserIds` — batched alias-resolution
  results; referenced users never take the auto-registration path
- `conversationCorpus` — for personal-memory tag filtering
- `snapshot`, `convertMentions`

## Output

`Promise<StructuredContextItem | null>` — `null` if `userList` is empty,
otherwise one `user`-role item tagged `KNOWLEDGE_USERS_IN_CONVERSATION`.

Also populates `conversationUsers: ConversationUserReference[]` on the
context item — a structured list used downstream for mention resolution by
the streaming pipeline.

Content shape:

```
[System: The following users are having a conversation:

If {botName} wants to ping any of these users, prepend an "@" symbol to a unique
mention handle shown below (case-insensitive). [...]

{botName} (This is you!)
- Status: Online - Currently active and responding to messages
- Physical Appearance: blue hair, red eyes, white hoodie

UserA (Mention: @{UserA}; Aliases: @{aliceA}, @{alice_global})
- Physical Appearance: short white hair, red eyes
- Status: Online - Playing Stardew Valley
- Server Roles: Mod, Member
- Memories: [id:42] Likes cats (tags: pets, animals)
- Reminders:
  - ID:42 "Take meds" (scheduled for Tue, May 21, 2026 10:00 AM (UTC-7), repeats every 24 hour(s))

Pending Tasks Assigned to You:
- ID:77 "Post the daily summary" (scheduled for Tue, May 21, 2026 06:00 PM (UTC-7), repeats every 24 hour(s)) (destination: #daily-summary)

Conversation context: #general (ID: 1234...).
Current time: May 21, 2026 18:30 UTC+09:00 (JST), evening.
]
```

## Side effects

- **DB / cache reads (per user)**:
  - `userRepository.loadByDiscordId(userId)` — load or `null`
  - If missing and the user is in the guild: `userRepository.register(...)`
    auto-registers them
  - `userRepository.isBlacklisted` (cached via `userCache`)
  - `userRepository.getPrivacyLevel` (cached)
  - `personalMemoryRepository.loadForUserLineage` if eligible
  - `serverScheduleRepository.getPendingRemindersForUser` for each user;
    pending reminders include `ID:N` so the LLM can target them with
    `update_task` for requester-scoped edits/deletes
  - One additional `getPendingRemindersForUser` read for the bot Discord ID,
    current server, and exact active `persona_id`; only `self_reminder = true`
    rows are rendered as persona tasks
- **Discord fetches**:
  - `guild.members.fetch(userId)` for role / display-name resolution
  - `client.users.fetch(userId)` fallback for users not in guild
  - `getUserPresenceDetails` for online status + activities (requires
    `GuildPresences` intent)
- **Reference discovery (upstream)** — `contextReferences.ts` scans the complete
  sanitized fetched window. Persona triggers use normal trigger matching even
  when Deliberate Trigger Mode is active, but this affects context only and
  never schedules a response.
- **User reference candidates (upstream)** — one repository read combines real
  Discord mentions, cached guild members, users with `message_sent` or
  `command_used` activity on this server, and eligible saved nicknames found in
  the history. Uncached database candidates are individually verified as
  current guild members; the pipeline never fetches the guild's entire member
  list.
- **Mention alias collection** — addresses, server nicknames, global names,
  usernames, and custom nicknames are collected per user; `aliasCounts`
  tracks duplicates across users to detect conflicts.
- **Final mention conversion** — assembled text passes through
  `convertMentions`.

## Invariants

After this stage runs:

- Returns `null` only when `userList` is empty.
- Every user entry has a `displayName` (falls back to `<@id>` for missing
  data).
- Mention aliases marked as `unique` are exactly those that appear *once*
  across `aliasCounts` — duplicates are silently dropped from the mention
  handle list (the LLM is told "mention requires clarification" instead).
- Each entry's `aliases` (server nickname, global name, username, custom
  nickname) plus its `displayLabel` are emitted as `conversationUsers` metadata
  for tool-side user resolution (`resolveUserTarget`). The conversation stage of
  that resolver matches input against the full alias set, but breaks ties by
  preferring a single candidate whose `displayLabel` (primary name) equals the
  input over candidates that only matched a secondary alias — so one user's
  server-nickname alias colliding with another user's actual name no longer
  forces a needless clarify round-trip.
- Personal memories are filtered by privacy (`PrivacyLevel.MINIMAL`
  required) AND blacklist AND `personal_memories_enabled` AND
  conversation-corpus tag match (if `memory_tagging_enabled`).
- Plain and textual `@` aliases are case-insensitive standalone phrases across
  saved Tomori nickname, guild display/nickname, global name, and username.
  Exactly one eligible guild member must own the alias; shared aliases, partial
  words, bots, non-members, unknown users, and default-only registrations add
  nobody. Real `<@id>` mentions are unambiguous but still require eligibility
  and current guild membership.
- Eligibility requires `message_sent`/`command_used` activity or meaningful
  state: personal memories, pending reminders/tasks, non-default
  personalization/image settings, timezone, privacy, or a deliberate-mode
  preference. Registration language, the initial nickname, and default rows
  alone do not qualify.
- Referenced users use this same full renderer, including privacy, blacklist,
  memory-tag, lineage, reminder/task, presence, role, timezone, alias,
  impersonation, and mention-target behavior.
- User reminders require both context membership and an active-persona match.
  Main personas additionally include legacy unassigned user reminders.
- Persona self-tasks do not require their creator or any other human to be in
  context. They require an exact active `persona_id` match, include their
  destination channel, and are omitted during user-impersonation turns.
- Persona public attributes and Physical Appearance tags are attached to the
  same participant entry. A tags-only persona is still rendered; a referenced
  persona with no existing synthetic entry is non-mentionable.
- Matrix and synthetic users are appended *after* normal users and are
  marked non-mentionable (`mentionable: false`).
- The closing footer always emits, even with one participant.

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `personal_memories_enabled` | Master switch for per-user memories + nickname usage |
| `tomoriConfig` | `memory_tagging_enabled` | (Set upstream in `nativeBuilder`) Drives `conversationCorpus` tag filter for personal memories |
| `tomoriConfig` | `timezone_offset` | Hours offset for current-time footer |
| Client intent | `GuildPresences` | Required for online/activity status; without it, only static info is shown |
| User row | `personal_dtm`, `privacy_level` | Reference eligibility and per-field privacy behavior; authored messages from `FULL` users are removed upstream |
| User row | `physical_appearance_tags` | Public physical appearance image tags |

## Extension points

This is the **single richest plugin surface in the context-build pipeline**.
Multiple plugin-relevant seams:

| Surface | Plugin-relevance |
|---|---|
| Personal memories per user (`personalMemoryRepository.loadForUserLineage`) | The "personal memory type" plugin category — a sister to server memories (stage 03). |
| Matrix-user folding (`matrixUsers` map) | A bridge plugin emits its users via this map; the contributor handles them uniformly. A Telegram/Slack bridge plugin would extend the same map. |
| Synthetic users (persona / webhook) | The chat pipeline pre-populates `syntheticUsers`; a plugin shipping a new "fake participant" type would extend the map. |
| Pending reminders and persona self-tasks (`serverScheduleRepository.getPendingRemindersForUser`) | Reminder system is core, not plugin — but a plugin adding "scheduled events" might want a parallel display block here. → plugin plan candidate. |
| Physical Appearance tags (`physical_appearance_tags`) | Coupled to image-generation tooling; a plugin adding a different image-gen tag scheme would extend the `normalizeImageAppearanceTags` path. |
| Channel + time-of-day footer | Internal — coupled to `timezoneHelper`. |

**A plugin extension for "alternate participant rendering"** (e.g.
collapse-when-many-users, show-roles-only-for-mods) would either:
- (a) Wrap this contributor with a post-processor on the emitted text.
  Brittle — text format is not a contract.
- (b) Replace this contributor entirely with the plugin's own. Cleaner —
  if a "register contributor" mechanism is built. → plugin plan candidate.

## Related docs

- Server memories (parallel): [`03-server-memories.md`](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/)
- User presence (helper, `history.ts`): covered in
  [native-assembly README](/architecture/pipelines/context-build/02-native-assembly/#shared-helpers-used-across-contributors).
- Display-name resolution: → no dedicated doc;
  `src/utils/discord/displayName.ts` helper only
- Reminder system: → no dedicated doc;
  `serverScheduleRepository` API only
- Image-generation Physical Appearance tags: → no dedicated doc;
  `physical_appearance_tags` is documented inline in the persona/user schemas
