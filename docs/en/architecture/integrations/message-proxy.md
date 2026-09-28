---
title: "Message-Proxy Integration"
sidebar:
  order: 1
---

The message-proxy subsystem safely transfers a Discord user's trigger verdict to an external service's
delete-and-repost webhook message. It separates service-specific attestation and wording from shared
admission, identity, persistence, context, targeting, and memory behavior.

PluralKit and PluralBuddy are selectable. Tupperbox is an example of why the capability model includes a
no-correlation state, but TomoriBot does not claim Tupperbox support: its public documentation does
not provide an authoritative message-attestation API.

## Verification invariant

A webhook repost is admitted only when an adapter verifies its repost ID, host account, and stable
identity. The host must have selected that service and have a recent message expectation in the same
channel. PluralKit also attests an exact original ID. PluralBuddy's message API omits that field, so
its match to one recent original is best effort:

- registered service ID;
- Discord original message ID for PluralKit;
- Discord sender account ID;
- Discord proxy message ID being evaluated.

Timing, channel proximity, display name, avatar, webhook name, and the number of live expectations
are never identity evidence. Zero claims admits nothing. Two services claiming the
same webhook is a conflict and also admits nothing.

## Capability model

| Correlation | Identity | Behavior |
|---|---|---|
| None | None | Suppress a deleted opted-in original, but ignore the webhook as self-like. |
| Attested | None | Transfer the exact trigger verdict to the matched webhook. Keep webhook presentation and write no identity rows. |
| Attested | Stable | Transfer the verdict, persist the stable identity, reconstruct history, and enable service-owned bio behavior. |
| Verified repost | Stable | Persist verified repost and alter identity with a recent host expectation. Original pairing and duplicate suppression are best effort. |

Identity and namespace bio capabilities exist only for stable identities. The correlation capability
states whether an adapter can identify the exact original.

## Authorization and identity split

| Concern | Owner |
|---|---|
| Privacy, blacklist, cooldown, quota, and trigger authorization | Host Discord account |
| Usage telemetry (`message_sent`, usage, affinity, and the rest of `stat_counters`) | Host Discord account |
| Name, pronouns, memories, and the behavioral `presence_seen` reunion clock | Stable proxied identity |

The reunion clock follows whoever spoke. A verified repost ticks the proxied identity's synthetic
`users` row, so each member of one system meets Tomori and returns to her on its own timeline, and a
sibling speaking from the same account in between changes nothing. Notes from that clock describe only
the identity, never the account's absence, because the account is shared by everyone in the system.
Member turns never advance the host's clock, and ordinary unproxied messages never advance a member's.
PluralBuddy's message API omits the member name, so a verified repost's webhook username supplies
the member label for history, queued replies, and reunion notes.
Both metrics the gap lookup spans (`presence_seen` and `message_sent`) are host-owned in telemetry, so a
newly persisted identity has no history and correctly reads as a first meeting. See
[dialogue history](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/).

## Lifecycle

```text
user message
  -> resolve users.message_proxy_service through the registry
  -> create expectation(service, original, sender, copied reply reference)
  -> wait for delete or MESSAGE_PROXY_WAIT_MS timeout

webhook in the same channel while expectations are live
  -> route each distinct candidate service at most once
  -> adapter returns zero or one authoritative attestation
  -> exact service/sender/message match, plus original for PluralKit
  -> mark the expectation proxied and remember the short-lived proxy record
  -> stable identity: persist identity + host + immutable message index atomically
  -> identity-free: admit without identity persistence or bio seeding
```

Delete and repost events may arrive in either order. Lookup activity pauses the original's wait
timer. PluralKit records suppress the superseded original during racing history reads and carry its
reply reference onto the repost. Its trigger gate evaluates the original message. PluralKit
expectations expire when the wait ends. PluralBuddy keeps the expectation until its TTL so a verified
late repost can still be recognized, but the original may already have triggered a reply. Concurrent
originals from one host cannot be paired and are left unmatched.

A confirmed record notes whether its original was still held by the speedbump
(`originalSuppressed`). Only a repost from the same stable member as the active turn may enter
the channel lock's follow-up path, and only when its original was suppressed and its attested
host is the active turn's user. It then interrupts, or queues behind a tool chain, and replays
as the webhook message. A different member on the same host account uses the ordinary busy
queue. Follow-up replacement is keyed by the host account because the webhook authors the repost.
A late PluralBuddy repost whose original left the speedbump is ignored as an ordinary chat trigger,
even if the original's turn has ended. Another host's repost and any unconfirmed webhook cannot
interrupt a reply. Verification that finishes after the turn ends finds no lock to interrupt.

