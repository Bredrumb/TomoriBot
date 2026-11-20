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

She only remembers conversations she took part in. She updates a channel's summary when she replies,
and at no other time, so a busy channel where nobody talks to her leaves no memory. Each channel's
short-term memory expires after 24 hours by default. If you opt out under `/personal config`, your
messages are excluded from short-term memory.

Fresh short-term memory and memory carrying other channels' content sit just above the latest four
speaker turns. Older memory from this channel stays above the conversation at the default setting.
A configured shallower depth can keep the content closer to the latest message. See
[Inside The Prompt](/features/knowledge/inside-the-prompt/) for the full layout.

## Cross-channel example

- **Public channels:** You discuss an album recommendation with TomoriBot in `#music`. A few minutes
  later in `#general`, you ask what album she suggested. Because she replied in `#music`, she recalls
  that context in `#general`.
- **Private channels:** STM cannot enter or leave a private channel by default. This applies to
  summaries, memory fields, and recent raw messages, including recall between two private channels.

Channels that restrict viewing through Discord permissions are private automatically. Private threads
and threads under private channels are also private. Administrators can mark public text channels
private under `/config` > `Channels` > `Channel Rules`.

`Private-Channel STM Sharing` in that panel is `Blocked` by default. Choosing `Allowed` lets STM
enter and leave private channels and can expose private conversations elsewhere. This setting never
enables thought logs or cross-channel tools targeting private channels. Your cross-server recall
opt-in is still required for recall across servers, and the source server controls whether its
private-channel STM may leave.

## Managing short-term memory
<!-- anchor: managing-short-term-memory -->

You can view or correct the current channel's summary under `/config` > `Persona` > `Memories`.
Server managers can adjust parameters or disable short-term memory under `/config` > `Behavior` >
`Advanced Memory`, and review or clear active channel summaries under `/memories` > `Short-Term`.
`/refresh` clears the current channel's memory.
