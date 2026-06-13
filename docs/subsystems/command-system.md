---
title: "Command System"
---

TomoriBot uses Discord slash commands loaded dynamically from `src/commands/`.

## Loader and Execution Pipeline

- Registration/building: `src/utils/discord/commandLoader.ts`
- Runtime dispatch: `src/events/interactionCreate/handleCommands.ts`

Flow:

1. `loadCommandData()` scans command folders and top-level command files.
2. Command metadata is built into `SlashCommandBuilder` trees.
3. `handleCommands.ts` resolves a root command, or category + group + subcommand.
4. Category cooldown is checked/set in `cooldowns` table (`COMMAND_CATEGORY`).
5. Target `execute()` is called with `(client, interaction, userData, locale)`.

`commandLoader.ts` is an ESM-only loader. It uses async directory reads while building slash-command registration data and dynamically imports command modules so command files can use top-level await. Do not add `require`, `module.exports`, or synchronous directory traversal to command discovery.

## Discord UI Helper Layout

Command files import Discord UI helpers from responsibility-owned modules:

- `src/utils/discord/ui/confirmation.ts` - confirmation prompts
- `src/utils/discord/ui/modals.ts` - raw, legacy, and paginated modal prompts
- `src/utils/discord/ui/embeds.ts` - info and summary embed replies
- `src/utils/discord/ui/statusComponents.ts` - Components V2 status replies and status-page pagination
- `src/utils/discord/ui/pagination.ts` - generic choice pagination
- `src/utils/discord/ui/personaPagination.ts` - persona choice pagination and avatar-session cache types

`src/utils/discord/interactionHelper.ts` remains only as the subsystem compatibility barrel. New command code should import from the owned module that matches the helper it uses.

## Webhook Helper Layout

Command, event, tool, and stream code import webhook helpers from responsibility-owned modules:

- `src/utils/discord/webhook/lifecycle.ts` - shared/persona webhook creation, lookup, deletion, and avatar updates
- `src/utils/discord/webhook/personaDispatch.ts` - persona/webhook send paths
- `src/utils/discord/webhook/identity.ts` - persona avatar and webhook identity resolution
- `src/utils/discord/webhook/fallback.ts` - managed-webhook restore and transcript fallback behavior
- `src/utils/discord/webhook/cache.ts` - webhook cache metrics and invalidation helpers

`src/utils/discord/webhookManager.ts` remains only as the subsystem compatibility barrel. New code should import from the owned webhook module directly.

Keep webhook cache invalidation in the same success path as the write or delete that changes webhook state.

## Command File Contract

Subcommand modules export:

- `configureSubcommand(subcommand)`
- `execute(client, interaction, userData, locale)`

Root command modules export:

- `configureCommand(command)`
- `execute(client, interaction, userData, locale)`

Grouped commands are represented by folders:

- `src/commands/model/text.ts` -> `/model text`

Root commands are represented by top-level command files:

- `src/commands/subscribe.ts` -> `/subscribe`

Root command files may also export optional command-level flags:

- `guildOnly = true` - restricts the command to guilds
- `managerOnly = true` - requires `ManageGuild`
- `nsfw = true` - marks the command as age-restricted
- `isCommandEnabled(context)` - returns `false` to skip command registration and
  execution-map wiring for this module

Use `isCommandEnabled` for commands that are present in source but should be
absent unless a feature gate is active. The loader evaluates the gate after
importing the module but before calling `configureCommand()` or
`configureSubcommand()`. If every subcommand in a category is disabled, the
top-level category command is omitted from registration.

Example:

```ts
export const isCommandEnabled = () =>
  process.env.RUN_ENV === "production" &&
  process.env.TOMORI_SUPPORTER_BILLING_ENABLED === "true";
```

Command modules must not perform production-only side effects at import time.
Keep feature-gated initialization in startup hooks or inside the gated runtime
handler.

## Current Top-Level Categories

