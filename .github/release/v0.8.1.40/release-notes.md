# v0.8.1.40 | Playful Interactions

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.8.1.40/playful-interactions.webp)

~~Waiter, waiter, more girls kissing pls.~~ This minor update lets your daughters and sons kiss each other or you, wholesomely ofc. Oh and some other changes that help users using Tomori for RPGs, like dice rolls, lorebooks, and better RAG. Long due optimizations have also been done to help keep TomoriBot feelin more snappy and more efficient with token use and its checks (I dont want TomoriBot to become as bloated as Windows 11 even if you so happen to have turned on all of her optional features)

## New Major Features

### Better Interactions
- TomoriBot can now use /reward and /punish on other personas (and users) as a new tool. Persona-targeted calls of this tool cause `conditioning` to save permanently (manage with `/conditioning manage`), so personas can somewhat influence their relationships with others. Disable this tool through `/config > Plugins > Available Tools`
- `/reward` and `/punish` can now be used on Users, just for fun (doesn't do anything but post an embed named after the user)
- `/reward`ing a Persona now makes them much more likely to Idle Nudge you (more than simply messaging would)
- Reward/Punish commands now have random flavor text when executed

### TTRPG Tools
- `/roll` dice Command (useful for users using TomoriBot to play tabletop RPGs on Discord). For now, a simple command that allows you to pick the dice, choose visibility, and Advantage/Disadvantage rolls
- Tool for rolling dice for Tomori to use herself, can be disabled through /config > Plugins > Available Tools
- Will be the first of some other RPG game tools to be given TomoriBot (such as enemy/npc creation on the fly), which would be largely opt-in as to not bloat TomoriBot's context with tools users would not use

### Lorebooks
- Supplementing TTRPG tools, TomoriBot now supports lorebooks through `/memories > Lorebooks`. These basically work like memories but are tied to more advanced keyword matching (like SillyTavern) and cannot be updated/created by TomoriBot herself. A completely optional feature, only for those who use TomoriBot with more comprehensive worlds and miss SillyTavern's lorebook feature
    - Importing SillyTavern cards now also import their lorebooks. You can now also import lorebook .jsons as well.

## MCP OAuth
You can now connect to MCPs through OAuth browser flows provided by your chosen MCP securely and directly from TomoriBot instead of having to dig and find a valid auth token for your chosen MCP. This makes it much easier for both technical and non-technical users to connect their MCP servers

## Minor Features
- New users can now choose tools/features they want inside `/setup`'s "Choose Starting Settings" modal
- Added new `Advanced` section in `/config > Plugins > Natural Nudges` that allow you to change the probabilities of each Idle Nudge category as well as inflate/deflate frequency manually.
- You can now optionally select a model in `/generate` commands. Useful if you want to test out the output of various models without having to go to `/config > Models` everytime.
- Personas can now pass sprites as an optional parameter when sending voice messages or playful interactions
- Idle Nudges, Reminders/Tasks, and Random Triggers now log their tool call embeds in your Logs channel
- When TomoriBot uses a persona/user as a reference and they have a character reference image uploaded, it opts to use that image instead of the user's avatar
- TomoriBot now receives full tool call error details (sanitized to prevent sensitive info leakage), so she can fix them with you, and/or tell you what went wrong
- Whenever TomoriBot generates a NSFW video or NSFW image, she can now add spoiler tags unto them
- `/generate` commands now have an optional `nsfw` parameter wherein setting it to true will add a spoiler tag unto the generated media.
- `/booru search` now accepts an optional `count` option that allows you to increase/decrease returned images (1-10)
- Increased default fetched chunks from 6 to 10, given that they're actually relevant

## QoL and Bug Fixes
- Idle Nudges are now less repetitive in terms of topics given (Planner is now aware of recent previous topics already done)
- Newly uploaded documents since this update now have chunks split cleanly (at headers, sentence punctuation, etc.) instead of being cut-off mid-sentence
- Improved document search for Japanese, Chinese, and Russian text for RAG
- Idle Nudges are nerfed, now occurring less frequently across the board, especially if there's lower activity with a low frequency like `Gentle` (up to ~30% less idle nudges) or `Rare` (up to ~70%). Active Nudges are unchanged
- Added better notices, warnings, and clues to users for lots of slash command panels
- Improved tool prompting for image generations that use image references (TomoriBot is now more likely to use the correct tools and references).
- When Model Randomizer is on, the used model is now always logged in the Logs channel for easy tracking
- Made failed sprite attempts more forgiving (messages that open up with just `(happy):` instead of `Tomori (happy):` are now accepted)
- `/compact`'s "save as document" button is now available immediately instead of being delayed.
- Natural nudges now gracefully retry attempts if a transient DB error occurs mid-planning/mid-check
- TomoriBot can now delete within-server reminders/tasks of other people when she is asked by a server manager to do so
- Idle Nudges, random triggers, and reminders now no longer attribute stats to fake user rows, instead it attributes it to itself
- `/tool prompt snapshot` is now an ephemeral reply that attaches its file inside the embed instead of a DM
- Asking TomoriBot to set a reminder/task monthly now prevents drift (instead of setting it to recur a flat 30.44 days everytime, you can now). See Issue #115
- Fixed a bug where TomoriBot can save invalid reminder dates, such as February 31 which were silently moved into the following month. See Issue #114.
- You can now set month intervals through `/scheduled-task edit` more reliably
- Fixed bug wherein Idle Nudge planner doesn't take into account channels and channel descriptions
- Fixed bug wherein Blacklist cache check errors show a user-facing error saying you are blacklisted
- Fixed bug wherein forwarding an image, and then making a thread using the forwarded image makes the image invisible to TomoriBot inside the thread.
- Fixed bug wherein Nudges are not able to cause any triggers to other personas
- Fixed bug preventing `/stats personal` from actually executing
- Fixed issues involving messages reaching null-pointer exceptions and unresolvable channels
- Fixed bug involving race conditions whenever turns happen while models are being switched
- Fixed bug wherein personas with names with 32+ text characters would be impossible to edit
- Fixed bug wherein Anthropic would sometimes fail to initialize whole batches expressions due to bad image data of even just one (now it skips that image instead of failing all)
- Fixed bug wherein submitting a large payload request to NVIDIA NIM could cause large short memory spikes
- Fixed Vertex Express API key validation
- Fixed bug wherein Google Flash Lite TTS would always fail to generate speech
- Fixed bug wherein Persona names with emojis would count towards the max character limit for names more than normal text
- Fixed an admittedly funny bug wherein personas could have Reunions with each other (Lilya why didn't you talk to me for 30 days???)

## Optimizations
TomoriBot is one beeg singleton process and when handling tons of requests (such as deployed prod), it can actually add some seconds on TTFT in the very worst cases

TomoriBot should now feel more snappy and less costly thanks to the following changes, but most of the savings of TomoriBot can only be achieved by cutting prompt sizes by disabling tools, making prompts concise, etc.:
- Idle Nudge planners now cap the context fetched from target persona instead of dumping their whole prompt, saving in input token costs
- Less waiting before Tomori sends its request to your provider/endpoint by making the pipeline do database checks and context fetches in parallel.
- Faster back-and-forth in conversations with multiple personas by reusing most of message history instead of fetching whole message history again everytime (+ guards to prevent stale messages)
- Fewer repeated delays in chats containing images or replies to older messages caused by repetitive Discord fetches.
- Removed bottleneck where TomoriBot was fetching each message's reaction's users upon every trigger (now she only sees count of reacts and has to deliberately call the metadata tool to see who exactly)
- Document look-up now happens earlier in the chat pipeline, reducing chat latency further

## Content Additions
- Default personas now have tentative character reference images each, helping with character-referenced image generation
- Anima workflows for TomoriBot in `/assets/` has been updated and split into two types:
  - Anima Turbo: Uses the v1.1 turbo model of Anima, 3x faster at generating
  - Anima (detailed): Uses the Aesthetic model of Anima with extra face detailer and hand detailer nodes, slower at generating but prettier generations
  - Overall improvements: Anima workflows now upscale the result by 2x (both Turbo and detailed) as well as have better character referencing
