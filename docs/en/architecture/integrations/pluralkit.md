---
title: "PluralKit Integration"
---

This document describes TomoriBot's PluralKit (PK) integration — a proxy-aware
trigger fix plus canonical per-member identity, so plural systems using
[PluralKit](https://pluralkit.me/) get correct trigger behavior and each
system member gets their own personal memories instead of degrading to
server-wide. See `plans/pluralkit-integration.md` for the original design
record (decisions, rationale, deferred work).

## Table of Contents

- [Overview](#overview)
- [Why This Exists](#why-this-exists)
- [Flow](#flow)
- [Identity Model](#identity-model)
- [Authorization vs. Identity Split](#authorization-vs-identity-split)
- [API Etiquette](#api-etiquette)
- [Message-Index Retention](#message-index-retention)
- [User Opt-In](#user-opt-in)
- [Known Limitations](#known-limitations)

---

## Overview

PluralKit lets plural systems proxy messages: a member sends a tagged message
(e.g. `A:hello`), PluralKit reposts it through a per-server webhook using the
member's name/avatar, and deletes the original almost immediately. TomoriBot's
integration is **opt-in per user** (`/personal pluralkit`) and has two parts:

1. **Speedbump** — a short flat delay on opted-in users' messages so Tomori
   answers the webhook repost instead of the soon-to-be-deleted original.
2. **Per-member identity** — PK system members get their own synthetic `users`
   row, so personal memories, nicknames, and conversational identity are keyed
   on the *member*, not the shared Discord host account.

## Why This Exists

Without this integration, PK proxying broke Tomori in two ways:

- **Ghost trigger.** The original message triggers generation normally, then
  PluralKit deletes it mid-flight; Tomori ends up replying to a message that no
  longer exists, while the actual repost — a webhook message — was classified
  as `isLikelySelfMessage` and could never trigger.
- **No identity.** Personal memories require a `users` row keyed by
  `user_disc_id`. Webhook authors have none, so facts about PK members would
  degrade to server-wide memories — the same fate Matrix bridge users hit (see
  [`matrix/bridge.md`](./matrix/bridge)), which was the architectural
  precedent this feature mirrors.

## Flow

```
Opted-in user sends a proxied message
  │
  ▼
[admission] evaluateChatAdmission (src/utils/chat/admission.ts)
  │  isRealUserMessage + userRow.pluralkit_enabled?
  │  yes → createPluralKitProxyExpectation(channelId, originalMessageId, senderDiscId)
  │        wait up to PLURALKIT_PROXY_WAIT_MS
  │
  ├─ PluralKit deletes the original ────────────────────────────────┐
  │    messageDelete handler (src/events/messageDelete/             │
  │    pluralkitProxyExpectation.ts)                                │
  │      → markPluralKitProxyOriginalDeleted()                      │
  │      → expectation state: "proxied"                             │
  │      → original's speedbump wait resolves early                 │
  │      → original returns ignored("pluralkit_proxied")            │
  │                                                                  │
  └─ Webhook repost arrives in the channel ─────────────────────────┘
       │  hasLivePluralKitProxyExpectations(channelId)?
       │  yes → fetchMessage(messageId) — GET /v2/messages/{id}
       │        (src/utils/pluralkit/pkApi.ts)
       │
       │  response.original / response.sender matched against a live
       │  expectation (findMatchingPluralKitProxyExpectation)?
       │  yes → admitted as real-user-like (parallel to isMatrixRelayMessage)
       │        original's transferred admission verdict carries over
       │        (PK reposts have no native `reference`, so reply-triggers
       │        are only detectable on the now-deleted original)
       │
       ▼
  persistPluralKitLookupIdentity() (admission.ts)
       │  1. pluralKitRepository.upsertMemberIdentity()
       │     → ensures pluralkit_systems + external_identities +
       │       pluralkit_members rows; on first sighting, registers a
       │       synthetic `users` row (pk:{member_uuid})
       │  2. pluralKitRepository.linkHostAccount(pkSystemId, senderDiscId)
       │  3. pluralKitRepository.recordMessageIndex(messageId, ...)
       │  4. isNewMember? → fire-and-forget seedPluralKitMemberBio()
       │     (never awaited — must not delay the reply)
       ▼
  Turn proceeds normally; conversational identity for this and future
  history rebuilds resolves via pluralkit_message_index, not the API.
```

## Identity Model

Canonical anchors are the PluralKit **member UUID** and **system UUID** —
never names, which are volatile and user-editable at any time. Short-form
hids (5-7 chars, e.g. `abcdef`) are cached "just in case" but never used as a
key.

```
users (synthetic row, user_disc_id = 'pk:{member_uuid}')
  └─ external_identities (kind='pluralkit_member', external_key=member_uuid)
       └─ pluralkit_members (member_uuid, member_hid, display_name)
            └─ pluralkit_systems (system_uuid, system_hid, system_name, system_tag)
                 └─ pluralkit_system_accounts (pk_system_id ↔ host_user_disc_id, 1..n)

pluralkit_message_index (message_disc_id → external_identity_id, sender_disc_id)
  — durable message→identity cache so context rebuilds survive restarts
    without re-querying the PluralKit API
```

`external_identities` is deliberately generic (`kind`, `external_key`) rather
than PK-specific — it anchors a synthetic `users` row for any future external
identity source (e.g. `matrix_user`, `persona`) without a redesign. Because a
PK member gets a *real* `users` row, the entire personal-memory subsystem
(FKs, limits, lineage scoping, cache invalidation) works unchanged — this is
the key difference from the Matrix bridge, which has no `users` row and
degrades personal-memory writes to attributed server memories (see
[`matrix/bridge.md`](./matrix/bridge) and the LTM scope-fallback table in
[`ltm/01-ltm-create.md`](../pipelines/memory/ltm/01-ltm-create)).

Key repository: `src/utils/db/repositories/PluralKitRepository.ts`
(`upsertMemberIdentity`, `linkHostAccount`, `recordMessageIndex`,
`getMessageIdentitiesByMessageIds` for batched context-rebuild lookups,
`getMemberContextByUserDiscId` for the participants block).

Context building (`contextPipeline.ts`, `resolvePluralKitMessageIdentitiesForHistory`)
never calls the PluralKit API — it consults the in-process lookup cache first,
then a single batched `WHERE message_disc_id = ANY(...)` query per history
rebuild, so a 50-message rebuild cannot burst PK's rate limit. Misses fall
back to the webhook's own display name.

The same rebuild also drops any original that a confirmed proxy has superseded
(`getSupersededPluralKitOriginalMessageIds`). PluralKit posts the webhook and
deletes the original as two separate REST calls, and it indexes the proxy at the
first one, so a lookup can resolve while the delete is still in flight — a
history fetch inside that window still returns the original from Discord. Without
the filter the same message renders twice, once under the host account's display
name and once under the member's.

### Reply embeds

A webhook message cannot carry a native reply reference, so PluralKit states the
reply as an embed on the proxy: `author.name` is the replied-to member's name
followed by U+21A9, and the description holds a jump link to the quoted message.
That is the same fact `applyPluralKitProxyReference` recovers by copying the
pre-proxy original's `reference` onto the proxy, so an unfiltered embed reaches
the model as a second reply notice next to the pipeline's own
`[System: ... is referring to a previous message ...]` line.

`src/utils/pluralkit/proxyReplyEmbed.ts` recognizes the shape (author suffix plus
a jump link, both required so an ordinary link preview cannot trip it) and feeds
two call sites:

- `processLinkEmbed` (`src/utils/discord/embedClassifier.ts`) drops the embed
  instead of rendering it as link-preview content.
- `extractReplyContextTargetFromEmbed` (`src/utils/chat/contextAnnotations.ts`)
  accepts it as a reply target. The copied `reference` lives on one in-memory
  `Message` instance, so a proxy refetched after eviction or a restart arrives
  with the embed as its only reply evidence: without this lane, dropping the
  embed would lose the reply relationship entirely on older history.

### Naming an absent member

A member that has not spoken inside the history window can still be pulled into context by
name, matching how a named human participant is hydrated. `resolveContextReferences`
(`src/utils/text/contextReferences.ts`) runs a third candidate lane alongside the existing
persona and Discord-user lanes:

- `pluralKitRepository.loadContextReferenceMembers` matches `pluralkit_members.display_name`
  and `users.user_nickname` against the history text, scoped to systems whose
  `pluralkit_system_accounts` link a host account in the guild. Without that scope, a common
  first name would offer every member the bot has ever indexed.
- Member rows are excluded from the Discord-user lane, because their `users` rows can satisfy
  that lane's nickname and server-activity filters and a `pk:{uuid}` sent to
  `guild.members.fetch()` earns only an Unknown Member error and a bogus `non_member` rejection.
- Both lanes feed one `resolveUniqueParticipantAliasReferences` call, so a member and a human
  answering to the same name collide with each other and neither is hydrated. Collisions are
  per alias string, not per person: an owner's other distinct names still resolve, and anyone
  already visible in the window is unaffected.
- Members are seeded without the `mentionable` capability: there is no account to ping.

Naming a *system* is deliberately not a hydration trigger. Loading every member's memories
would expose absent members' facts to whoever the fronting member is talking to, and systems
run 24-40 members, so it would also churn the prompt cache for the rest of the conversation.

The users-in-conversation block is assembled by
`src/utils/text/context/participants.ts`, which delegates every per-participant
fact to `src/utils/text/participants/hydration.ts`. It renders PK members with
member name, system name, and host account as independent entities, named
appositively so no relational verb is implied. Possessive or authority framing
("the host's system", "owned by", "run by") is excluded by design: the host
label is usually a member's or the system's own name, so a relational verb
would invent a hierarchy among system-mates:

```
Sparrow:
- Member of the "Lighthouse" plural system; its members share one presence here (Jordan, @jordan_h)
- Sparrow's memories: ...
```

Members get no presence line. A member has no presence of its own, it is in the
block because it just spoke, and it is never mentionable, so the proxying
account's status governs no decision. The host's own presence renders normally
whenever the host is a participant in its own right.

Memory rendering is **per-present-member, never per-system** — only members
who actually appear in the loaded dialogue history get their memories
rendered, exactly like human users. This avoids token bloat (some systems run
24-40 members) and respects member boundaries (an absent member's facts don't
leak to whoever a fronting member is talking to).

`pk:` synthetic user IDs are guarded wherever code assumes a Discord
snowflake: `targetResolver.ts` (conversation-reference resolution, parallel to
the bridge branch), `participants/hydration.ts` (skips `guild.members.fetch` /
`client.users.fetch` / presence lookups for `pk:` IDs and marks the member
non-mentionable), and anywhere mention/`<@id>` rendering occurs. `isPluralKitUserId()` / `toPluralKitUserId()` /
`isExternalUserId()` live in `src/utils/bridges/bridgeUserId.ts` alongside the
Matrix bridge ID helpers.

## Authorization vs. Identity Split

**Settings, keys, permissions, quotas,
cooldowns, privacy, and blacklists key on the host Discord account**;
**conversational identity and memories key on the member**.

| Concern | Keys on | Where |
|---|---|---|
| Privacy level (`PrivacyLevel.FULL` block) | Host (`sender`) | `admission.ts` — `userDiscId` resolves to `pluralKitProxyRecord.senderDiscId` for confirmed proxy reposts before the privacy check runs |
| Cooldowns / quotas | Host (`sender`) | `admission.ts` — `cooldownUserDiscId` falls through to the same host-resolved `userDiscId` (parallel to the Matrix `matrixRelayUserId` pattern) |
| Blacklist | Host (`sender`) | `getPluralKitHostProtection()` (`src/utils/pluralkit/hostProtection.ts`) — checked by the memory tool and bio seeding before writing anything under a member's synthetic row |
| Conversational identity (who Tomori is talking to) | Member (`pk:{uuid}`) | Context pipeline / participants block, resolved independently of admission's host-keyed `userDiscId` |
| Personal memories | Member (`pk:{uuid}`) | `memoryTool.ts` — `loadByDiscordId('pk:{uuid}')` returns a real `users` row, so personal memory creation needs **no fallback**, unlike the Matrix bridge's server-wide degrade |
| One-time bio seed | Member (`pk:{uuid}`), lineage 0 | `src/utils/pluralkit/bioSeeding.ts` |

`getPluralKitHostProtection()` shields **all** of a host's members if the host
sets `PrivacyLevel.FULL` or gets blacklisted on a server — a host-level
shield, not a per-member one.

## API Etiquette

`src/utils/pluralkit/pkApi.ts` wraps `GET /v2/messages/{messageId}`:

- **No-token access is 5 rps, IP-locked.** An optional bot-owned
  `PLURALKIT_API_TOKEN` raises the base rate limit for all of Tomori's
  lookups; it grants **no** access to other users' private data (PK identity
  lookups are public regardless of token).
- **404 retries** — PK's message index lags ~2s behind a proxied send, so 404s
  retry on a backoff schedule (`800ms → 1600ms → 3200ms`) within the overall
  budget.
- **429 handling** — honors `Retry-After` when present and sane, otherwise
  falls back to the same backoff schedule. `Retry-After: 0` counts as insane:
  PK's rate limiter is known to accidentally send it, and an instant retry
  against a rate-limited endpoint is the opposite of backing off.
- **Hard cap** — `PLURALKIT_LOOKUP_TIMEOUT_MS` (default `5000`) bounds the
  entire retry budget. Past the cap, the lookup returns `null` and callers
  fall through to today's plain-webhook behavior — no identity is ever
  invented.
- **Single-flight + permanent cache** — a message's PK identity never changes
  once resolved, so successful lookups are cached in-process under an
  LRU-style eviction cap (`IDENTITY_CACHE_MAX_ENTRIES`); concurrent lookups
  for the same message share one in-flight request. Transient failures are
  deliberately **not** cached, so a later attempt (e.g. after an outage) can
  still resolve identity for the same message ID.
- Lookups are gated by the speedbump itself — `hasLivePluralKitProxyExpectations(channelId)`
  must be true before a webhook message triggers a PK API call, so unrelated
  webhooks (other bots, Tomori's own alter personas) never burn PK's rate
  limit.

### Operator workflow for `PLURALKIT_API_TOKEN`

Run `pk;system new` on the bot operator's **own** Discord account (an empty
shell system — never used for proxying), then `pk;token`, and paste the result
into `PLURALKIT_API_TOKEN` in the environment. This is a full-write secret for
that shell system and PluralKit's account-recovery proof — if leaked, run
`pk;token refresh` on that system to invalidate it, then update the env. End
users never provide their own tokens; see `.env.optional.example` for the full
comment.

## Message-Index Retention

`pluralkit_message_index` rows are immutable (a message's identity never
changes) and only need to exist as far back as context building can read
history. `src/timers/pluralkitIndexPruner.ts` runs one sweep at startup
(catching backlog accumulated while offline) and then on a fixed interval:

| Env var | Default | Purpose |
|---|---|---|
| `PLURALKIT_MESSAGE_INDEX_RETENTION_DAYS` | `30` | Rows older than this are deleted |
| `PLURALKIT_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS` | `24` | How often the recurring sweep runs |

## User Opt-In

`/personal pluralkit` (`src/commands/personal/pluralkit.ts`) toggles
`users.pluralkit_enabled`. The integration is gated entirely on this
per-user flag — there is no server-wide toggle, no per-guild cache, and PK
lookups only ever happen inside a live proxy-expectation window created for
an opted-in user's own message. Enabling it means:

- Messages get a flat delay (`PLURALKIT_PROXY_WAIT_MS`, default 2000ms) while
  Tomori waits to see whether PluralKit reposts them.
- The first time Tomori sees a given system member, any public bio text that
  member has set on PluralKit may be saved as a one-time starting memory (see
  below) — this is stated in the command's confirmation reply as a consent
  line.

### One-time bio seeding

On a member's first-ever registration, `src/utils/pluralkit/bioSeeding.ts`
seeds their PluralKit member description verbatim as a single personal memory
(`persona_lineage_id = 0`, the global personal namespace), truncated to
`PLURALKIT_BIO_SEED_MAX_CHARS` (default 1000, matching PK's own description
cap). This is a **snapshot, not a sync** — later bio edits on PluralKit never
propagate, by design (avoids prompt-cache thrashing on every front switch and
avoids re-querying PK per sighting). The seed fires asynchronously after the
identity-registration transaction commits and is never awaited by the
triggering reply; failures never surface to the user. Host `FULL` privacy or
blacklist status blocks the seed via `getPluralKitHostProtection()`.

## Known Limitations

These are accepted v1 tradeoffs (see `plans/pluralkit-integration.md` §11 for
the full deferred-work list):

- No per-user PK tokens — private system data and member ACLs are out of
  scope; all lookups use the public message-identity endpoint.
- Bio seeding is one-time only; there is no re-sync or drift detection. The
  remedy for a stale fact is the same as for a human: the member tells Tomori
  and she updates the memory via normal chat-mediated edits.
- No host-managed member-memory commands — a host cannot run
  `/memory personal` against one of their members' rows; only chat-mediated
  edits work today.
- Identity is per-message, resolved at trigger time — there is no live
  `/fronters` polling, so the participant block only changes when a *new*
  member is seen, not on every front switch.