- `bot`
- `capabilities`
- `conditioning`
- `config`
- `contribute`
- `donate`
- `generate`
- `help`
- `legal`
- `mcp`
- `memory`
- `model`
- `novelai`
- `nsfw`
- `openrouter`
- `optional-key`
- `persona`
- `personal`
- `provider`
- `scheduled-task`
- `server`
- `speech`
- `st-preset`
- `support`
- `tool`

## Category Restrictions

Defined in `commandLoader.ts`:

- Guild-only categories: `server`, `conditioning`
- Manage Guild required by default: `config`, `server`

## Localization Strategy for Command Metadata

Do not hardcode descriptions/choice names.
Use `localizer("en-US", key)` in command builders.

`commandLoader.ts` then auto-applies locale localizations for other loaded locales.

Key pattern:

- Root command description: `commands.{command}.description`
- Root command option description: `commands.{command}.{option}_description`
- Root command choice name: `commands.{command}.{option}_choice_{value}`
- Subcommand description: `commands.{category}.{path}.description`
- Option description: `commands.{category}.{path}.{option}_description`
- Choice name: `commands.{category}.{path}.{option}_choice_{value}`

Example path:

- file: `src/commands/memory/personal/remove.ts`
- command path: `memory.personal.remove`

Root command example:

- file: `src/commands/subscribe.ts`
- command path: `subscribe`

## Interaction Timing Rules (Important)

Discord requires interaction acknowledgement within ~3 seconds.

### 3-Second Rule

On slash command invoke, acknowledge within 3 seconds using one of:

- `interaction.reply(...)`
- `interaction.deferReply(...)`
- `interaction.showModal(...)` (or modal helper that sends modal response)

After acknowledgement, you have up to ~15 minutes to complete.

### Pattern 1: Simple Command (No Deferral)

Use when work is synchronous/very fast and has no DB/API/file latency before response.

```ts
export async function execute(...) {
	if (!interaction.guild) {
		await replyInfoEmbed(...);
		return;
	}

	await interaction.reply({ content: "..." });
}
```

Rules:

- no DB query before first reply
- no external API call before first reply
- no filesystem work before first reply

### Pattern 2: Async Command (Defer First)

Use when any meaningful async work happens before first response.

```ts
export async function execute(...) {
	if (!interaction.guild) {
		await replyInfoEmbed(...);
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const state = await getCachedTomoriState(interaction.guild.id);
	await sql`UPDATE ...`;

	await replyInfoEmbed(interaction, locale, { ... });
}
```

Rules:

- run fast validation first
- then defer before DB/API work
- do not defer at function start if early-return validation can finish immediately
- `/tool estimate cost` follows this pattern: it defers first, then fetches recent messages, builds context, and performs provider API token counting

### Pattern 3: Modal Command (No Initial Deferral)

Use when opening a modal for user input.

```ts
const modalResult = await promptWithRawModal(
	interaction,
	locale,
	{ ... },
	MessageFlags.Ephemeral, // auto-defer modal submission
);

if (modalResult.outcome !== "submit") return;
await sql`UPDATE ...`;
await replyInfoEmbed(modalResult.interaction, locale, { ... });
```

Rules:

- do not call `deferReply()` before showing modal
- pre-modal data loading must stay within the initial 3-second window
- if modal submit processing is async and the command will reply on the modal submission itself, pass `MessageFlags.Ephemeral` as `promptWithRawModal` arg 4

### Pattern 3A: Bulk Management Modal (Checkbox Groups)

Use when the user is managing an existing set of configured entries and batch keep/remove is better UX than a one-at-a-time select.

Examples:

- `/server whitelist remove`
- `/config remove modeloverride` (channels + personas together)
- `/server stm manage` (active server-shared STM entries)
- `/server private-channels`
- `/server rp-channels`

Rules:

