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
Tool embeds use the active persona's webhook and reuse its adjacent sprite identity through persona-post
delivery continuity; ordinary bot delivery is recorded when the persona has no webhook route.

The tool records the active persona as the actor when targeting another persona. Rows contain exactly
one of `user_id` or `actor_persona_id`; repeats are counted separately for each actor. Actor names are
resolved when the groups are read, and feedback is included without requiring that actor to be present.
Deleting an actor's user or persona row cascades to their feedback. Managers remove mixed-actor groups
through the existing conditioning panel.

After posting the embed, persona targets enter the normal chat admission and channel queue with the
selected target and the initiating member's access identity. The queued reply disables this interaction
tool to stop reciprocal tool chains. User targets receive only the embed. Cancellation is checked before
writing, posting, and triggering a reply; a completed write is retained if delivery fails or is cancelled.

- **Feedback isolation**: Conditioning is persona-lineage scoped. It reinforces character consistency across server turns without bleeding feedback across distinct personas.
- **Impersonation suppression**: User impersonation turns suppress conditioning so that past bot critiques do not bias the imitated user persona.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_CONDITIONING`, which SillyTavern preset reassembly flushes before the first dialogue anchor (`dialogueExamples` or `chatHistory`).

## Source pointers

- `src/utils/text/context/templates.ts`: `buildConditioningContextItem`.
- `src/utils/db/repositories/ConditioningMemoryRepository.ts`: `loadGroupsForPersona`.
- `src/utils/conditioning/conditioning.ts`: `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` and past-participle mappings.
- [03: Server Memories](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/): companion persistent memory contributor.
