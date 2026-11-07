# v0.8.1.70 | Optimizations

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.8.1.70/zaya-optimizations.webp)

Here's some cyberware that optimizes our beloved gremlin Discord bot.

## New Major ~~Features~~ Optimizations
This update largely reduces TomoriBot's token costs as well as speeds up generations through:

### Better Prompt Caching
**TLDR**: Prompt ordering has changed to make costs less and generations faster

One bottleneck that TomoriBot had before this update is Prompt Processing (PP) due to how inefficient her prompt was ordered. Small details such as timezone details and presence data invalidate a large portion of prompt cache every minute and RAG potentially fetches new memories every message, meaning most tokens of every prompt you send is almost always read fresh, costing lots of processing time as well as input token costs.

This update changes how TomoriBot's prompt is ordered, putting volatile details such as time and dynamic RAG deep in the context basket, even cutting through conversation history ordering so most of the cache is preserved, allowing you to save ~80% of input token costs every trigger in long conversations or tool-call heavy triggers, depending on your provider's cache TTL. This should also improve responses by making retrieved information closer to the bottom of the context basket.

**Do note that this optimization doesn't save costs/generation time in multi-persona conversations as much as single-persona conversations since personas have prompts that mostly differ from each other, naturally invalidating cache**

### Decaying Memories
**TLDR**: Memories bloat TomoriBot's context so they can now automatically expire if they're not actively used

Another growing problem of TomoriBot is how each persona loads *all* of their server memories and personal memories every trigger (latter dependent on the people present in the convo but still), inflating token costs as you use her more and more and even worse, inducing faster context rot in some models esp. smaller ones, making them hallucinate and talk lots of slop. This update also introduces **memory decay** for every server, taking effect whenever an embedding model is available and set in that server.

Memory decay uses embeddings to "reinforce" memories. Everytime TomoriBot is triggered, the trigger's embeddings are compared against all memories' embeddings, those that match will become "active" memories and will always be present in context for 7 days (a day only counts if there is atleast one interaction so you don't have to worry about returning to your TomoriBot after 2 months and her forgetting everything), similar to how memory works today. But if after a week a memory doesn't get reinforced, it becomes a "resting" memory that can only get loaded into context if the trigger matches it (acting like RAG). All memories once this update drops, as well as new memories default to becoming "active" memories (similar to humans remembering info easier if they're fresh). It will take around a week for the mechanism to kick in and calibrate, so until then expect all your current memories to still all be present in TomoriBot.

But bred, isn't running embeddings every trigger expensive? Nope, semantic search is very cheap and in fact, this change will make TomoriBot cheaper to run in the long term, especially for servers with lots of memories as it cuts out bloat input tokens efficiently.

This can be disabled by setting `MEMORY_DECAY_ENABLED=false` in the .env, but it is recommended to keep on, esp. if you have access to embedding models as it doesn't outright deletes memories unless capacity is full, read more about it in the [official docs](https://docs.tomoribot.app/en/features/knowledge/memory/memory-decay/)

### TTS/STT Optimizations
To help with the future voice-chat implementation, a bunch of low-latency optimizations have been done to local TTS/STT servers that TomoriBot supports:
- IrodoriTTS has a new low-latency mode for NVIDIA GPUs that makes speech about 3-4x faster with the same voice quality, turn it on with `IRODORI_COMPILE_MODE=cudagraphs` in .env (`compile` is a ~2x faster fallback if cudagraphs misbehaves on your GPU)
- IrodoriTTS now remembers each voice clip after the first use (saved on disk, so it even survives restarts), so cloned voices start speaking sooner
- Qwen3 TTS now uses a much faster backend by default on NVIDIA GPUs, making speech about 6x faster (faster than real-time now instead of about twice as slow). Switch back with `QWEN3TTS_BACKEND=transformers` if off NVIDIA
- VoxCPM2 now actually compiles on Windows (it was quietly running uncompiled before), making speech about 2.5-3x faster. Rerun the installer to get the new packages
- Chatterbox, CosyVoice3, and MOSS-TTS now also remember voice clips after the first use, so cloned voices start speaking sooner (CosyVoice3 on Windows especially, saving ~1.5s per message)
- WhisperX now uses your NVIDIA GPU even if you installed the CPU-only version of PyTorch. Before, it quietly ran transcription on the CPU in that case, which was much slower
- WhisperX no longer hangs on every request when the GPU is found but unusable (eg. missing cuBLAS/cuDNN on Windows). It now tells you at startup and falls back to CPU instead. Check `/health` to see if `device` says `cuda`
- Added new recommended `kotoba-tech/kotoba-whisper-v2.0-faster` for Japanese-only setups, which is more accurate than `large-v3-turbo` on Japanese at the same speed

## Minor Features
- Anthropic models and endpoints now save prompt cache properly, reducing input token costs with such models in their official endpoint as well as through OpenRouter
- You can now choose transcription models (STT) from OpenRouter, Google Gemini, and Vertex
- Split "Humanizer Degree" into multiple toggles for behavior rather than a single preset (`/setup` can still be a preset)
- Added optional sharding logic, useful for TomoriBot instances that handle lots of guilds. Discord automatically determines the optimal amount on startup (usually just 1 for small server count instances). Force a shard count using .env `SHARD_COUNT`

## QoL and Bug Fixes
- Retirement of Smithery MCP Server Support (now deprecated)
- Improved the Image Generator default system prompt to show official NovelAI V5 instructions on how to add text to image gens if `generate_image_nai` is present in a turn
- Invalid model names when registering a new model are now rejected for all providers TomoriBot has direct integrations for (registering a novelai model into openrouter now rejects the entry)
- Added "page" as an optional parameter for slash commands like `/config` so you can easily jump to deeply nested pages/categories (eg. `/config page:MCP Servers`). Search doesn't have to be exact, you can type "MCP" and it will intelligently autocomplete to the Plugins > MCP Servers page
- Added special/flavorful "ignored" text if a user tries to use reward/punish on a persona that blocked them
- Made embeds created by /reward and /punish to be sent as the user as a webhook
- Model select options now show I/O token $ pricing if available
- When switching to NovelAI models, the generation samplers automatically switch to the default recommended for that NovelAI model
- Fixed bug wherein default model settings could "leak" into override channel/persona models, causing situations wherein a non-tool-calling channel model gets passed tool definitions
- Fixed bug wherein some panels exceeded Discord API's character limits, preventing them from opening if your past entries were too long
- Fixed bug wherein /reward and /punish embeds made by a user can still be visible to a persona that blocked that user
- Fixed bug wherein if another persona is not whitelisted in a channel, a persona cannot reference their public attributes/image tags
- Fixed bug wherein replying to TomoriBot-produced embeds that should be visible (like Playful Interaction embeds) does not return any content inside it, saying "[System: No text content was included]"
