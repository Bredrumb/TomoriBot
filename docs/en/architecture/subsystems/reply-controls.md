---
title: "Reply Controls"
aiGenerated: true
---

TomoriBot posts one button row below the final streamed message of a reply. The row is a separate
Discord message because adding or removing components on the reply would mark it "(edited)".

## Delivery and lifetime

The chat handler offers the row for the last persona that delivered text in the invocation. The
reply's delivery receipt identifies the bot or the webhook and records the delivered name and
avatar, including sprites. The row uses that identity and omits a reply reference so Discord can
group the messages. A restored row keeps the original webhook ID even if a different pool slot has
the right avatar. If the webhook cannot post an interactive row, the bot sends it as a reply to
the original message. An unconfirmed webhook send ends the attempt to avoid duplicate rows.

The shard owner tracks one offer per channel. A newer channel message hides the row, and deleting
newer messages can restore it. The latest-message check excludes the row and related deliveries
from the same turn. An accepted Retry or Continue, a newer persona reply, or `/refresh` retires the offer. After a restart,
rows left in Discord answer with a stale-control receipt. Discord can give a restored row its own
header when too much time has passed for grouping.

The gateway can deliver the row before the send returns. The observer recognizes it by its
`reply-controls:` component ID and the bot author or webhook application ID. Chat history skips
rows, including bot fallback rows that reference the reply. Private interaction receipts leave the
row visible.
[Discord message object](https://docs.discord.com/developers/resources/message#message-object)

## Button contract

Register each action in the `reply-controls:v1:<action>:<locale>` route. Define when it is offered,
who can use it, and how it acknowledges the interaction.

| Action | Offered when | Access | Acknowledgement |
| --- | --- | --- | --- |
| `↻` Retry | Retry is enabled for an eligible server chat turn | Member who prompted the reply | Defer the update after authorizing the press, then check live history under the channel lock |
| `→` Continue | Continue is enabled for an eligible server chat turn | Member who prompted the reply | Defer the update after authorizing the press, then check live history under the channel lock |
| `Fallback Used` | The generation result includes visible fallback details | Anyone who can see the row, including in DMs | Open the modal in the presser's locale or reply privately if stale |

Reply privately when the press fails the authorization check. Opening fallback details leaves the
row visible. Use secondary buttons with text labels so their color follows the Discord theme.
Arrows indicate actions that change the conversation. See the arrow codepoints in the [panel layout policy](/contributing/policies/panel-prose-and-layout/#selects).

`src/utils/discord/fastRegeneration.ts` owns the row and its lifetime.
`src/utils/discord/interactions/replyControlsRoute.ts` handles button presses.
