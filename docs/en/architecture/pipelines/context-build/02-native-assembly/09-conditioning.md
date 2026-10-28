---
title: "02.9: Conditioning"
aiGenerated: true
---

The conditioning contributor injects feedback memories detailing behaviors the persona was thanked or corrected for in past interactions.

## Flow and ownership

The contributor `buildConditioningContextItem` in `src/utils/text/context/templates.ts` formats reinforcement feedback for the persona:

1. **Eligibility**:
   - In `nativeBuilder.ts`, the stage is skipped during user impersonation, when `serverId` is missing, when `persona_lineage_id < 0`, or when neither reward nor punish conditioning is enabled on the persona.
2. **Database retrieval**:
   - Queries `conditioningMemoryRepository.loadGroupsForPersona(serverId, personaLineageId, type)` for `"reward"` and `"punish"` feedback.
   - Filters out entries with blank reason text.
   - Caps each category to `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` groups.
3. **Formatting and emission**:
   - Groups format with action past participles (`getConditioningContextPastParticiple`), actor user mentions or persona names, reasons, and repetition counts:
     - `## Rewarded Behaviors`: "Here are past things {botName} did that got rewarded for. Strive to do them again:"
     - `## Punished Behaviors`: "Here are past things {botName} did that got punished for. Avoid doing them again:"
   - Passes assembled sections through `convertMentions`.
   - Emits a single `system`-role item tagged `KNOWLEDGE_SERVER_CONDITIONING`. If both sections produce zero groups, returns `null`.

## Constraints and rationale

`interact_with_target` shares the localized embed renderer with `/reward` and `/punish`, including
random title variants and italic reasons. Its workspace capability, `conditioning_interactions_enabled`,
defaults to true and is managed under `/config` > Plugins > Available Tools. This tool remains
available in Deliberate Tool Mode when enabled, independently of stickers.
Tool embeds use the invoking persona's shared author resolution, including its committed appearance
and sprite for main and alter personas. One persona delivery receipt records the delivered message and
every artifact posted with it.

The tool's reason is optional. When provided for a persona target, it saves conditioning with the
active persona as the actor. Without a reason, the gesture is posted and the target can react, but no
conditioning is saved. Rows contain exactly
one of `user_id` or `actor_persona_id`; repeats are counted separately for each actor. Actor names are
resolved when the groups are read, and feedback is included without requiring that actor to be present.
Deleting an actor's user or persona row cascades to their feedback. Managers remove mixed-actor groups
through the existing conditioning panel.

After a successful post, persona targets enter the normal chat admission and channel queue with the
selected target and the initiating member's access identity. The queued turn receives an injected
context item that names the actor, the selected target, the action, and the reason, with the delivered
message ID in metadata. `/reward` and `/punish` use the same event builder and fetch their own reply as
the trigger, so a later message or embed cannot redirect the reaction. The receiving turn uses the
delivered embed's history text when present and replaces that history entry with one recent `user`
item formatted as `[System: <gesture> <tool hint>]`. The trigger stays separate from adjacent notices
during history merging. If the message is outside the fetched history, the injected event supplies
the gesture. The receiving turn resolves `{conditioning_interaction_tool}` inside
`{{if tool:interact_with_target}}` against its own model capabilities and Deliberate Tool Mode
allowlist. When unavailable, the event appears without the hint. The hint exists only for this
reaction turn; later history contains the posted gesture without it.

The interaction tool remains available to the receiving persona and allows one call per turn.
No runtime limit bounds the number of reciprocal turns. Persona-triggered replies also skip human
engagement counters and short-term memory writes, so persona reactions cannot sustain Natural Nudges
or establish a relationship with the initiating member. User targets receive only
the embed. Cancellation is checked before writing, posting, and triggering a reply; a completed write
is retained if delivery fails or is cancelled, no reaction is queued, and an uncertain send is never
reposted as the bot.

- **Feedback isolation**: Conditioning is persona-lineage scoped. It reinforces character consistency across server turns without bleeding feedback across distinct personas.
- **Impersonation suppression**: User impersonation turns suppress conditioning so that past bot critiques do not bias the imitated user persona.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_CONDITIONING`, which SillyTavern preset reassembly flushes before the first dialogue anchor (`dialogueExamples` or `chatHistory`).

## Source pointers

- `src/utils/text/context/templates.ts`: `buildConditioningContextItem`.
- `src/utils/db/repositories/ConditioningMemoryRepository.ts`: `loadGroupsForPersona`.
- `src/utils/conditioning/conditioning.ts`: `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` and past-participle mappings.
- [03: Server Memories](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/): companion persistent memory contributor.
