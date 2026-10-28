---
title: "07: Discord Delivery"
aiGenerated: true
---

Discord delivery formats, paces, and transmits normalized segments to Discord. It manages delivery
modes, typing simulation, webhook identity routing, and Discord API rate caps.

## Flow and ownership

Delivery is shared by `StreamMessageDelivery.sendSegment()` and `StreamUiUpdater.sendSinglePayload()`.
The flusher passes normalized segments from [stage 06](/architecture/pipelines/provider/06-segment-normalization/)
to `sendSegment()`, which selects the delivery mode and chunks text:

- **Aggregated mode (`HumanizerDegree.NONE`):** Queues segments into `state.pendingAggregatedText`.
  Output is withheld until a tool call, table attachment, or final flush, delivering content in a
  single batch. Identity overrides flush queued text immediately to keep webhook identities aligned
  with their specific lines.
- **Streaming mode (`HumanizerDegree.LIGHT`, `MEDIUM`, `HEAVY`):** Splits segments into Discord-safe
  chunks via `chunkMessage()`. Chunks send immediately or pace through `sendChunksWithTyping()`.

`StreamUiUpdater.sendSinglePayload()` executes Discord REST calls, routing payloads through webhooks
or standard bot messages based on context.

## Message chunking and formatting

`chunkMessage()` parses text into typed blocks to fit within Discord message limits:

