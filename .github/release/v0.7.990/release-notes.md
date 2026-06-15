# v0.7.990 | Makeover Edition
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.990/liphel-makeover.webp)

Happy ~~Liphel~~ Pride Month! This major release is the buffer before 0.8.0.00, it already contains the major refactor changes to make TomoriBot prepared for further architectural changes ~~and so I can let people test it more before moving on~~, splitting up all the 1k+ line code files as well as general optimizations (hence, Makeover, considering Personas can now handle physical appearances better this edition too!)

There are a *lot* of new features and QoL changes so I decided to split it up from 0.8.0.00, bigger changes will come next in that release instead. Make sure to check out the [full roadmap](https://github.com/users/Bredrumb/projects/1/views/1) to see all these upcoming changes. For now, here's the current list of Makeover Edition changes:

**Do NOT forget to `bun run backup` before pulling all new changes from `main`!**

## New Tomori Features
- Added `/server channel-prompt` command which adds a prompt to a channel, either appending to the system prompt or replacing it when Tomori is triggered inside it based on chosen setting
- You can now set Persona Attributes as "Public", which allows other Personas in chat to see them. Useful for physical appearance descriptions. It can be set through:
  - `/persona attribute` commands as a checkbox
  - Automatically set for physical appearance descriptions in `/persona generate`
- `/image-tags` is now decoupled from NovelAI, serving as a general reference for image generation Tomori can use. It is public to all personas present in context. It is now split into:
  - `/personal image-tags` = comma-separated tags of *your* appearance
  - `/server image-tags default positive|negative` = image tags that are automatically prepended to all image generation requests done in the server
  - `/persona image-tags` = comma-separated tags of a persona's appearance
  - Use `/image-tags` if you want to help guide image generations relying on comma-separated tags, otherwise you may just use a public `/persona attribute` to describe a persona's appearance.
- TomoriBot can now edit and remove reminders by herself through tools, just ask her to! Only successfully executed if the invoker is the owner of the reminder.
- Created memories and tasks success embeds now show an "Expand" button whenever they exceed the max character count which reveal the full text ephemerally
- Added [SearXNG](https://github.com/searxng/searxng) as locally hosted alternative to web search
  - Mixes multiple search engines for reliability (supports images, videos, music, etc.), doesn't use cookies, and sends randomized headers to protect your privacy (you still need a VPN to cover your IP address, if you want maximum privacy)
  - To run, set `SEARXNG_BASE_URL=http://searxng:8080/` in .env then launch `docker compose --profile searxng up -d` or `bun launch --searxng` or see the [full guide here](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/docs/guides/setup-searxng.md)
  - Deployed TomoriBot now uses SearXNG instead of DDG which will make its search more reliable
- Added [Crawl4AI](https://github.com/unclecode/crawl4ai) as locally hosted alternative to URL fetching
  - Uses a headless browser that can handle lazy-loaded content (websites using JavaScript)
  - Automatically formats websites into LLM-friendly .md format
  - Handles proxy routing and user agent rotation to avoid bot limits like in Reddit
  - Can take screenshots of websites (this one specifically is not yet integrated into TomoriBot)
  - To run, set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` in .env then launch `docker compose --profile fetch-crawl4ai up -d` or `bun launch --crawl4ai` or see the [full guide here](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/docs/guides/setup-crawl4ai.md)
- (For those running TomoriBot locally) You can now use `bun launch` instead of `bun run dev` which allows you to pass params that automatically launch servers if they are still not running (eg. `bun launch --qwen3tts --searxng`)
- Added "Import Now" button to `/persona` creation and generation embeds, can only be pressed by users with Manage Server permissions
- (Thanks Palinalif!) Added `/deliberate-tool-mode` which causes tools to only appear if a specific keyword corresponding to it is present in the last X messages in context. Useful for saving tokens and improving latency at the cost of potentially losing on-the-fly tool calls
  - Currently simply uses best-effort RegEx patterns to detect keywords 
  - `/deliberate-tool-context` = Adjusts how many last X messages Tomori checks for any tool keywords (default is last 3 messages)
  - `/deliberate-tool-trigger` = Add custom keywords for specific tools, supports RegEx. A tip is to use the `^` RegEx if you want a tool to *always* appear in context. LLMs have an "attention economy" meaning that the less tools there are, the more likely they are to use it, so having only memory saving tool for example makes your Tomori more likely to save memories.
- (Thanks Baetican!) `/memory tagging set` = Command that toggles memory tagging behavior, defaults to off (see `/help memory-tagging` to learn more) 
  - Memory tagging toggle now supports channel tags, meaning you can now restrict memories/documents/history to only certain channels
- (Thanks Baetican!) Various improvements to `/tool compact`:
  - You can now edit the prompt used by the compact subagent upon command launch, picking between Conversation/Roleplay/Manual modes
  - You can now edit the resulting summary by pressing the Edit button below the summary embed
  - Simplified the tool's Roleplay mode to send plaintext instead of forceful structured output
- (Thanks Palinalif!) Added Inpainting/Outpainting (img2img) functionality to TomoriBot's image generation tool. Use the [provided ComfyUI workflow in the repo](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/assets/comfyui-workflows/tomoribot-anima-v1-comfyui.json) to use it! (updated to use base Anima v1 instead of preview Anima v3, and now randomizes seeds properly as well)
- (Thanks Palinalif!) Added extra options in `/custom-endpoint add|edit` commands for image models wherein you can enable/disable capabilities such as img2img
- Added a "Negative Prompt" option in `/custom-endpoint add|edit` for image models wherein if True, TomoriBot can pass in negative tags unto the prompt (`/image-tags default-negative` is automatically added as well to it)
- `/initialize expressions` now loops automatically until it processes all emojis and stickers (fails if it gets stuck)
- You can now register multiple same-capability models under the same Custom Endpoint label, eg. useful if you want to have different workflows for "comfyui" which can be selected with `/model image`
- `/server nuke` command which deletes all server configs (optionally, you can set it to preserve personas)
- `/custom-endpoint add|edit` for text models now show compatibility settings that help prevent rejections from providers that have strict API request formats (eg. Anthropic through a proxy)

## QoL and Bug Fixes
- Generate image tool now only exposes possible parameters ONLY if it is supported by currently configured image model, stopping previous fail-first behavior which saves tokens and latency
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
- Patched thought leaking bug in some models by cleaning LLM output as it comes out if it appears before a speaker tag eg. "i like applesNerine:"

## Dev-facing
- Refactored lots of modules within Tomoribot (see the full [PR](https://github.com/Bredrumb/TomoriBot/pull/34) here) 
  - For those using db viewers to edit memories/attributes: the following tables are now deprecated, edit the alternative tables instead:
    - `tomoris` → `personas`
    - `tomori_presets` → `persona_presets`
    - Column `tomori_id` → `persona_id` (across all related tables)
    - Column `tomori_nickname` → `persona_nickname`
    - Preset columns: `tomori_preset_id/name/desc` → `persona_preset_id/name/desc`
- Added multiple tests with `bun run tests`
- Added `bun run vl` which will be the main blocker/standard for code contributors
- Moved TTS/STT Python server files from `/scripts/` into `/servers/`
- Moved ComfyUI workflows from `/scripts/` into `/assets/comfyui-workflows/`
- Decomposed seed SQL scripts to readable .ts files in `/src/db/` to make it easier to edit model seeds and persona seeds.
- Editing default Tomori persona seeds in `/src/db/seed/` will now update it for everyone using the same unmodified Tomori preset (users would still have to re-import if they want to get the update avatar image to respect Discord rate limits)

## Persona Updates
Persona updates such as these are automatically applied to ALL servers using default presets, assuming you haven't changed their attribute/sample dialogue/name/avatar (which would unsync it). 

Do note that for Avatar updates, you still have to re-import this default persona (memories will not disappear even after you `/persona remove` a persona)
- Updated all personas to now have public attributes that describe their physical appearance, making it easier to ask the sisters on generating pictures of them together
- Updated Aphel's avatar and appearance to be purble
- Updated Lilya's avatar and appearance to have cute twintails
- Updated Aphel's "likes" to include "Lilya"
- Updated Lilya's "likes" to include "Aphel"
- Nerine now doesn't randomly search for text model 
- Nerine now doesn't have her forehead exposed in her physical appearance description
- Nerine's title has been changed from "Professional Tomori" to "Loyal Tomori"
- Updated Professional Tomori's lore description

## PLANNED Major Feature Updates
These are NOT yet implemented, just here to state what to expect in the following updates in the coming weeks:
- STM improvements + customization
- PluralKit support (personas would recognize systems)
- TomoriBot "random"ly nudging you, commenting about your day, your activity, memories about you, etc.
- "Aquarium" Command that allows users to create a ~~simulation~~ channel containing their fake, LLM versions wherein they randomly interact and grow with each other
- Zaya (Temari Rework)