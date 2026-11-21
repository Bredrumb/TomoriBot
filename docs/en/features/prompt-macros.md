---
title: "Prompt Macros"
sidebar:
  order: 5.5
---

Prompt macros insert current names, available tools, and other values when TomoriBot prepares a
reply. Use a conditional block to include an instruction only when it applies.

## Name Macros
<!-- anchor: names -->

Use name macros in saved prompts, attributes, sample dialogues, lorebooks, and memories.
In a context note, use `{@userId}`.

| Macro | What it inserts | Example |
| --- | --- | --- |
| `{bot}`, `{char}` | The active persona's name. | `You are {char}.` becomes `You are Lilya.` when Lilya is active. |
| `{user}` | The person who triggered the reply. In shared prompts, attributes, lorebooks, and server memories, it becomes `User`. In a personal memory, it names the person the memory describes. | In a sample dialogue, `Hi, {user}!` becomes `Hi, Mirri!` when Mirri triggers the reply. |
| `{user_formatted}` | The triggering user's name with the prefix and suffix the active persona uses. | Lilya's English preset changes `Hi, {user_formatted}!` to `Hi, Mirri-senpai!` for Mirri. |
| `{user_term}` | The active persona's address term for the triggering user. | Rose's English preset uses `fam` (neutral), `bro` (masculine), or `sis` (feminine). |
| `{@123456789012345678}` | The nickname of the Discord user with that ID, even when someone else triggered the reply. | With `Navigator` saved as their nickname, `Ask {@123456789012345678}.` becomes `Ask Navigator.` |

Named macros accept single or double braces and ignore case. For example, `{{char}}` and `{CHAR}`
both work. In a shared system or persona prompt, use `{user_formatted}` or `{user_term}` to refer
to the person who triggered the reply. These two macros stay as written in response prefills.
Set a neutral address term in the persona's Naming Habits before using `{user_term}` in its text.

### Refer to a specific Discord user
<!-- anchor: refer-to-a-specific-discord-user -->

