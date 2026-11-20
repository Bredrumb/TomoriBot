---
title: "Inside The Prompt"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot groups instructions and memories above the conversation, then places changing information
near the latest messages. [NovelAI](/features/integrations/novelai/) uses a separate layout, and
[SillyTavern presets](/features/integrations/sillytavern-support/) can rearrange the earlier blocks.

| Position | What TomoriBot receives | Where to manage it |
|---|---|---|
| System part | System, channel, and persona prompts; persona attributes; tool guidance; server information; persona-user restrictions; server memories; emojis, stickers, and sprites; Always On lorebook entries; conditioning. | `/config`, `/memories`, `/moderation`, `/expressions`, and `/conditioning` |
| Above the conversation | Participant profiles, aliases, personal memories, reminders, and persona tasks; older same-channel short-term memory at its default position; text tool definitions when needed. | `/personal memories`, `/memories`, and `/config` |
| Examples and conversation | Sample dialogues, followed by recent messages from this channel. | `/config` > Persona > Identity & Personality; Behavior > General Behavior |
| Just above the latest four speaker turns | Fresh short-term memory or memory carrying other channels' content, keyword- or chance-activated lorebook entries, retrieved documents, participant presence, and the current time with the channel line. | `/memories` and `/config` |
| Among recent messages | Context notes at your chosen depth, plus tool and time-awareness reminders. | `/config` > Behavior > General Behavior; Persona > Advanced; Channels > Channel Overrides |

A speaker turn groups consecutive messages from one person or persona. Four speaker turns can contain
many messages. In a short conversation, TomoriBot counts back into adjacent sample dialogues where
available. Short-term memory can sit closer to the latest message if you configured a shallower depth.
Empty optional blocks cost no tokens.

Recent messages grow within a range, then drop older messages in a batch. The batch is 30% of your
message limit, rounded down to an even number. With the default limit of 80, the batch is 24: a full
window keeps its starting message while new messages arrive, then advances by 24 when it would exceed
80. A typical two-message exchange leaves 58 messages after that advance. Short conversations,
refreshes, and the model's available space can leave fewer messages.

A context note placed earlier than the changing-information group moves through older history on
every bot response and makes prompt caching less effective. Keeping it near the latest message
avoids that extra cache disruption.

:::tip
Some models use information near the beginning or end of a long prompt more reliably than information
in the middle. For providers that use context notes, try placing an instruction near the latest message.
The effect depends on the model and task. See [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)
and [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

### Inspecting the prompt

- `/tool prompt snapshot` saves the prompt after trimming to fit the model. The download card reports
  what was cut.
- `/context` shows a visual breakdown of context usage and estimated input cost.
- `/tool estimate cost` breaks down the prompt by size and cost.

### Context fitting

The message limit sets how far back TomoriBot looks. Fitting starts with the history selected within
that limit. For most providers, the input budget is what remains of the model's context window after
reserving room for the reply and allowing for estimation error. At 150%, the prompt needs one and a
half times that input budget before trimming.

When the estimate exceeds that budget, TomoriBot drops the oldest chat exchanges in batches and
keeps the latest request. Fixed content such as instructions and sample dialogue can leave the
prompt over budget after all eligible exchanges are gone. TomoriBot fits the text first. When tool
schemas are included in an inspection, the fitting warning also checks their estimated size.
The provider applies its own chat template and token count. It may trim more context or reject
an oversized request.

NovelAI counts tokens from its rendered prompt and caps memory separately. It can cut sample
dialogue, memories, and older chat turns, then reduce the reply cap. The inspection and export
details are in [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/).

### Where are Tools defined?

For providers with tool calling, TomoriBot sends tool definitions through the provider's supported
interface.

### Why does TomoriBot forget?

| What happened | Why |
|---|---|
| She forgot something from earlier today | It scrolled past the message limit without being saved as a long-term memory. |
| She forgot something in another channel | Recent messages are channel-specific. Server memories, participant memories, and short-term memory provide selected information from other channels. |
| `/refresh` made her forget | Refresh cuts off Recent messages and clears this channel's Short-term memory, but shouldn't remove long-term memory. Delete the refresh embed to remove the cut-off. |

If you want something to survive all of the above, it has to become a long-term memory. See [Memory](/features/knowledge/memory/long-term-memory/).