- use `promptWithRawModal(...)` with checkbox groups and `MessageFlags.Ephemeral` auto-defer on submit
- pre-check every existing entry; unchecked means "remove" or "disable"
- set `minValues: 0` and `required: false` so users can uncheck everything
- chunk long lists into groups of 10 options; Discord allows at most 5 groups per modal (50 total options)
- if you are managing multiple entity types in one modal, keep them in separate checkbox groups by type
- if the total set exceeds 50 options, show a page-selection step and launch page-scoped checkbox modals
- after submit, diff original entries against submitted checked values, then invalidate caches only after successful DB writes

### Pattern 3B: Persistent Checklist Setting

Use when one command owns the full enabled-set of a durable setting rather than an add/remove delta flow.

Example:

- `/server crosschannel-blocklist`
- `/server whitelist persona` (after the persona picker, the command owns that persona's full enabled channel set)

Rules:

- checked means "enabled in the stored set"; unchecked means "disabled from the stored set"
- reopening the command must preload the current saved state
- submit writes the full selected set back to storage, not just the latest delta intent
- if the eligible option set exceeds one modal (`>50`), show a page-selection message first and launch page-scoped checkbox modals from there
- durable server-scoped settings added through this pattern should also be surfaced in `/tool status`
- keep [`status-command.md`](./status-command) in sync when `/tool status` coverage changes

### Pattern 3C: Modal -> Review Prompt -> Modal

Use when a command needs one modal to collect a bulk selection, then a follow-up confirmation or button choice before optionally opening a second modal.

Example:

- `/personal spotlight set`

Rules:

- do not auto-defer the first modal submit if you still need to reply with buttons from that modal interaction
- reply to the first modal submit with a review embed + buttons
- if the user picks the branch that needs more input, open the second modal from the unacknowledged button interaction
- after the second modal submit, silently acknowledge with `acknowledgeModalSubmitForRefresh(...)` when you intend to edit the original review reply instead of responding on the second modal itself
- only persist the final DB write after the last user decision is known, then invalidate caches in that same success path

### Pattern 4: Pagination Helpers (No Pre-Defer)

Use when calling `replyPaginatedChoices(...)` or `promptWithPaginatedModal(...)`.

```ts
const result = await replyPaginatedChoices(interaction, locale, { ... });
```

```ts
const modalResult = await promptWithPaginatedModal(interaction, locale, { ... });
if (modalResult.outcome !== "submit") return;

// If submission handling is heavy, defer the modal submission immediately.
await modalResult.interaction.deferReply({ flags: MessageFlags.Ephemeral });
await sql`UPDATE ...`;
await replyInfoEmbed(modalResult.interaction, locale, { ... });
```

Rules:

- do not defer before `replyPaginatedChoices(...)` or `promptWithPaginatedModal(...)` (they acknowledge directly)
- `replyPaginatedPersonaChoicesV2(...)` auto-defers unreplied slash interactions before its first render, then uses `editReply(...)` for the picker UI
- keep pre-helper work under 3 seconds
- `promptWithPaginatedModal(...)` does not expose an auto-defer parameter; defer on submission manually when needed
- for persona-button transaction loops that use `replyPaginatedPersonaChoicesV2(...)`, a successful write can `continue` back to the picker so the original ephemeral picker message refreshes in place and the user can perform another transaction without rerunning the slash command

### Pattern 4A: Persona Picker Transaction Loop

Use when a command starts with `replyPaginatedPersonaChoicesV2(...)` and then launches a modal or second-step transaction from the selected persona button.

Rules:

- wrap the persona-picker flow in `while (true)` so recoverable states can `continue` back to the picker
- use `preserveSelectedInteraction: true` so the selected persona button stays valid for opening the next modal
- declare `const avatarSessionCache: AvatarSessionCache = new Map()` **before** the `while (true)` loop and pass it as `avatarSessionCache` in the options — this prevents avatar re-fetches across loop iterations (page navigation, retries after failed transactions)
- on invalid persona or other recoverable picker-side errors, replace the picker in place with `updateButtonComponentsV2Status(..., "general.pagination.reloading_persona_picker")`
- on modal close or timeout, refresh the original picker message with `replyComponentsV2Status(interaction, ..., "general.pagination.reloading_persona_picker")` and continue
- on successful submit, prefer a single in-place picker update by calling `acknowledgeModalSubmitForRefresh(modalSubmitInteraction)` and then `replyComponentsV2Status(interaction, success_title, success_description, ..., "general.pagination.reloading_persona_picker")`
- slash-entry callers normally do not need to `deferReply()` just to launch `replyPaginatedPersonaChoicesV2(...)`; the helper acknowledges before avatar/file resolution. If the command itself must do substantial async work before it can call the helper, defer earlier in the command.
- if the command refreshes the original picker after modal submit, do not pass `MessageFlags.Ephemeral` as arg 4 to `promptWithRawModal(...)`; that auto-defer path is for commands that will send their final reply on the modal interaction itself
- if `replyPaginatedPersonaChoicesV2(...)` returns `reason: "fatal"`, return immediately instead of continuing the loop; continuing on a dead interaction can recreate the old infinite Discord API retry loop

### Pattern 5: Manual Deferral Timing

Use when you must delay deferral until after quick checks.

```ts
if (!hasPermission) {
	await replyInfoEmbed(...);
	return;
}

await interaction.deferReply({ flags: MessageFlags.Ephemeral });
const data = await exportServerData(...);
await interaction.editReply({ files: [data] });
```

Rules:

- keep pre-defer path fast
- once async heavy work starts, interaction must already be acknowledged

### Common Mistakes

- defer before `promptWithRawModal(...)` (causes already-acknowledged errors)
- no defer before DB/API updates in async command paths
- pre-defer before pagination helpers
- forgetting to defer modal submissions that do heavy async processing

### Helper Behavior Notes

- `replyInfoEmbed(...)` / `replySummaryEmbed(...)`:
  - handle `reply` vs `editReply` based on interaction state
- `promptWithRawModal(...)`:
  - shows modal (acknowledges original interaction)
  - optional arg 4 (`autoDeferReply`) can defer modal submission automatically
- `promptWithUnacknowledgedConfirmation(...)`:
  - shows confirm/cancel buttons without pre-acknowledging the confirm button
  - use this for button -> modal flows where `showModal()` must happen after confirmation
- `replyPaginatedChoices(...)` / `promptWithPaginatedModal(...)`:
  - send pagination UI immediately (acknowledges interaction)
  - should be called without pre-deferring

### Quick Reference

| Command Type | Defer Before Work? | Primary API |
| --- | --- | --- |
| Simple/Fast | No | `interaction.reply(...)` |
| DB/API before response | Yes | `interaction.deferReply(...)` then helper reply |
| Modal | No (before modal) | `promptWithRawModal(...)` |
| Pagination | No (before helper) | `replyPaginatedChoices(...)` / `promptWithPaginatedModal(...)` |
| Manual timing | Depends | defer after quick checks, before heavy work |

## Representative Command Groups

- `bot`: respond, generate(image/scene), kill, impersonate
- `config`: setup, model(text/image/embedding/video/vision/speech/transcription), api-key(rotation), provider(add/remove), custom-endpoint(add/edit/remove), image-tags(default-positive/default-negative), system-prompt(set/remove/preset), context-note(set), params(*), timezone, message-fetch-limit, self-debug, model-randomizer, bot-permissions -> tool-use(toggle/manage), notice-embeds(visibility)
- `speech`: elevenlabs, voice-add, voice-remove, voice-assign, transcripts, chatterbox(parameters)
- `nsfw`: jailbreaks
- `optional-key`: brave/set/remove
- `server`: trigger(add/delete), whitelist(channel/persona/role/remove), stm(manage), cooldown(triggers), auto-trigger(channels/threshold), matrix(link/unlink), quota(image-generation/text-generation/video-generation/reset), rp-channels, crosschannel-blocklist, welcome-channel(set/remove), private-channels, user-blacklist(add/remove), member-permissions, always-reply, thought-logs-channel, channel-prompt
- `novelai`: attg, image(params/generate), character-reference
- `server`: trigger(add/delete), whitelist(channel/persona/role/remove), stm(manage), cooldown(triggers), auto-trigger(*), matrix(link/unlink), quota(image-generation/text-generation/video-generation/reset), rp-channels, crosschannel-blocklist, welcome-channel(set/remove), private-channels, user-blacklist(add/remove)
- `persona`: create, generate, import, export, default, swap, remove, image-tags, sprites(add/edit/remove/export/import), attribute(add/edit/remove), sample-dialogue(add/edit/remove), prompt(set/remove), history(import/remove)
- `memory`: document(add/remove), personal(add/edit/remove/import/export), server(add/edit/remove/import/export)
- `personal`: privacy, language, nickname, image-tags, cache, config(import/export/remove), provider(add/remove/model-text/model-embedding/model-image/model-video/model-vision/toggle-models), model(fallback), samplers, impersonate(prompt), spotlight(set/manage)
- `scheduled-task`: edit, remove
- `conditioning`: manage, reward(headpat/hug/kiss/tickle), punish(spank/pinch/bite/squeeze)
- `tool`: ping, status, refresh, compact, comment

`/server auto-trigger` is channel-scoped and uses one shared cycle across its configured channels. Threshold `0` enables always-reply in those channels. Positive values use either a fixed trigger (`min = max`) or a shared inclusive random range (`min-max`), rerolling after each successful auto-trigger. The cycle only advances on qualifying real user-like messages; TomoriBot and alter webhook self-messages do not advance or consume the auto-trigger counter. Removing a channel disables auto-trigger behavior for that channel. `/server auto-trigger channels` can also target a single channel and assign one persona to that room's auto-trigger fallback instead of always using the main persona.

`/server channel-prompt` is a flat, modal-driven command that scopes a system prompt to one channel. It takes a required `channel` option, then opens a prefilled 4-part modal (up to 16000 chars, part 1 optional) plus a Radio Group for Prompt Mode (`Append` / `Replace`). `Append` injects the channel prompt as a distinct `SYSTEM_CHANNEL_PROMPT` block after the server system prompt; `Replace` substitutes the channel prompt for the server system prompt's slot — persona prompt and persona attributes are never affected. Submitting with all prompt parts empty removes the channel's override. State lives in the standalone `channel_prompt_overrides` table (per-channel, never exported) and is resolved per request via `getCachedChannelPrompt`. The override surfaces in `/tool prompt snapshot` under the `Channel Prompt` header.

`/persona sprites add` is a one-modal Manage Server flow that selects a persona, validates a sprite label, uploads an image, converts it to PNG, and upserts a `persona_sprites` row. Reusing a normalized label replaces the existing sprite. `/persona sprites edit` uses the persona picker, sprite picker, and confirmation bridge before opening a prefilled modal for name, optional replacement image, usage instructions, and identity status; replacement images consume the shared avatar quota, while metadata-only edits do not. `/persona sprites remove` starts from `replyPaginatedPersonaChoicesV2(...)`, then opens checkbox groups where checked sprites are kept and unchecked sprites are deleted. When a persona has more than one modal page of sprites, the command shows a localized range-button picker before opening the checkbox modal. `/persona sprites export` selects a persona and bundles its sprites into a shareable `.zip` (public reply). `/persona sprites import` opens a single modal with a persona select plus a `.zip` file-upload field; it validates and converts every image up front, reserves one import-quota slot for the whole batch, overwrites on name conflicts, and rejects the entire import if it would exceed `PERSONA_SPRITE_MAX_PER_PERSONA`. The archive format (manifest + `sprites/` images) and its ZIP-bomb guards live in `src/utils/persona/spriteArchive.ts`. See [multi-persona](multi-persona) for the format details.

`/bot generate image` is a modal-driven, fire-and-forget scene snapshot command. It plans against the current channel context with the active text provider, then renders with either the current provider's native image path or NovelAI's tag-based image tool when a NovelAI backend is available. Personal provider overlays apply before the hidden turn is built so personal text/image routing is respected.

`/bot generate scene` is a modal-driven scripted text-scene command. V1 requires two different personas, optionally accepts a third, blocks duplicate selections, and only opens when the available persona set fits Discord's 25-option select limit. The `Rounds` field repeats the selected speaking order and is bounded by `BOT_GENERATE_SCENE_MAX_CYCLES` (default `10`; TomoriBot is BYOK so each generated turn bills the invoking user's own provider). Each generated turn receives a concise tail directive: additional instructions when provided, then "Begin your next reply as {persona}. Write only this character's next message." Scene turns keep tools enabled, suppress `/bot respond` continuation prompting, and use unique text-quota trigger keys so each generated turn is charged separately. Because every scene turn shares one trigger message, both reply-to-trigger mechanisms are suppressed for scene turns: the visual Discord reply (`replyToMessage` in `toolLoop.ts`) and the textual `buildQueuedReplyDirective` context directive (`contextPipeline.ts`) — otherwise every queued persona would render and be told to reply to the same unrelated message. The command-execution status embed (`commands.bot.generate.scene.success_title`) is sent non-ephemerally so it is classified as a `scene_directive` system embed and re-read into context as `[System: ...]`. For scene turns after the first, `triggererName` (what `{{user}}` resolves to in `turnPlanner.ts`) is overridden to the previous speaker in `sceneTurn.sequence`, so each persona treats the prior persona as the entity it is responding to rather than the command invoker; turn 0 has no prior speaker and keeps the invoker.

