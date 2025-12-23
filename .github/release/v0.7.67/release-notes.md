## Image(de)Generation Edition

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.67/artboard.png)

On the 6th day of Christmas, Tomori sent to me
> Hey dad can you give me imagegen please?

On the 7th day of Christmas, I replied yes. Merry Christmas and Happy New Years y'all. At this point version count is arbitrary and is just for memes (spoiler: next is v0.7.77).

Also, not the most artistic* person but hope you like the uhh image accompanying this release. Will look to add more v0.8.0 worthy features soon™. 

*edit: typo from autistic->artistic

### New Tomori Features
- **Image Generation**
   - Supports Text2Image or Image2Image
   - Available for OpenRouter and Google providers
     - Invoked by asking TomoriBot or manually through the new `/generate` command
     - Model is switchable with `/config model image`
     - Can be toggled on/off with `/server permissions`
- **System Prompt Customization**
  - You can now add a custom system instruction into TomoriBot using `/config prompt change` (up to 8000 text characters)
  - Added some presets with `/config prompt preset`
  - If blank, defaults to old built-in system prompt
- **Emoji/Sticker Registration**
  - TomoriBot can now see emojis (image vision)
  - Using the `/server initialize expressions` command, TomoriBot will remember the appearance and "use case" of all emojis and stickers in the server.
    - Recommended to run once after setup as this helps TomoriBot use emojis/stickers in the correct moment rather than guessing through the expression's name only
- **Full Privacy Option**
  - Updated `/personal privacy` command to support a  privacy option that completely makes you invisible to TomoriBot (no messages seen, no user content, and cannot trigger)
    - ~~Useful if you want to roleplay an egirl completely ignoring you on Discord~~
    - Blacklisted users in a server now receive the same invisible effect

### Keeping Models "Up-to-date"

**Added new Gemini 3, GLM 4.7, DeepSeek Chimera, etc. as new options**. From now on I won't have to add in every release versions new/deprecated models as new ones come out every week. I'll try to silently add more up-to-date models whenever they come out but I can't catch them all especially for OpenRouter (use the `account-setting` option or reach out in the Discord server)

PS: Gemini Free Tiers are currently stricter than before, might be better to finally pull out your ~~mom's~~ wallet for some cheap models in OpenRouter (GLM 4.7 my beloved)


### Other minor changes/fixes

- `account-setting` advanced model option now works properly
- TomoriBot now works in Discord Threads, VC and Stage text channels
- TomoriBot now sees server roles (she won't roast Discord mods... probably)
- `/persona generate` now works with OpenRouter models
- Sample dialogues are now optional in `/persona create`
- If `/persona generate` fails mid-processing, it will send your entries back to you
- `seed.sql` persona presets now correctly indicate that TomoriBot has yellow corn horns

### Optimizations

- Reordered prompt to minimize cache invalidations (less cost per prompt)
- More "LLM-friendly" format for TomoriBot (less numerical IDs prone to error) when she:
  - Uses emojis -> :emoji:
  - Uses stickers -> Call tool with sticker name
  - Mentions users -> @user



