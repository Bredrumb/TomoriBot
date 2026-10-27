---
title: "Dice rolling"
sidebar:
  order: 5
---

Use `/roll` for tabletop games and roleplay, or ask TomoriBot to roll during a conversation.
The command supports dice notation such as `3d4`, `d20`, and `2d6+3`, including advantage and
disadvantage for a single d20.

The `visibility` option controls who receives the result:

| Choice | Channel visibility | Bot chat context |
|---|---|---|
| `Public` (default) | Everyone | Excluded |
| `Hidden` | Only the person rolling | Excluded |
| `Public + Bot` | Everyone | Included in recent history |

`Public + Bot` does not start an AI reply. People can still tell the bot the
result of an unshared roll themselves.

Server managers can control whether TomoriBot rolls dice with `Dice Rolling` under `/config` >
`Plugins` > `Available Tools`. This does not affect `/roll`. Her own rolls are public and included
in her conversation context.
