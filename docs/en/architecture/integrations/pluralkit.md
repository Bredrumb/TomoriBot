---
title: "PluralKit Adapter"
sidebar:
  order: 2
---

The PluralKit adapter supplies authoritative message correlation, stable member identity, reply
recovery, and service-owned prompt wording to the generic [message-proxy subsystem](/architecture/integrations/message-proxy/).
PluralKit is currently the only selectable message-proxy service.

## Descriptor

`src/utils/messageProxy/services/pluralkit/descriptor.ts` registers these facts:

| Property | Value |
|---|---|
| Service ID | `pluralkit` |
| Synthetic user prefix | `pk:` |
| External identity kind | `pluralkit_member` |
| Correlation | Authoritative message lookup |
| Identity | Stable member and system UUIDs |
| Identity bio | Inline public member description |
| Namespace bio | Inline public system description |

Member and system UUIDs are the canonical keys. Names, tags, short IDs, webhook names, and avatars
are cosmetic data and never establish identity.

## Message lookup transport

`services/pluralkit/api.ts` calls `GET /v2/messages/{messageId}` and validates the response with
Zod before it reaches generic code. The adapter converts the validated transport DTO into a
`ProxyMessageAttestation` containing the proxy message, original message, sender account, and an
optional stable identity.

The client preserves PluralKit-specific behavior:

- `404` is retried because PluralKit may receive a proxy message before its API index does.
- `429` honors a sane positive `Retry-After`; zero or malformed values use bounded backoff.
- `PLURALKIT_LOOKUP_TIMEOUT_MS` bounds the complete lookup budget.
- `PLURALKIT_API_TOKEN`, when set, is sent as the authorization token.
- Concurrent reads for one message share a single request. Successful results are cached; failed
  results are not permanently cached.
- A missing, deleted, private, or otherwise unavailable member produces no stable identity claim.

The generic router still requires the returned service ID, original ID, and sender ID to match a
live expectation exactly. A display-name or timing resemblance is never accepted.

## Identity mapping

PluralKit maps its concepts into generic persistence as follows:

```text
PluralKit member UUID
  -> external_identities(kind = pluralkit_member)
  -> users(user_disc_id = pk:<member-uuid>)
  -> message_proxy_identities

PluralKit system UUID
  -> message_proxy_namespaces(service_id = pluralkit)
  -> message_proxy_namespace_accounts(host Discord accounts)

Proxy message ID
  -> message_proxy_message_index(member identity + attested sender)
```

The host account owns authorization, privacy, blacklist state, cooldowns, quotas, and personal
settings. The synthetic member owns conversational attribution and personal memories. Host
`PrivacyLevel.FULL` or blacklist state shields every linked member.

## Prompt presentation

`presentation.ts` owns all PluralKit vocabulary rendered to the model. It describes an identity as
a member, renders its system using name then tag then an unnamed fallback, and emits one system note
per system. That note also labels linked Discord accounts as shared accounts; the shared renderer
outputs the adapter's completed entry without assigning relationship semantics. Shared participant
and history code only sees generic identity and namespace DTOs.

A present member has no independent Discord presence and cannot be mentioned. Its memories remain
member-specific. A public system description is refreshed when observed and rendered once for the
system; a public member description may be seeded once as a global personal memory when the member
is first registered. The seed is a snapshot, not a later synchronization.

## Reply embeds

PluralKit represents proxied replies with an embed. `replyEmbed.ts` validates the expected author
suffix and Discord message URL before recovering the channel and message IDs. The context pipeline
suppresses that service metadata as a link preview while retaining the recovered reply target.

## User and operator settings

Users select the adapter with `/personal message-proxy service:pluralkit` and disable it with
`service:none`. The mechanism delay is `MESSAGE_PROXY_WAIT_MS`; only transport authentication and
lookup timing remain under `PLURALKIT_*` variables.

For user-visible behavior and limitations, see [PluralKit Support](/features/integrations/pluralkit-support/).
