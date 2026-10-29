---
title: "Deliberate Tool Mode"
sidebar:
  order: 4
---

Deliberate Tool Mode is experimental. It shows the model task tools only when a message appears to
need them. This keeps the prompt smaller and can help local or smaller models respond faster. The
model still decides whether to use an available tool.

## How triggers work

TomoriBot uses keywords and regular-expression patterns to match common requests, such as searching
the web, setting reminders, and generating images. This is a best-effort match: an unfamiliar phrase
may not make the right tool available. Recognized follow-ups such as "do that again" can reuse a
recent tool request.

For example, these messages can make the corresponding tools available:

```text
Search the web for local events.     → web search
Generate an image of a red panda.   → image generation
Do that again, but with a hat.      → a recent tool follow-up
```

The patterns look for wording rather than understanding the request. For example, an image request
can match a pattern like this one, which looks for an action followed by an image-related word:

```regex
\b(generate|create|make|draw)\b.*\b(image|picture|photo|pic|img)\b
```

She also checks for attachments and links in the triggering message or the message it replies to.
Media elsewhere in the conversation does not trigger its reading tool. Triggers for all supported
languages are checked regardless of your language setting.

Sticker selection can remain available for spontaneous replies, and short-term memory can update
without a request. Normal permissions and restrictions still apply.

## Settings

Server managers can enable the mode and add custom tool triggers under `/config` > `Behavior` >
`Experimental Behavior`. Users can override the mode for themselves in `/personal config`.

:::tip
If a phrase you use often does not trigger a tool, add it as a custom trigger. A trailing `*` on a
literal phrase matches words that start with it: `remind*` matches both `reminder` and `reminding`.
Custom triggers can also use regular expressions.
:::

If a log channel is configured, successful tool calls include the trigger that made the tool available.
