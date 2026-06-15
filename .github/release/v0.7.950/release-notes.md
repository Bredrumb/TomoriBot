# v0.7.950 | Mix-and-Matched Edition
  
![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.950/tomowical.webp)

Jo-Ah-Yo! Jo-Ah Yo!
This major release focuses on making TomoriBot more flexible in using providers with highlights including:
1. Having different providers for each capability (img/vid/text/embeddings/voice/fallbacks)
2. Better local server/model support, allowing you to have a fully local TomoriBot stack incl. TTS/STT, video, embedding, and image
3. Personal providers wherein you can use your own preferred provider and key when interacting with a TomoriBot anywhere
4. New TomoriBot default persona: **Nerine** (for real this time)
## New Tomori Features
### Provider Pooling
Instead of pivoting on a single API key for one provider per server config, TomoriBot's architecture for model selection now looks at ALL saved providers like a pool. The right mental model now is: "Add Provider to add all its Models to the pool":
- `/provider switch` and `api-key set` have now been removed 
- `/provider add` (along with `custom-endpoint add`, explained in the next section) is now the main way to add new providers/usable models after `/setup`. 
- `other-model` has now been deprecated, adding models for OpenRouter are now in `/openrouter models`. Adding a model there will then expose it as a permanent choice in `/model` commands until you remove it.
### Custom Endpoint Revamp
You can now have multiple custom endpoints instead of just only one, allowing you to have a fully working TomoriBot with only local models or custom proxies.
- `Custom Endpoint` as a provider has been deprecated and moved to `/custom-endpoints` instead. This command group now allows you to add multiple custom endpoints for all capabilities and saves them as valid choices for matching `/model` commands. This means you can now use local image, video, and audio models with TomoriBot. It also handles redirects manually to prevent possible SSRF. See `/help custom-endpoints` for more details.
  - Added a tested and working ComfyUI workflow for img2img and txt2img generation with TomoriBot in `/scripts/` which uses Anima 3 Preview
- Allow users to specify context length to use through new `custom-endpoint command` (only works if endpoint supports it as a paremeter)
- Two new capability types added: Speech (TTS) and Transcription (STT), allowing you to register your own custom endpoints for them.
  -  Added ready-to-use scripts in `/scripts/` for deploying your own WhisperX for STT, and Qwen3TTS (Multilingual), Chatterbox-Turbo (Lightweight English), or IrodoriTTS (Japanese) for TTS, all supporting voice cloning (see `/help speech` and `/help transcription` for instructions).
- ElevenLabs has been reworked as a special endpoint with `/speech elevenlabs` that enables Speech and Transcription capabilities separately. Remove through `/custom-endpoint remove`
- `/setup` now has a "None" option that allows you to set a custom endpoint as the server's main provider later.
### Personal Provider Routing
The new `/personal provider` command group (mirroring `/config provider`) allows you to route requests to your own set API keys and providers, bypassing server quotas, cooldowns, as well as stingy server admins that only use DeepSeek v3.2 *cough* (cooldown/quota behavior might change in future updates).
- Added `/server user-byok toggle` which completely disables normal provider routing in the server. When toggled on, only users with a `/personal provider` set up can interact with your Tomori. Note that `random-trigger`s would still use the server's API keys.
- `/setup` now has a "None" options that allows you to automatically enable `user-byok` mode, requiring users to bring their own API keys if they want to use your Tomori
- `/personal provider toggle-models` = Turn personal routing for only certain models and capabilities on/off
- Currently does not allow setting of personal tts/stt models
PS: The amount of commands right now *does* make it annoying to navigate them, a hint for Personal Provider commands is to type in a hyphen after "model" as in "model-" to quickly show all personal provider related model settings.
### Other Features
- Humanizer degree 0 now enables non-streaming mode (all humanizer degrees will still inject system prompt). It is still `streaming` under the hood, but using this setting would now ensure Tomori sends only one message per turn (accumulates text chunks until end), unless it does interleaved tool calls.
- `/tool prompt snapshot` = simple one-shot slash command that shows what the complete prompt sent to the LLM in the current channel looks like with current config. Can be in human-readable .TXT or raw .JSON with or without tools.
- `/scheduled-task edit` = Allows you to edit your scheduled task in a server. If you are an admin, you can also change other user's scheduled tasks.
- Added support for random macros such as `{{random::apple::banana}}` (single or double brace OK). This will be resolved as "apple" or "banana" randomly upon building context. Note that this will often invalidate cache for context below it, so recommended to put this in low depth eg. context-note with low depth if you want maximum savings/PP (Prompt Processing).
- Renamed `/config persona-trigger-limit` to `/config trigger-match-limit`
- Reworked `/config self-reply-limit` to `/config trigger-cascade-limit` which hard-caps the number of additional triggers a single message does, making it more intuitive. (setting it to 2 means that your message can additionally cause triggers only up to a max of 2 times). Set it to 0 to ensure that only one message = one response every time
- Added a new command called `/personal spotlight set [hours](required) [channel](required)`. The point of this advanced command is to let individual users to set persona whitelist and auto-trigger behavior at a channel+user-level. Use `/help spotlight` to learn more
- Made `/personal deliberate-trigger-mode` work as a select of three options rather than a toggle. This makes it such that users can set a personal setting for DTM more reliably:
  - off = DTM is off no matter server setting
  - follow = (DEFAULT) follows server's setting
  - on = DTM always on no matter server setting
