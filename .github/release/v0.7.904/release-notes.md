# v0.7.904 | Summer-mer Edition
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.7.904/nerine-beach.webp)

But breadcrumb it's still Spring- yes, but where I'm from its tropical and its already Summer. It's hot as hell in here and you know what else is hot? Getting stuffed in a musky arm||oire||. Highlights are SillyTavern preset support, voice integration, and a brand new T\*mori persona default named **Nerine**!
## New Tomori Features
### Elevenlabs API Integration
Allows your TomoriBot to read voice messages (can cause triggers), as well as send them with emotions:tm:. Use `/help apikey` for instructions on setup.
- `/config voice elevenlabs` = Change the voice of a persona
- `/optionalkey elevenlabs` = Set/remove apikey
- `/config voicetranscripts toggle` = Enable/disable voice transcription into Discord chat, helps save Elevenlabs credits if on (off by default).
### SillyTavern Preset Support (Beta)
Use your favorite SillyTavern presets with TomoriBot (spaghetti not included). This will NOT overwrite any TomoriBot context (which is important for base agentic functionality), only rearrange it or add content to it. Only exception is that if a SillyTavern preset is detected and you have no system prompt set, the default system prompt will not be used anymore.
- `/stpreset` = batch of commands that allows you to upload, remove, and manage current sillytavern preset. 
- Some presets that use <details> to store information in chat will have them loaded in STM instead
List of things that are NOT imported and supported (for now):
- Regex rules
- Sampler settings (eg. temp., logit biases) as those are for per-provider in TomoriBot
- World Info/Lorebook entries
- SillyTavern specific macros such as {{summary}} and {{scenario}}
Note: If your preset uses HTML/CSS code, please disable its corresponding node through `/stpreset node toggle` as it does not work in Discord
### New Providers
- DeepSeek
- Z.ai (Coding and non-coding plans), very nice
- NVIDIA NIM = Free alternative (very slow)
- Vertex AI
- Codex CLI through ChatMock (check README)
### Other Features
- `/persona generate` now allows you to upload TomoriBot presets or SillyTavern cards, which loads their info into the generator subagent (useful for editing them to your liking)
- `/personal impersonate prompt` = Set a global persona prompt for yourself which will be used when you or someone else runs `/impersonate` on you
- Added `/thoughtlogs` wherein you can set a channel to flush all thoughts, instead of throwing them into the void
- `/config logitbias` = Change the likelihood of tokens appearing (works for some providers only). For local installs, requires tokenizer files, see README.md.
- `/bot generate image` = Quickly ask a subagent to generate an image of the ongoing scene (with optional prompt, and radio group of settings).
- `/compact` now allows you to forward result to a different channel
- Custom Provider is now available in Production as well to allow for virtually any OpenAI-compatible endpoint/proxy as long as its not malicious and insecure
- Reworked account-setting to just be other-model for OpenRouter wherein you input the name of the model you want, fetching capabilities upon setting instead of on runtime (which was buggy)
### QoL and Bug Fixes
- A lot of commands have been reworked to use checkbox groups/radio groups for better UX (update your Discord if they return any errors)
- Some commands now have prefilled content for better UX (eg. sysprompt)
- Some tools now show a visible embed to show its being run (eg. image generation), nerfing TomoriBot's gaslight ability
- STM tool is now hidden when a "remember" keyword is found inside the trigger message
- Non-vision models can now run `/persona generate` and profile picture analysis as long as it has a vision model set
- Doing a follow-up message to an alter persona now doesn't falls it back to the main persona responding
- Made TomoriBot register users through their Display name rather than their actual Discord username
- Whitelisted channels' threads are now whitelisted as well
- Made typing indicator last until bot's turn is actually finished (can still linger after finishing)
- Cross-channel interaction now work for linked threads (cross-thread)
- When SDK times out, user impersonation now doesn't fall back to TomoriBot replying
- Fixed bug in Custom Providers wherein images sent by the bot causes follow-up generations to fail
- Patched Server-Side Request Forgery (SSRF) security vulnerability in custom MCP servers 
- Production now has more RAM (finally)
- Squashed bug wherein /bot kill doesn't immediately stop generation
- Squashed bug wherein replying to a different bot's interaction response (eg. Slash Command) would cause TomoriBot to do identity theft on impersonate them (thanks Carson!)
- Squashed bug wherein replying to an Alter Persona/User Impersonation webhook does not trigger them
- Increased function call limit to 20 (long tool call chains are usually intentional, but if you see an actual loop you can use `/bot kill` to stop it manually)
- TomoriBot now sees embeds by other bots
- Bug wherein server data export doesn't work due to it not matching new constraints
## Delayed Updates
These are updates that will be slowly released under your nose after this update as they are still not ready (im kidding, I'll send messages in this forum post)
- Currently in the process of accommodating more and more SillyTavern preset patterns, if your favorite preset doesn't work as expected/is buggy, feel free to reach out in #support! 
- Default System Prompt Improvements
- Elevated persona privileges (may be stalled to further in the future)
- README.md cleanup
- /scripts/ folder cleanup
- Nerine and reworking of the other 4 sister's prompts (yes, she's not available right *now* but soon:tm:)