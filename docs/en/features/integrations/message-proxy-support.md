---
title: "Message-Proxy Support"
description: "Choose a supported Discord message-proxy service and let TomoriBot safely follow its verified webhook reposts."
sidebar:
  order: 3
---

Message-proxy support lets TomoriBot follow messages that an external Discord bot deletes and reposts
through a webhook. Tomori only transfers a reply decision when the selected service can verify the
exact original message and sender.

## Choose a service

Run `/personal message-proxy service:pluralkit` to enable the currently supported service. Run
`/personal message-proxy service:none` to turn message-proxy handling off. This is a personal setting on
the Discord account that sends the original messages and follows that account across servers.

Only **PluralKit** is selectable. See [PluralKit Support](/features/integrations/pluralkit-support/)
for its member identity, memories, and limitations.

## What the safety check means

Tomori never decides that a webhook belongs to you from its name, avatar, timing, or proximity to a
deleted message. The selected service must authoritatively match the webhook message to your exact
original and Discord account. If verification is unavailable, fails, or conflicts, the webhook is
ignored and no identity or memory is invented.

This is why Tupperbox is not currently offered as a choice. Its public documentation describes
proxying but not a public authoritative message-attestation API that TomoriBot can safely use.

## Small message delay

When a service is selected, Tomori briefly waits before processing each ordinary guild message from
your account. This gives the service time to delete and repost it. Unproxied messages continue after
the wait; verified reposts inherit the original trigger decision and reply target.

Self-hosters can tune this mechanism with `MESSAGE_PROXY_WAIT_MS`. Service transport settings remain
separate, such as PluralKit's API timeout and optional token.