- `/st-preset switch` = allows you to switch between imported presets
- `/st-preset remove` = now shows checkboxes of ALL imported presets, uncheck to delete
- New `bonk` and `feed food:` punish/reward commands
-  `/config tools toggle` = toggle to disable/enable ALL tools
- Renamed `/config bot-permissions` to `/config tools manage`
- Add a "re-initialize" boolean in `initialize expressions` command that re-processes all current emoji descriptions in the server when True
- Consolidated `/samplers` command into one (due to Discord command limit issues).
  - /samplers now allow you to configure thinking level of the provider chosen. Only works on providers/models that support the parameter.
- Vertex AI now has new proper `/help` instructions for setup.
- Added Vertex AI Express as new provider (see `/help`). Basically a free version of Vertex AI
- Removed `/model-fallback remove`. To remove fallback models, simply pick "None" in the string select within `/model fallback`
- Added new help commands for this edition's new features
## QoL and Bug Fixes
- Instead of using an .env (ACTIVATE_LOCAL_RAG) to gate embedding features in locally hosted TomoriBot instances, it is now gated by an automatic database check, looking for `pgvector` installation when trying to use embedding-related commands. `pgvector` is needed in all setups to store vectorized data in the database.
- Fallback notices are now a minimalist `Fallback Used` button that appears on the message. Pressing it will show an ephemeral embed saying what model was used instead.
- User impersonations can now trigger Personas
- `delete turn` now shows an informative error embed if it fails to delete messages 
- `create_task` tool now defaults to reminding invoking user if Tomori fails to set a `target_user` properly
- Made ellipses cleaning and chunking logic more stable
- `scheduled-task remove` now doesn't require you to pick a persona first, it now shows all tasks in the server
- Added guard for tool call loops caused by errors (5 consecutive tool call errors = drop generation as overall error)
- Fixed bug wherein server text/image quotas were incrementing for the day even if a quota has not been explicitly set yet
- ST Presets that have the `post_history` field now have it inserted as simple turns, respecting their depth.
- Bug wherein sending a follow-up after replying to a user impersonation would cause Tomori to fall it back to the main persona talking instead of the user impersonation. 
- Bug wherein `initialize expressions` doesn't fallback to vision model
- Gemma 4 in OpenRouter now supports tools reliably by force-using providers that support tool usage
- Fixed OpenRouter providers that only accept different structured output formats (eg. Anthropic)
- Made `/comment` command have its input in the slash command parameter itself as a required string input instead of another modal. 
- `/bot respond` now launches instantly for the main persona, tick `extra_options` as true to see the old modal that allows persona selection, prefill, etc.
- Commands that use the "Pick Persona" embed with neat avatars now use caching-per-session so pages load much faster after the first time it loads, esp. for local where images are not stored through a servable URL. This cache persist the whole command execution only, including refreshes after a transaction.
- *if you are still reading up to this point, good job, have a candy*
- `/model fallback` now shows past configured fallback models as a placeholder.
- `/bot delete turn` should now ignore embeds (like error embeds, etc.) 
- Fixed bug wherein reasoning custom models get forcefully stopped after \<think\>\</think\>, meaning they were completely unusable
- Removed image and text quota defaults (applied to new servers since this update only)
- `/status` and `import|export` commands updated to reflect new database variables accompanying this update.
  - `/status server` is now split into 3 different server categories
- Prompt for reminders now properly tell Tomori to focus on pinging and reminding the user.
- `/speech transcripts` is now enabled by default (will take effect in new servers)
- Improved STM prompt nudge to prevent Tomori from saying she's about to save an STM.
## Dev-facing
- Moved scripts to /maintenance folder
## Nerine
A very old and discontinued Tomori model reassigned to you. She is one of the most accommodating of all the Tomoris, to the point of being harmful to herself. She will do anything you ask. She always has. Except when wanting to talk about her appearance and history. The broken horns, the skinned limbs exposing machinery, and the coat she wears draped over her shoulders. Somewhere along the way she became genuinely convinced that everything that happened to her was her own fault, and that the best thing she can do now is make sure it never happens again, which is by being warmer, more careful, more compliant, more useful than any unit has ever been. She reads horror novels in private and recommends heartwarming ones to you. She logs the things you mention in passing because she cannot afford to forget. She is very good at her job. She has had a *lot* of practice.
## PLANNED Updates
These are NOT yet implemented, just here to state what to expect in the following updates in the coming weeks:
- Text model randomizer
- STM rework (allow user-defined prompts to nudge it to proacatively save goals, etc.)
- Allow system message customization (eg. for reminders, internal nudges, etc.)
- "Aquarium" command group that allows you to set a channel in a server wherein you can plop fish in. "Fishes" are user impersonations that act like personas, with their own memories and prompt. They will randomly interact with each other in the channel thinking they are real hoomans using heuristics that makes it feel natural.
- Better `fetch` tool
- Temari Rework (into Zaya)
- "Music" as new capability type
- Internal code clean-up and refactoring (single 10k line files btw)