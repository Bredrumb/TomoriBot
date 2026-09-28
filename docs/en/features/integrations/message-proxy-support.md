---
title: "Message-Proxy Support"
description: "Choose a supported Discord message-proxy service and let TomoriBot safely follow its verified webhook reposts."
sidebar:
  order: 3
---

Message-proxy support lets TomoriBot follow messages that an external Discord bot deletes and reposts
through a webhook.

## Choose a service

Run `/personal message-proxy service:pluralkit` or `/personal message-proxy service:pluralbuddy`.
Choose `service:none` (shown as Off) to disable proxy handling. This is a personal setting on
the Discord account that sends the original messages and follows that account across servers.

After TomoriBot sees an alter's first verified message, use `/personal config identity:` to edit its
profile and `/personal memories identity:` to edit its memories. Autocomplete includes stored
identities from both services even while proxy handling is Off. Account interface, privacy, and model
settings stay on the host account. A nickname set in TomoriBot remains until cleared; otherwise the
service display name refreshes on verified messages. See
[PluralKit Support](/features/integrations/pluralkit-support/) for its member and bio details.

## What the safety check means

Tomori never assigns a webhook identity from its name or avatar. The selected service must verify the
repost ID, host account, and stable alter ID. PluralKit also identifies the exact original message,
so TomoriBot can transfer its trigger decision and reply target. PluralBuddy does not provide that
original ID. TomoriBot uses a recent message from the same host and channel as a best-effort match.
If the repost arrives after the original wait or several originals overlap, it may be ignored or
cause a second reply. Failed or conflicting verification never creates an identity.

This is why Tupperbox is not currently offered as a choice. Its public documentation describes
proxying but not a public authoritative message-attestation API that TomoriBot can safely use.

## Small message delay

When a service is selected, Tomori briefly waits before processing each ordinary guild message from
your account. This gives the service time to delete and repost it. Unproxied messages continue after
the wait. PluralKit reposts inherit the original trigger decision and reply target. PluralBuddy uses
the verified repost content and best-effort recent-message match.

Self-hosters can tune this mechanism with `MESSAGE_PROXY_WAIT_MS`. Service transport settings remain
separate, such as PluralKit's API timeout and optional token. PluralBuddy message lookups require
deployment OAuth app credentials in `PLURALBUDDY_CLIENT_ID` and `PLURALBUDDY_CLIENT_SECRET`.
Individual users do not need to supply tokens. The current adapter queries `pluralbuddy.app` only;
self-hosted PluralBuddy instances are not supported.
