---
title: "Short-Term Memory"
sidebar:
  order: 5
aiGenerated: false
---

TomoriBot reads recent messages in the active channel. Short-term memory (STM) extends this by keeping
temporary working context:

- **Channel context:** Reinforces the ongoing topic or situation in the current channel.
- **Cross-channel context:** Recalls recent conversations from other channels, and across servers when
  cross-server recall is enabled.

TomoriBot keeps short-term memory for conversations she takes part in. When automatic summaries
are on, she refreshes the summary every 10 replies by default. The summary runs in the background
as a separate request to the same model, so your reply arrives without waiting for it. The extra
request is billed to the same API key as the reply, including your personal key if you used one.

Automatic summaries work with Tool Use off and with models that cannot call tools. The provider
must support conversation summaries. NovelAI can still recall short-term memory and use summaries
you edit manually.

Short-term memory expires after a period of inactivity. If you opt out under
`/personal config`, your messages are excluded from short-term memory.

Fresh short-term memory and memory carrying other channels' content sit just above the latest four
speaker turns. Older memory from this channel stays above the conversation at the default setting.
A configured shallower depth can keep the content closer to the latest message. See
[Inside The Prompt](/features/knowledge/inside-the-prompt/) for the full layout.

## Cross-channel example

- **Public channels:** You discuss an album recommendation with TomoriBot in `#music`. A few minutes
  later in `#general`, you ask what album she suggested. Because she replied in `#music`, she recalls
  that context in `#general`.
- **Private channels:** By default, STM from a private channel stays there. This applies to
  summaries, memory fields, and recent raw messages, including recall in another private channel.
  Private channels still recall STM from public channels.

Channels that restrict viewing through Discord permissions are private automatically. Private threads
and threads under private channels are also private. Administrators can mark public text channels
private under `/config` > `Channels` > `Channel Rules`.

`Private-Channel STM Sharing` in that panel is `Blocked` by default. Choosing `Allowed` lets STM
leave private channels and can expose private conversations elsewhere. This setting never
enables thought logs or cross-channel tools targeting private channels. Your cross-server recall
opt-in is still required for recall across servers, and the source server controls whether its
private-channel STM may leave.

## Managing short-term memory
<!-- anchor: managing-short-term-memory -->

You can view or correct the current channel's summary under `/config` > `Persona` > `Memories`.
Server managers can change how often summaries refresh, set their own instructions for the
summarizer, or turn automatic summaries off under `/config` > `Behavior` > `Advanced Memory`.
They can review or clear active channel summaries under `/memories` > `Short-Term`.
`/refresh` clears the current channel's memory.

Use `{@userId}` in a summary or category to insert the person's current persona-specific nickname
when TomoriBot recalls it. See [Prompt Macros](/features/prompt-macros/#refer-to-a-specific-discord-user).
