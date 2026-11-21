---
title: "Prompt macros"
sidebar:
  order: 3
---

Use a prompt macro when a saved instruction needs a name or tool that can change. TomoriBot fills in
the current value when she prepares a reply.

## Names

| Macro | What it inserts |
| --- | --- |
| `{bot}` or `{char}` | The active persona's name. |
| `{user}` | The current user's name in sample dialogue, preset instructions, and response prefills. Shared system, channel, and persona prompts, attributes, and lorebook entries use `User`. |
| `{user_formatted}` | The current user's name with its prefix and suffix, where those values are available. |
| `{user_term}` | The active persona's address term for the current user, when set. |
| `{@123456789012345678}` | The nickname of the Discord user with that ID, even when someone else triggered the reply. |

The named macros also accept double braces, such as `{{char}}`. Use single braces for a Discord user ID.

### Refer to a specific Discord user

Enable `Developer Mode` and copy the person's user ID. See
[Discord's guide to copying IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
Paste that number after `@` inside braces, as in
`Treat {@123456789012345678} as the ship's navigator.`

TomoriBot uses the person's nickname for the active persona, then their global nickname from
`/personal config` > Profile, then their Discord username. If the server disables personal
memories, the person is blacklisted, or their privacy is set to `Full`, she goes straight to
their Discord username. If Discord can't supply a username and there's no usable nickname, the macro
stays as written.

Use this macro in system, channel, and persona prompts, persona attributes, sample dialogue,
lorebook entries, SillyTavern preset instructions, or the server response prefill. It stays literal
in live chat, including when a preset copies the latest message into an instruction.

## Tools and presets

Use [tool macros and conditional blocks](/features/capabilities/tools-and-extensions/built-in-tools/#conditional-prompt-blocks)
when instructions depend on a tool available for that reply. For example, put a reference to
`{memory_tool}` inside `{{if tool:create_long_term_memory}}` and `{{/if}}` so it appears only when
the persona can save a long-term memory.

[SillyTavern presets](/features/integrations/sillytavern-support/#preset-macros) also support
variables and macros for persona descriptions, dates, and other preset values.
