---
title: "Chat-Proxy Integration"
sidebar:
  order: 1
---

The chat-proxy subsystem safely transfers a Discord user's trigger verdict to an external service's
delete-and-repost webhook message. It separates service-specific attestation and wording from shared
admission, identity, persistence, context, targeting, and memory behavior.

Only PluralKit is selectable. Tupperbox is an example of why the capability model includes a
no-correlation state, but TomoriBot does not claim Tupperbox support: its public documentation does
not provide an authoritative message-attestation API.

## Safety invariant

A webhook repost is admitted only when an adapter authoritatively attests all of these values and
they exactly match a live expectation:

- registered service ID;
- Discord original message ID;
- Discord sender account ID;
- Discord proxy message ID being evaluated.

Timing, channel proximity, display name, avatar, webhook name, and the number of live expectations
are never identity or correlation evidence. Zero claims admits nothing. Two services claiming the
same webhook is a conflict and also admits nothing.

## Capability model

| Correlation | Identity | Behavior |
|---|---|---|
| None | None | Suppress a deleted opted-in original, but ignore the webhook as self-like. |
| Attested | None | Transfer the exact trigger verdict to the matched webhook. Keep webhook presentation and write no identity rows. |
| Attested | Stable | Transfer the verdict, persist the stable identity, reconstruct history, and enable service-owned bio behavior. |

Stable identity implies authoritative correlation. Identity and namespace bio capabilities exist
only on the stable branch, making unsafe combinations unrepresentable in `ProxyServiceCapabilities`.

## Lifecycle

```text
user message
  -> resolve users.chat_proxy_service through the registry
  -> create expectation(service, original, sender, copied reply reference)
  -> wait for delete or CHAT_PROXY_WAIT_MS timeout

webhook in the same channel while expectations are live
  -> route each distinct candidate service at most once
  -> adapter returns zero or one authoritative attestation
  -> exact service/original/sender/message match
  -> mark the expectation proxied and remember the short-lived proxy record
  -> stable identity: persist identity + host + immutable message index atomically
  -> identity-free: admit without identity persistence or bio seeding
```

Delete and repost events may arrive in either order. Lookup activity pauses the original's wait
timer. Confirmed proxy records suppress the superseded original during racing history reads and
carry its reply reference onto the repost. The trigger gate always evaluates the original message,
so edited repost text cannot create or remove a reply verdict. When the wait expires, the
expectation is removed immediately; a late webhook cannot inherit a verdict after the original has
continued.

Router outcomes use a fixed six-value taxonomy: unsupported correlation, unmatched, timeout or
error, conflicting attestations, matched trigger-only, and matched stable identity. In-process
counters use only those bounded labels and never include user IDs, message content, descriptions,
or external identity keys.

## Registry and adapter contract

`src/utils/chatProxy/registry.ts` is the only production service catalog. A descriptor owns:

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
| `users.chat_proxy_service` | `NULL` never configured, `none` explicit opt-out, registered ID enabled. Unknown IDs are retained but disabled at runtime. |
| `external_identities` | Generic canonical external key mapped to one synthetic `users` row. |
| `chat_proxy_namespaces` | Service container keyed by `(service_id, namespace_key)`. |
| `chat_proxy_identities` | Stable identity linked to an external identity and namespace. |
| `chat_proxy_namespace_accounts` | Discord accounts authorized to speak for the namespace. |
| `chat_proxy_message_index` | Immutable message-to-identity and attested-sender history attribution. |

Canonical identity, namespace, host link, and message attribution are committed in one transaction.
Cosmetic fields may refresh; canonical keys and an existing message attribution do not. Context
history uses the in-process adapter cache first, then one batched database read, and never calls a
service API while rebuilding history. Confirmed misses use a bounded negative cache; a successful
identity transaction invalidates a prior miss only after the write commits.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `CHAT_PROXY_WAIT_MS` | `2000` | Original-message wait before ordinary processing. |
| `CHAT_PROXY_EXPECTATION_TTL_MS` | `10000` | Correlation expectation lifetime. |
| `CHAT_PROXY_MESSAGE_INDEX_RETENTION_DAYS` | `30` | Durable attribution retention. |
| `CHAT_PROXY_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS` | `24` | Retention sweep interval. |
| `CHAT_PROXY_BIO_SEED_MAX_CHARS` | `1000` | Maximum one-time identity bio snapshot. |

Transport-specific authentication, rate-limit behavior, and timeout variables remain with each
adapter. See the [PluralKit adapter](/architecture/integrations/pluralkit/) for the supported service.
