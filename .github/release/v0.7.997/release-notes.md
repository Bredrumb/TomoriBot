# v0.7.997 | Sprites Update
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.997/sprites-update.webp)

Just a minor update *just* before the bigger v0.8.0.00 Release. This patch allows you to give your personas Sprites which are basically alternative avatars for your bot based on the expression (or identity) they wish to show for their response. Yes, Discord avatars are very small but its usage doesn't require any extra API calls so it doesn't cost you anything in terms of latency *and* tokens, but it still requires you to upload your own Sprites through `/persona sprites`.

If your persona has atleast *one* Sprite uploaded, a new block in context is added as a guide for the LLM, for example:
```
Available sprites for Touko Fukawa:

Use sprites to express emotions and identities better. To use a sprite, Touko Fukawa must start a response line with this exact format:
`Touko Fukawa ({sprite label}):`

If no listed sprite fits, respond normally as `Touko Fukawa:`.

Valid sprite labels:
`Touko Fukawa (Genocide Jack):` Touko Fukawa's alter, chaotic serial killer personality. She switches to this whenever she faints from the sight of blood, sneezes or gets hit by a stun gun.
`Touko Fukawa (imagining):` use when imagining a raunchy BL moment to the point of dissociating
`Touko Fukawa (mad):` use when angry, or being annoyed by {user}, especially when {user} is dissing BL
```
As stated above, all the model has to do to invoke a Sprite is to output the raw name+emotion/identity before their response, otherwise, output normally. With how LLMs work, this may (or may not) cause better responses as a side effect.

See below for more information on the new commands, as well as some other new features/QoL changes batched with this minor update:

## New Tomori Features
- (Thanks Baetican!) `/tool compact` now allows you to save the generated summary as a RAG document (appears as a button after 10 minutes)
- (Thanks Palinalif!) Added Img2Video ComfyUI workflow support
  - See `/assets/comfyui-workflows/` for sample working workflow
- (Thanks Palinalif!) Added opt-in automatic model unloading for ComfyUI workflows (`COMFYUI_UNLOAD_MODELS_AFTER_SUCCESS=false`), useful for bigger models (like Ideogram 4.0 or a video model like WAN), or if using multiple models making VRAM scarce, and in slower machines.
- Added `/persona sprites` command category that allows you to add/edit/remove alternative avatars for your chosen persona based on emotion/identity it wants to use. You may also import/export these as a .zip file.
  - Limitations: (1) Main persona sprites send as a webhook, (2) if persona sends multiple lines that differ in emotion (eg. `Touko (mad):\nTouko (sad):`), it will add `({emotion})` into the webhook name to properly separate the avatars because Discord automatically merges same-named webhooks as one, (3) and Discord avatars are very small (may be improved in the future using Message Components)
- To help with Sprites, sample dialogue entries that follow the `{bot} ({emotion}):` or `{bot}` format at the beginning now do not have `{bot}:` automatically prepended to it (during prompt building) to prevent redundancy.
- Personas can now impersonate users if they use the `{persona} ({user}):` format (eg. `Ren (bredrumb): I love yuri` will cause bredrumb's avatar and name as a webhook to send that message). This is "opt-in" as this is not included in the prompt by default (add the instructions yourself). Useful for personas that love to shapeshift... like the next Default Tomori persona 🐐
- `/config model-randomizer` = when on, TomoriBot uses your configured Fallback Models (through `/config model fallback`) as a pool of models to generate responses with, randomly picking one every new request
- Tomori can now autonomously block/mute users for X hours. Use the `{block_user_tool}` macro in prompts if you want to instruct your persona to use it more/less. Use `/capabilities manage` to disable this.
- `/bot generate scene` = allows you to automatically generate a text scene with up to 3 characters spanning X amount of rounds
- `/tool estimate cost` now works better by using stored pricing rates in the DB (falling back to a rough estimate) and by averaging output price based on history/sample dialogues of chosen persona.
- `/generate video` now supports FPS and Duration entries


## QoL and Bug Fixes
- (Thanks Baetican!) Fixed bug wherein OpenRouter was passing the wrong Google-specific model capabilities to non-Google models, and then using the wrong model names for the Google models
- Persona updates now sync properly (for real this time). This includes Avatars and Sprites
- Increased ceiling on top_k parameter in `/model parameters` to 256.
- Revised prompting in `/persona generate` to prevent the model sometimes misinterpreting and replaces pronouns like "you" or "I" with "{user}" and "{bot}"
- Fixed bug wherein /persona generate's Import Now button does not create proper trigger words ("Touko Fukawa" doesn't save "Touko" and "Fukawa")
- Renamed /server trigger to /persona trigger
- Fixed bug wherein SQL statements for default persona seeding was causing ON CONFLICT errors when jumping from new versions->old versions
- Fixed bug wherein `/custom-endpoint edit` could only show one model in the same endpoint
- Polished some modal text (eg. Custom Endpoint now uses parentheses instead of em-dashes)
- Fixed bug wherein YouTube videos were un-analyzable by Google and Vertex AI providers
- Improved prompt for /image-tags for better model attention wherein it now says "{user}'s Physical Appearance" or "{persona}'s Physical Appearance" instead of just plain "Physical Appearance
- Moved `/help updates` to `/update` instead
- Added new `/system-prompt preset` preset

## Dev-Facing
- Compressed media images in the repo, saving ~30 MB (also as preparation for future default persona avatars/sprites and increasing release images). Test validations now block media images that are too big (>1 MB). 
  - Use `bun run compress-media` if there is a violation
- Users that are using OpenRouter now sends input/output token usage to OpenRouter's [leaderboard](https://openrouter.ai/apps) for TomoriBot (this does NOT send any other information other than numerical statistics on input/output token usage). Link to the stats is currently unavailable since there is not enough usage (yet).
  - Add `OPENROUTER_APP_ATTRIBUTION_ENABLED=false` in your .env to disable this OpenRouter stat tracking

## Persona Updates
Persona updates such as these are automatically applied to ALL servers using default presets, assuming you haven't changed their attribute/sample dialogue/name/avatar (which would unsync it). 

~~Do note that for Avatar updates, you still have to re-import this default persona (memories will not disappear even after you `/persona remove` a persona)~~ Avatar+Sprite Updates now happen automatically!
- Nerfed Tomori (Rose)'s "fr" habits, frfr
- All default personas (except Nerine) now correctly have "thick and short eyebrows" in their physical appearance description.
- Sprites for each default persona are slowly rolling out over the coming weeks ~~until my daily ChatGPT free image gens cover them all lmao~~ (Lilya's already live!).
## PLANNED Major Feature Updates
These are NOT yet implemented, just here to state what to expect in the following updates in the coming weeks:
- STM improvements + customization
- PluralKit support (personas would recognize systems)
- TomoriBot "random"ly nudging you, commenting about your day, your activity, memories about you, etc.
- ~~"Aquarium" Command that allows users to create a ~~simulation~~ channel containing their fake, LLM versions wherein they randomly interact and grow with each other~~ Saved for a future update *after* v0.8.0.00 instead due to its scale
- Zaya (Temari Rework)

If you want to contribute to ideation of these features, feel free to discuss over in the Discord server's designated channels!