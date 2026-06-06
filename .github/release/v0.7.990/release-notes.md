# v0.7.990 | Makeover Edition
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.990/liphel-outing.png)

Happy ~~Liphel~~ Pride Month! This major release is the buffer before 0.8.0.00, it already contains the major refactor changes to make TomoriBot prepared for further architectural changes, splitting up all the 1k+ line code files as well as general optimizations.

There are no *big* changes on the user-facing side, but there are a *lot* of new features and QoL changes. Bigger changes will come next release instead. Make sure to check out the https://github.com/users/Bredrumb/projects/1/views/1 to see all these upcoming changes:

## New Tomori Features
- You can now set Persona Attributes as "Public", which allows other Personas in chat to see them. Useful for physical appearance descriptions. It can be set through:
  - `/persona attribute` commands as a checkbox
  - Automatically set for physical appearance descriptions in `/persona generate`
- Added SearXNG as locally hosted alternative to web search
  - Mixes multiple 
- Added Crawl4AI as locally hosted alternative to URL fetching
  - Can parse 
- (For those running TomoriBot locally) You can now use `bun launch` instead of `bun run dev` which allows you to pass params that automatically launch servers if they are still not (eg. `bun launch --qwen3tts --searxng`)
- `/server nuke` command which deletes all server configs (optionally, you can set it to preserve personas)





## QoL and Bug Fixes
- You can now use .env variable `EMOJI_PRESERVE_UNRESOLVED_SHORTCODES`, if `FALSE` (default), emojis Tomori uses but don't actually exist in the server will get stripped from her responses
- After Tomori creates a Discord Thread, she now responds back to you to confirm her success
- Renamed `/server avatar` to `/persona avatar`
- Added automatic cache clearing upon reaching critical memory limits
- Sending follow-up replies for Persona A with a trigger for another Persona B now triggers Persona B instead of the currently responding Persona A
- Fixed bug wherein if main model cannot see images, it also causes fallback models to not see images
- Fixed bug wherein emojis were sometimes not getting converted as expected and are sent as-is 
- TomoriBot now reacts to messages more reliably since she now gets hints to use metadata reveal tool whenever it fails
- Fixed bug wherein random text becomes prepended: "the surface.Nerine: tilts head slightly, reaching up to tap the back of her own neck"
- Tool calls now timeout after 5 minutes of not returning any result, will reset when chaining tools (.env configurable, late results will still be sent)
- Improved expression sending/isolation chunking behavior (when list, don't isolate, if in between words in an incomplete sentence, don't isolate)
- `/personal provider add` now blocks users trying to choose "Custom Endpoint" which is deprecated
- Removed emoji auto-parsing from `/tool comment` (already supported by Discord itself)
- Fixed bug wherein OpenRouter errors are not having their full details rendered in the error embed (eg. code 503 not detailed/put into chat (JSON SSE))
- Fixed bug wherein when using own avatar as reference image, it doesn't use the proper avatar (alter/main)
- Fixed bug wherein personal image providers were being counted as server image quota
- Fixed bug wherein Google and Vertex providers' image models were silently ignoring reference images
- Critical errors that occur during chat admission checking now do not surface an error embed randomly in chat
- Fixed bug in GCP wherein data URIs were always being rejected in functions requiring images due to too strict validation
- Fixed bug wherein ST Presets with blank nodes crash `/st-preset node toggle`
- Fixed bug wherein Persona Prompts are being catalogued as System Prompts in `/tool prompt snapshot`
- Added "(Free)" to `/setup` and `/provider add` choices
- When reminders trigger during a message and get queued, they now do not lose reminder data
- Fixed bug wherein if sending a follow-up/natural stop to a failing text model, Fallback Used button appears upon retry
- Fixed bug wherein /persona swap would use stale avatar of the main persona
- Fixed bug wherein cross-channel tool for peeking would return the wrong message authors, and return messages in the wrong order
- GIF Downloads now timeout within 3 seconds to prevent hangs (.env configurable)
- "Validating API Key..." text now doesn't show twice in embed for adding providers/setup
- Fixed bug wherein stuck channel locks cannot be removed (even with `/bot kill`) without restarting the bot
- Fixed bug wherein TomoriBot fails to parse content from VertexAI Embedding Models properly
- Fixed bug wherein the system attributes sent images by Alters as the Main's sent images instead
## Dev-facing
- Added multiple tests with `bun run tests`
- Added `bun run vl` which will be the main blocker/standard for code contributors
- Moved TTS/STT Python server files from `/scripts/` into `/servers/`
- Moved ComfyUI workflows from `/scripts/` into `/assets/comfyui-workflows/`
- Decomposed seed SQL scripts to readable .ts files in `/src/db/` to make it easier to edit model seeds and persona seeds.
- Editing default Tomori persona seeds in `/src/db/seed/catalog/personas.ts` will now update it for everyone using the same unmodified Tomori preset (users would still have to re-import if they want to get the update avatar image)
- Patched thought leaking bug in some models by cleaning LLM output as it comes out if it appears before a speaker tag eg. "i like applesNerine:"




## Persona Updates





## PLANNED Updates
These are NOT yet implemented, just here to state what to expect in the following updates in the coming weeks:
