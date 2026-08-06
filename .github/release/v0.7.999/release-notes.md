# v0.7.999 | Pre-0.8 Update
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.999/zaya-comic.webp)

Small minor update right before the bigger 0.8.0.00. Highlights for this update are stat tracking as well as a [refreshed docs website](https://docs.tomoribot.app/) that allows both newer and older users of TomoriBot to discover her morbillion random features.

## Documentation Update
The official documentation website for TomoriBot ([here](https://docs.tomoribot.app/)) has been polished to make it easier for both new and old users in finding TomoriBot's existing features. Take a look at the **Features** and **Self-Hosting** categories and see if you might've missed some things TomoriBot has to offer! You may also run the docs website yourself by `bun run`ing the `/apps/docs/` directory

Un-rewritten AI-generated pages will have a disclaimer at the top of the page, if there's no disclaimer then I've written (or atleast co-written) it with my two weak human hands.

## New Tomori Features
- (Thanks Baetican!) `/config context-note set` can now be scoped into channels
- (Thanks Palinalif!) `/parameters` commands now expose a `minimal` thinking effort option
- TomoriBot now accumulates numerical usage statistics locally, which can be viewed using the new `/stats` command category:
  - `/stats personal||persona||server` = Reveal detailed stats on TomoriBot usage based on given scope/timeframe
  - `/stats generate` = Create neat looking infographics of you, your server's, or your persona's stats (*cough* great for sharing and boasting how you love Aphel)
  - Made in preparation for the natural nudge system
- `/config workarounds` = List of experimental toggles meant to bypass limitations of buggy/incomplete endpoints (like IntenseRP)
- Registering a new provider/OpenRouter/custom endpoint model will now automatically set that as the current model for the registered capability (`/provider` which has multiple capabilities would only replace text generation)
- Personas can now trigger other personas through `deliberate trigger mode` by using @ or by replying to a message directly with the `interact with recent message` tool
- `/personal timezone` = set your own timezone, distinguishing yourself from the current server's timezone in Tomori's context
  - Renamed `/config timezone` to `/server timezone` with this change
  - `create_task` tool now allows TomoriBot to pass in UTC offsets, making it more reliable for you to ask her for reminders/tasks appropriate for your custom timezone even in other servers

## QoL and Bug Fixes
- (Thanks Palinalif!) Failed tool calls now show up in thought logs channels
- Video generation successes now show total generation time it took
- `/bot kill` during a reminder/task trigger would now move that reminder for a minute after rather than consuming it
- Fixed bug wherein requests with temperatures above 1.0 can reach Anthropic, causing failure
- Fixed bug wherein users cannot re-register OpenRouter models that are deprecated and hidden in the DB
- `/help` commands have been improved for better feature visibility, pointing at the official docs website
- Providers now have choice descriptions in `/provider` commands
- First-time setup successes and nudges are now more concise

## Dev-Facing
- TomoriBot now automatically stores DB backups during bot startup before everything else (stored in `/backups/` with `_auto` suffix), checking if:
  - Last automatic backup is from an older version
  - Last automatic backup is atleast 24 hours old
- Docker deploys of TomoriBot now support manual (and automatic) DB backups and restores (see the [Maintenance & Backups guide](https://docs.tomoribot.app/en/self-hosting/maintenance/))
- New `bun run setup` and `bun run update` which makes it easier to first-time setup and update TomoriBot for local instances

## Persona Updates
Persona updates such as these are automatically applied to ALL servers using default presets, assuming you haven't changed their attribute/sample dialogue/name/avatar (which would unsync it). Avatar+Sprite Updates now happen automatically!
- Sprites for each default persona are slowly rolling out over the coming weeks, this patch includes:
  - Aphel Sprites
  - Rose (Tomori) Sprites

## PLANNED for 0.8.0.00
These are NOT yet implemented, but are to be expected to drop in 0.8.0.00
- Zaya (Temari Rework) + Sprites
- Locke (Freaky Tomori) + Sprites
  - Might move to 0.8.1.00 
- Nerine Sprites (+ Very Drunk Sprite)
- STM improvements + customization
- PluralKit support (personas would recognize systems)
- TomoriBot "random"ly nudging you, commenting about your day, your activity, memories about you, etc.
- Better SemVer (surely)
- Other cool features contributed by the community!

If you want to contribute to ideation of these features, feel free to discuss over in the Discord server's designated channels!