Router outcomes use a fixed six-value taxonomy: unsupported correlation, unmatched, timeout or
error, conflicting attestations, matched trigger-only, and matched stable identity. An adapter that
resolves no attestation reported a confirmed miss (`unmatched`), while an adapter that could not
answer rejects, which is counted as timeout or error. In-process counters use only those bounded
labels and never include user IDs, message content, descriptions, or external identity keys.

## Registry and adapter contract

`src/utils/messageProxy/registry.ts` is the only production service catalog. A descriptor owns:

- stable service ID, synthetic-user prefix, and external identity kind;
- localized setting label and service-specific enablement confirmation;
- external-key validation;
- discriminated capabilities;
- optional exact local eligibility predicate;
- bounded attestation transport and successful-result cache access;
- reply-embed extraction;
- identity and memory wording plus the complete namespace entry, including any relationship to
  linked Discord accounts.

`ProxyServiceId` is derived from the descriptor tuple. Startup invariant tests reject duplicate
service IDs, prefixes, and identity kinds. Unknown stored service IDs fail closed and log a bounded
diagnostic instead of creating per-message noise.

To add an attested service:

1. Create one adapter folder with its transport DTOs contained inside it.
2. Translate authoritative results into `ProxyMessageAttestation` and generic identity inputs.
3. Supply service-owned presentation without editing participant or context consumers. Shared
   rendering groups namespace entries but does not add account-relationship vocabulary.
4. Add the descriptor to the registry with localized choice and enablement-confirmation keys.
5. Add service documentation and transport, router, presentation, and persistence tests.

Do not add a service that requires guessing identity from display data. If its stable data cannot
fit the namespace model, extend persistence deliberately rather than fabricating a key.

## Persistence

| Table or column | Purpose |
|---|---|
| `users.message_proxy_service` | `NULL` never configured, `none` explicit opt-out, registered ID enabled. Unknown IDs are retained but disabled at runtime. |
| `external_identities` | Generic canonical external key mapped to one synthetic `users` row. |
| `message_proxy_namespaces` | Service container keyed by `(service_id, namespace_key)`. |
| `message_proxy_identities` | Stable identity linked to an external identity and namespace, with its last verified webhook avatar. |
| `message_proxy_namespace_accounts` | Discord accounts authorized to speak for the namespace. |
| `message_proxy_message_index` | Immutable message-to-identity and attested-sender history attribution. |

Canonical identity, namespace, host link, and message attribution are committed in one transaction.
Cosmetic fields may refresh; canonical keys and an existing message attribution do not. A service
that publishes profile text for an identity may seed it once, on the same transaction that first
registers that identity: pronouns reach the synthetic user's own `pronouns` setting there, and every
later attestation leaves that column alone, so what the personalization panel or a chat tool wrote is
what later prompts read. Context building uses the in-process adapter cache first, then one batched
database read, and never calls a service API while rebuilding context. That covers both the dialogue
history and a reply annotation whose referenced message falls outside the fetched history window, so
both name a verified member from its stored member name and saved nickname instead of the service's
configurable webhook veneer. Confirmed misses use a bounded negative cache; a successful identity
transaction invalidates a prior miss only after the write commits.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `MESSAGE_PROXY_WAIT_MS` | `2000` | Original-message wait before ordinary processing. |
| `MESSAGE_PROXY_EXPECTATION_TTL_MS` | `10000` | Correlation expectation lifetime. |
| `MESSAGE_PROXY_MESSAGE_INDEX_RETENTION_DAYS` | `30` | Durable attribution retention. |
| `MESSAGE_PROXY_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS` | `24` | Retention sweep interval. |
| `MESSAGE_PROXY_BIO_SEED_MAX_CHARS` | `1000` | Maximum one-time identity bio snapshot. |

PluralBuddy uses deployment-owned OAuth app credentials in `PLURALBUDDY_CLIENT_ID` and
`PLURALBUDDY_CLIENT_SECRET` for its OAuth client-credentials token. Its message lookup is bounded to
five seconds, stops on a rate-limit response, and caches successful lookups. See the
[PluralKit adapter](/architecture/integrations/pluralkit/) for its separate transport.
The PluralBuddy adapter uses the public `pluralbuddy.app` origin. Supporting another instance would
require a configurable API origin, instance-scoped credentials, and instance-scoped identity keys.
