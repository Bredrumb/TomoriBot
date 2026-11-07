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
- **Private channels:** If that conversation happened in a private channel, she will not recall it in
  `#general`. Summaries from private channels stay isolated unless an administrator enables STM Privacy
  Bypass under `/config` > `Permissions`.

## Managing short-term memory
<!-- anchor: managing-short-term-memory -->

You can view or correct the current channel's summary under `/config` > `Persona` > `Memories`.
Server managers can adjust parameters or disable short-term memory under `/config` > `Behavior` >
`Advanced Memory`, and review or clear active channel summaries under `/memories` > `Short-Term`.
`/refresh` clears the current channel's memory.
