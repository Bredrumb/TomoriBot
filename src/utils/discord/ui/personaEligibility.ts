import type { TomoriState } from "@/types/db/schema";

/**
 * Shared persona-eligibility predicates for item-scoped `remove` / `edit` /
 * `view` commands.
 *
 * Each family has exactly one predicate, and the identical function must drive
 * three things: the caller's pre-picker guard, the workflow's picker filter, and
 * the post-selection concurrency backstop. Expressing the same condition inline
 * in more than one of those places reintroduces the wasted persona click the
 * eligibility filter exists to remove.
 *
 * Two flavors live here:
 *   - Class A predicates read a field already present on the in-memory
 *     {@link TomoriState}; they require no query.
 *   - Class B factories close over a precomputed `Set` of eligible keys returned
 *     by a single batched repository query, so the returned predicate stays
 *     synchronous and never issues a per-persona query on the interaction hot
 *     path.
 */

/** True when the persona has at least one personality attribute. */
export function hasAttributes(persona: TomoriState): boolean {
  return (persona.attribute_list?.length ?? 0) > 0;
}

/**
 * True when the persona has at least one sample dialogue pair. Both the input
 * and output arrays must be non-empty, matching the post-selection guard in
 * `sample-dialogue/remove.ts`.
 */
export function hasSampleDialogues(persona: TomoriState): boolean {
  return (persona.sample_dialogues_in?.length ?? 0) > 0 && (persona.sample_dialogues_out?.length ?? 0) > 0;
}

/** True when the persona has at least one trigger word. */
export function hasTriggerWords(persona: TomoriState): boolean {
  return (persona.trigger_words?.length ?? 0) > 0;
}

/** True when the persona has a non-blank persona prompt. */
export function hasPersonaPrompt(persona: TomoriState): boolean {
  return typeof persona.persona_prompt === "string" && persona.persona_prompt.trim().length > 0;
}

/** True when the persona has a non-blank voice-design prompt. */
export function hasVoiceDesignPrompt(persona: TomoriState): boolean {
  return typeof persona.speech_voice_design_prompt === "string" && persona.speech_voice_design_prompt.trim().length > 0;
}

/**
 * Builds a predicate keyed on `persona_id`. Callers first resolve the set of
 * eligible persona ids with a single batched query (documents, history
 * documents, sprites), then reuse the returned predicate for both the picker
 * filter and the post-selection guard.
 *
 */
export function personaIdIsEligible(eligiblePersonaIds: ReadonlySet<number>): (persona: TomoriState) => boolean {
  return (persona) => persona.persona_id !== undefined && eligiblePersonaIds.has(persona.persona_id);
}

/**
 * Builds a predicate keyed on `persona_lineage_id`. Used by lineage-scoped
 * families (server and personal memories) where several personas can share one
 * lineage and are therefore eligible or ineligible together.
 *
 */
export function lineageIdIsEligible(eligibleLineageIds: ReadonlySet<number>): (persona: TomoriState) => boolean {
  return (persona) => eligibleLineageIds.has(persona.persona_lineage_id);
}

/**
 * Refreshes a Class B eligibility set **in place** from a freshly resolved set.
 *
 * The picker filter and post-selection guard close over the same `Set` object by
 * reference, so a retry loop that mutates DB state (removing the last document of
 * a persona, for example) must update that object rather than replace it. Clear +
 * repopulate keeps the closure pointing at live membership, so the persona drops
 * out of the picker on the next retry and the last such removal reaches the
 * workflow's mid-loop empty terminal state.
 *
 * @param nextSet - A promise (or value) of the freshly batched eligible keys.
 */
export async function refreshEligibilitySet(
  target: Set<number>,
  nextSet: Set<number> | Promise<Set<number>>,
): Promise<void> {
  const resolved = await nextSet;
  target.clear();
  for (const id of resolved) target.add(id);
}