- **Preserved spans:** Protects regions that must not split across message boundaries, including
  fenced code blocks, URLs, markdown formatting (`**`, `*`, `~~`, `` ` ``, markdown links), paired
  quotes, balanced parentheses, and custom emoji tags. An oversized code block repeats its opening
  fence and syntax language tag on subsequent messages so syntax formatting survives.
- **Emoji isolation:** Custom emojis isolate into individual messages unless positioned mid-sentence
  or inside numbered or bulleted list items. Consecutive emojis sharing an initial name prefix merge
  into emoji runs.
- **Humanizer splitting:** Paragraph breaks divide messages at degrees 1 and 2. Degree 3 splits at
  sentence boundaries and runs `humanizeString()`, rolling punctuation marks between deletion,
  splitting, and preservation while keeping styled markup spans intact.

## Typing simulation

`sendChunksWithTyping()` calculates delays scaled to character count, bounded by
`minVisibleDurationMs` (750 ms) and `maxTypingTimeMs` (4,000 ms), with optional thinking pauses.
Delays poll the stop registry every 250 ms through `interruptibleDelay()` and exit promptly if a stop
or interrupt arrives.

## Dispatch and identity routing

`StreamUiUpdater.sendSinglePayload()` routes messages through one of two channels:

- **Webhook delivery:** Used when alter personas or render-modifier identity overrides are active.
  The updater routes sends through `dispatchWebhookWithIdentity()` with persona avatars and names.
  The initial message answering a source message sends a standalone reply notice built by
  `buildWebhookReplyNoticePayload()` under the same selected identity. Invalid webhook errors (Discord codes 10015 and 50027) trigger cache
  invalidation and retry with a recreated webhook.
- **Bot messages:** Used for the main persona's base appearance through single-attempt channel delivery,
  with native reply references when applicable.

`sendWebhookMessageWithIdentity()` and its batch variant use the managed pool dispatcher in
`webhookCore.ts`. Local avatars reuse verified image assignments across threads; a deferred avatar
PATCH can create an additional slot or deliver with Discord's generic avatar. Local-avatar selection
and sending hold one parent-channel lock, including the reply notice and its following body.
HTTPS overrides bypass that lock, and lifecycle lookup uses separate coordination.
The dispatch result includes the actual webhook ID and delivered identity; continuity records that
identity, including a generic-avatar fallback. Avatar fallback is decided before
the send operation; an uncertain POST failure propagates without another avatar-recovery send.

Streaming commits a `PersonaDeliveryReceipt` through `recordPersonaDelivery()` in
`src/utils/discord/webhook/personaPost.ts`. The receipt contains the actual message and destination
IDs, bot or webhook route, authoring webhook ID, delivered identity, speaker kind, and available
sprite metadata. A generic-avatar fallback records the generic avatar. Bot delivery clears webhook
adjacency; an alter's bot fallback has no visible persona attribution. Sprite mappings for history
reconstruction are written after successful webhook delivery.

`sendPersonaPost()` accepts the acting persona separately from a webhook hint. It resolves the
current base and inherits that persona's last committed own appearance in the destination channel.
Ordinary and identity sprites survive intervening user, bot, and other-persona messages. Copied
identities and explicit user impersonation cannot replace that memory. A delivered base revert
replaces the remembered sprite. With no memory, posts use the current base. The bounded appearance
store and its invalidators are described in [Caching](/architecture/subsystems/caching/).

Appearance memory is separate from the channel adjacency used to choose group-break usernames.
Adjacent posts retain the exact delivered username; later posts resolve the remembered sprite
against current sprite data. Webhook selection still uses the managed pool and the thread's parent,
while receipts and appearance state use the actual destination thread. Expressions, fallback notices,
media, and voice resolve the active persona through this same author contract, including tool-only turns.
The channel's last speaker never selects a later artifact's author.

The shared sender distinguishes `sent`, `pre_dispatch`, `definite_refusal`, and `unconfirmed`.
Avatar preparation finishes before dispatch, and cancellation is checked immediately before each
send. Held drafts publish no receipt or appearance until approved delivery. The stream may recreate
a definitely invalid webhook; an uncertain POST cannot trigger its webhook retry or bot fallback.
Raw voice and expression transports use the same author resolution and pool selection, then commit
one receipt containing the selected identity and authoring webhook ID. Standard sends use isolated
REST clients with transport retries disabled. A proven invalid-webhook refusal permits one recreation;
a definite component refusal permits the media helper's one component-free downgrade. Avatar recovery
finishes before POST. Lost responses, AbortError, and uncertain server failures end recovery.

`deliveryState` is shared by reference across provider contexts, tool delivery, and approved draft
presentation. Once a POST is unconfirmed, the turn clears held text and stops before response review,
key rotation, model fallback, or another tool call. The orchestrator suppresses error notices before
returning that failure. No successful receipt or appearance is inferred from that outcome. A
successful earlier message keeps its own receipt.

`context.deliveredMessageRefs` retains successful stream-body references across attempts. Button
expiry and reply-notice cleanup resolve each message's authoring webhook ID. The shared
`deliveryReceipts` array also receives successful reply notices, so each recorded delivery describes
the message that actually landed.

## Rendered markdown tables

Tables detected in stage 06 bypass `chunkMessage()`. They are rasterized to PNG via
`renderMarkdownTableToPng()` and delivered as attachments with an interactive `Show Markdown` button:

- Clicking the button replies ephemerally with the table's cached source markdown.
- Source text is read on demand from `markdownTableCache` rather than held in event closures.
- The button disables after `SHOW_MARKDOWN_BUTTON_TIMEOUT_MS` (2 hours), matching the cache TTL.
- Table atomicity in stage 05 guarantees the block arrives intact; see
  [stage 05 table atomicity](/architecture/pipelines/provider/05-buffer-management/#markdown-table-atomicity).

## Constraints and rationale

- **Deterministic stops over retries:** Hitting server `send_message_limit` or the safety cap
  `STREAMING_LIMITS.MAX_FLUSH_COUNT` (40 messages) queues an internal stop. Raising an error would
  trigger futile fallback retries against an unchangeable limit.
- **Quiet teardown for inaccessible channels:** If a channel is deleted or access is revoked
  (Discord error 10003 or 50001), `stopForUnreachableChannel()` terminates the stream without
  retrying.
- **Native reply limitations:** Webhooks cannot create native Discord reply references. The
  standalone reply notice provides the only visual link between an alter persona message and its
  source prompt.

## Source pointers

- `src/utils/discord/stream/messageDelivery.ts`: `StreamMessageDelivery` and typing simulation.
- `src/utils/discord/stream/uiUpdater.ts`: `StreamUiUpdater.sendSinglePayload` and webhook routing.
- `src/utils/text/processors/chunkProcessor.ts`: `chunkMessage` and span preservation.
- `src/utils/discord/markdownTableButton.ts`: interactive table button and cache interaction.
- `src/utils/discord/stream/channelDeliveryContinuity.ts`: delivered identity recording.
- `src/utils/security/rateLimiter.ts`: `STREAMING_LIMITS.MAX_FLUSH_COUNT` definition.