Enable `Developer Mode` and copy the person's user ID. See
[Discord's guide to copying IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
Put the number after `@` inside single braces, as in
`Treat {@123456789012345678} as the ship's navigator.`

TomoriBot uses the person's nickname for the active persona, then their global nickname from
`/personal config` > Profile, then their Discord username. If the server disables personal
memories, the person is blacklisted, or their privacy is set to `Full`, she uses their Discord
username. If she cannot resolve a name, the macro stays as written.

Live chat keeps the macro as written, including chat quoted verbatim in short-term memory or
copied into a preset with `{{input}}` or `{{lastChatMessage}}`. An attribute shared through a
persona's public profile also keeps it as written when another persona reads it.

### Discord mentions and links

User mentions (`<@userId>` and `<@!userId>`) use the person's saved global nickname when personal
memories are enabled. They fall back to the server nickname or username, including for
blacklisted users. Use `{@userId}` to resolve a persona-specific nickname.

A channel mention (`<#channelId>`) or a Discord channel or message link supplies a readable
channel label when TomoriBot can resolve the channel. A role mention (`<@&roleId>`) becomes a
name such as `@Raid Guides` if the role exists in the current server. Unresolved role mentions
stay as written.

## Random choices

Use `{{random: north, south}}` or `{{random::north::south}}` to pick one option during prompt
assembly. The double-colon form can include commas within an option. Both forms also accept
single braces.

## Tool macros
<!-- anchor: tool-macros -->

Use a tool macro to insert the function name available to the current provider and model.
A built-in macro with no available tool expands to `an unavailable tool`. Put the instruction in
a [conditional block](#conditional-prompt-blocks) to omit it when the tool is unavailable.
For what each tool can do and which settings enable it, see
[Built-in Tools](/features/capabilities/tools-and-extensions/built-in-tools/).

### Built-in tool macros

| Macro | Function name for `tool:` conditions | Example standing instruction |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Use {capabilities_tool} to check what you can do here before promising a feature such as stickers or voice messages.` |
| `{memory_tool}` | `create_long_term_memory` | `Save lasting member preferences, such as favorite party games, with {memory_tool} so you can use them in future chats.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Use {memory_update_tool} to revise the existing memory when a member corrects a saved preference or a moderator changes a recurring event.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `At roleplay scene breaks, use {short_term_memory_tool} to record where the party stopped, what clues they found, and what they plan to do next.` |
| `{task_tool}` | `create_task` | `Schedule game-night and poll reminders with {task_tool} when members request them. Confirm the scheduled time afterward.` |
| `{task_update_tool}` | `update_task` | `Use {task_update_tool} to reschedule the existing reminder when a member changes its time or repeat schedule.` |
| `{cross_channel_tool}` | `cross_channel_message` | `When asked to publish event results, post them in #announcements with {cross_channel_tool} and report back here.` |
| `{create_thread_tool}` | `create_thread` | `When members explicitly ask for a spoiler discussion thread, use {create_thread_tool} and open with a question about the episode.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebrate raid clears with {sticker_tool} when the server has a sticker that fits the moment.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.` Available in development only. |
| `{youtube_tool}` | `process_youtube_video` | `Use {youtube_tool} when members ask about a specific move shown in a linked YouTube guide.` |
| `{image_analysis_tool}` | `analyze_image` | `When helping with an error screenshot, read the visible error with {image_analysis_tool} before suggesting a fix.` |
| `{image_generation_tool}` | `generate_image` | `For requested event banners, use {image_generation_tool} and leave room for the event title.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Use {anime_image_generation_tool} for requested anime-style roleplay art. Keep the characters' established outfits.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resolve character nicknames and alternate spellings with {tag_search_tool} before searching for fan art.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `When members ask to browse existing anime fan art, post a small selection with {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Send quest briefings and dramatic recaps with {voice_message_tool} when players ask to hear them aloud.` |
| `{block_user_tool}` | `block_user` | `Use {block_user_tool} to apply a persona mute when a moderator asks to stop a member from triggering you for a set time.` |
| `{unblock_user_tool}` | `unblock_user` | `Use {unblock_user_tool} to lift a persona mute early when a moderator asks.` |
| `{user_info_tool}` | `update_user_info` | `Save a member's requested nickname or honorific for this persona with {user_info_tool}.` |

`{pin_tool}` and `{timestamp_refresh_tool}` are compatibility aliases.

### Search and URL macros

These macros can select a server MCP tool in place of the built-in function. If neither is
available, they insert a description of the tool.

| Macro | What it selects |
| --- | --- |
| `{web_search_tool}` | A web search tool or the built-in `web_search`. |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | A search tool for the requested media, falling back to web search. |
| `{url_fetch_tool}` | A URL reader or the built-in `fetch_url`. |
| `{url_metadata_tool}` | An MCP tool that can inspect a URL, or the built-in `fetch_url`. |

## Conditional prompt blocks
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| Condition | When its branch appears |
| --- | --- |
| `{{if tool:<function_name>}}` | The exact tool is available to the provider and model. |
| `{{if capability:<name>}}` | The named capability is enabled. |
| `{{if tool_family:url_fetch}}` | The built-in URL reader or a server MCP replacement is available. |

Prefix the condition with `!`, as in `{{if !capability:time_awareness}}`, to test for its
absence. Use at most one `{{else}}` per block and close each block with `{{/if}}`. Nest blocks up
to 32 levels. Use nested blocks for multiple requirements.

Supported capability names are `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`,
`sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`,
`video_generation`, `voice_message`, `user_blocking`, `short_term_memory`, and `time_awareness`.
`tool_use` is false when the active model cannot call tools.

Tool conditions check the tools available when the prompt is assembled, including restrictions
from Deliberate Tool Mode. Discord permissions are checked when the tool runs. Unknown capability
names evaluate as false and produce a warning. TomoriBot omits malformed blocks and leaves
conditional tags as written if nesting exceeds the limit.

## SillyTavern preset macros
<!-- anchor: sillytavern-preset-macros -->

These additional macros work inside SillyTavern preset nodes. Preset nodes also accept the
identity, random-choice, and tool macros described above.

| Macro | What it inserts |
| --- | --- |
| `{{user}}`, `<USER>` | The member who triggered the reply. |
| `{{char}}`, `{{bot}}`, `<BOT>` | The active persona's name. |
| `{{personality}}` | The persona's attributes. |
| `{{description}}` | The persona's prompt. |
| `{{scenario}}` | Empty. Imported card scenarios become persona attributes. |
| `{{mesExamples}}` | Sample dialogue. |
| `{{lastChatMessage}}`, `{{input}}` | The latest user message in the supplied chat history. |
| `{{time}}`, `{{date}}`, `{{weekday}}` | Server time, date, or weekday in English, such as `3:45 PM`, `October 28, 2026`, or `Wednesday`. |
| `{{isotime}}`, `{{isodate}}` | Server time in `HH:mm` or date in `YYYY-MM-DD`. |
| `{{model}}`, `{{provider}}` | The configured model and provider IDs. Per-turn randomizer picks and fallback models leave these values unchanged. |
| `{{char_version}}` | Empty. TomoriBot stores no card version. |
| `{{roll:2d6}}` | The sum of a dice roll, up to 100 dice and 1,000 sides per die. |
| `{{// notes}}` | Empty. Use it for comments in the preset. |
| `{{trim}}` | Removes the node's leading and trailing whitespace. |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | Set or append text to a variable shared across the preset's nodes. |
| `{{getvar::key}}` | The variable's value, or empty if unset. |

`<USER>` and `<BOT>` are case-sensitive compatibility tokens. The five date and time macros use
one clock reading and the server's fixed UTC offset. Change the server offset when daylight
saving changes. All five are empty when Time Awareness is off. Place them in late or
depth-injected nodes to keep earlier text eligible for prompt caching.

### Preset conditionals
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

A bare name such as `description` means `{{description}}`. You can put a value macro directly
in the condition, as in `{{#if {{input}}}}`. TomoriBot ignores case and surrounding spaces when
it tests the value. Empty text, `false`, and `0` are false. Unrecognized value macros count as empty.

These blocks can nest with [tool and capability conditions](#conditional-prompt-blocks).
Close `#if` with `{{/if}}` and `#unless` with `{{/unless}}`. An unclosed preset block ends at the
end of its node. TomoriBot drops stray closing tags and `{{else}}` tags and omits blocks with
a second `{{else}}` or a mismatched closer. The 32-level limit also applies to mixed blocks.

Preset conditions see variable declarations earlier in the node order, including earlier in the
same node. Declarations inside a skipped preset branch have no effect. A `{{getvar::key}}`
outside a condition sees the final value after TomoriBot visits the enabled nodes. Tool and
capability conditions run after variable assignment.

## Verify a macro

Run `/tool prompt snapshot` for the persona and channel you want to check. Open the export and
look for the rendered instruction. Use `/context` to see which parts of the prompt take up
space. See [Inspecting the prompt](/features/knowledge/inside-the-prompt/#inspecting-the-prompt).