`/generate video` is a modal-driven async generation command. It validates `videogen_enabled`, provider capability, API key, configured `video_model_id`, and server quota before polling the selected provider until the MP4 result is ready.

`/config model-randomizer` is a server-level toggle (mirrors `/config self-debug`) for the per-turn text model randomizer. When enabled, each generation turn randomly promotes one model from the pool (primary model + configured fallbacks) to lead the attempt chain, breaking the bot out of any single model's repetitive phrasing while keeping the rest as failover. It enforces a **block-until-fallbacks** precondition: enabling is refused with a localized warning embed unless the server has ≥1 fallback configured via `/model fallback`, guaranteeing the pool always has ≥2 members so the toggle is never a silent no-op. The flag lives in `server_chat_configs.model_randomizer_enabled` and is consumed by `buildGenerationAttempts` — see the [generation-turn pipeline](../pipelines/chat/06-per-turn/03-run-generation-turn).

### Personal-provider (BYOK) routing in commands

Any command that performs AI work the invoking user triggers must overlay that user's personal (BYOK) provider onto the loaded server state via `applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id)` before reading `config.api_key`, deriving the provider/model name, or validating capabilities. The overlay returns the server state unchanged when the user has no enabled personal provider, so it is always safe to call. Commands that currently apply it: `/persona generate`, `/novelai image generate`, `/generate image`, `/generate video`, `/bot generate image`, `/memory document add`, `/memory history import`, `/server initialize expressions`, and `/tool estimate cost` (so its live estimate stays in parity with what would actually run for the user).

The one deliberate exception is `/model embedding`, which re-embeds **server-wide** documents under server credentials (`resolveCapabilityCredentials(serverId, "embedding")` with no `userId`). This is bulk maintenance of a pre-existing server resource rather than a fresh user action, so it intentionally stays on server credentials.

Forward-looking command rewrite guidance (naming conventions, checklist-style settings pattern, migration map) is now part of `docs/guides/adding-slash-command.md`. The runtime loader and current implementation still use the existing `src/commands/` structure.

## Adding a New Command

1. Add a `.ts` file under the correct command category/group path.
2. Export `configureSubcommand` and `execute`. Root commands export
   `configureCommand` and `execute`.
3. Add locale keys in both locale trees (`src/locales/en-US/` and `src/locales/ja/`). Command keys live in `commands/{category}.ts` within each locale directory.
4. Run:
   - `bun run check-locales`
   - `bun run check`
   - `bun run lint`
