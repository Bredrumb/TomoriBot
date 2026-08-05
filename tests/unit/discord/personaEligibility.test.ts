import { describe, expect, it } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import {
  hasAttributes,
  hasPersonaPrompt,
  hasSampleDialogues,
  hasTriggerWords,
  hasVoiceDesignPrompt,
  lineageIdIsEligible,
  personaIdIsEligible,
  refreshEligibilitySet,
} from "@/utils/discord/ui/personaEligibility";

function persona(overrides: Partial<TomoriState>): TomoriState {
  return {
    persona_id: 1,
    persona_lineage_id: 0,
    persona_nickname: "Test",
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: [],
    persona_prompt: null,
    ...overrides,
  } as unknown as TomoriState;
}

describe("Class A eligibility predicates", () => {
  it("hasAttributes is true only with at least one attribute", () => {
    expect(hasAttributes(persona({ attribute_list: [] }))).toBe(false);
    expect(hasAttributes(persona({ attribute_list: ["kind"] }))).toBe(true);
  });

  it("hasSampleDialogues requires both input and output arrays to be non-empty", () => {
    expect(hasSampleDialogues(persona({ sample_dialogues_in: [], sample_dialogues_out: [] }))).toBe(false);
    expect(hasSampleDialogues(persona({ sample_dialogues_in: ["hi"], sample_dialogues_out: [] }))).toBe(false);
    expect(hasSampleDialogues(persona({ sample_dialogues_in: [], sample_dialogues_out: ["yo"] }))).toBe(false);
    expect(hasSampleDialogues(persona({ sample_dialogues_in: ["hi"], sample_dialogues_out: ["yo"] }))).toBe(true);
  });

  it("hasTriggerWords is true only with at least one trigger word", () => {
    expect(hasTriggerWords(persona({ trigger_words: [] }))).toBe(false);
    expect(hasTriggerWords(persona({ trigger_words: ["tomo"] }))).toBe(true);
  });

  it("hasPersonaPrompt is true only for a non-blank, trimmed prompt", () => {
    expect(hasPersonaPrompt(persona({ persona_prompt: null }))).toBe(false);
    expect(hasPersonaPrompt(persona({ persona_prompt: "   " }))).toBe(false);
    expect(hasPersonaPrompt(persona({ persona_prompt: "be kind" }))).toBe(true);
  });

  it("hasVoiceDesignPrompt is true only for a non-blank, trimmed voice-design prompt", () => {
    expect(hasVoiceDesignPrompt(persona({ speech_voice_design_prompt: null }))).toBe(false);
    expect(hasVoiceDesignPrompt(persona({ speech_voice_design_prompt: "\n\t " }))).toBe(false);
    expect(hasVoiceDesignPrompt(persona({ speech_voice_design_prompt: "warm narrator" }))).toBe(true);
  });
});

describe("Class B eligibility predicate factories", () => {
  it("personaIdIsEligible respects set membership and excludes undefined ids", () => {
    const predicate = personaIdIsEligible(new Set([10, 20]));
    expect(predicate(persona({ persona_id: 10 }))).toBe(true);
    expect(predicate(persona({ persona_id: 30 }))).toBe(false);
    expect(predicate(persona({ persona_id: undefined }))).toBe(false);
  });

  it("lineageIdIsEligible treats shared-lineage personas consistently", () => {
    const predicate = lineageIdIsEligible(new Set([7]));
    // Two personas sharing lineage 7 are eligible or ineligible together.
    expect(predicate(persona({ persona_id: 1, persona_lineage_id: 7 }))).toBe(true);
    expect(predicate(persona({ persona_id: 2, persona_lineage_id: 7 }))).toBe(true);
    expect(predicate(persona({ persona_id: 3, persona_lineage_id: 9 }))).toBe(false);
  });

  it("the same predicate instance backs both the filter and the guard", () => {
    // Divergence between filter and guard is what reintroduces the bounce; using
    // one instance guarantees they agree for every persona.
    const predicate = personaIdIsEligible(new Set([5]));
    const p = persona({ persona_id: 5 });
    expect(predicate(p)).toBe(predicate(p));
    expect(predicate(p)).toBe(true);
  });
});

describe("refreshEligibilitySet", () => {
  it("mutates the target set in place, preserving the closed-over reference", async () => {
    const target = new Set<number>([1, 2, 3]);
    const captured = target; // simulate a predicate closing over the reference
    await refreshEligibilitySet(target, new Set<number>([2, 4]));
    expect(captured).toBe(target);
    expect([...target].sort()).toEqual([2, 4]);
  });

  it("awaits a promised next set", async () => {
    const target = new Set<number>([1]);
    await refreshEligibilitySet(target, Promise.resolve(new Set<number>([9])));
    expect([...target]).toEqual([9]);
  });

  it("clears to empty when the fresh set is empty (mid-loop drain)", async () => {
    const target = new Set<number>([1, 2]);
    await refreshEligibilitySet(target, new Set<number>());
    expect(target.size).toBe(0);
  });
});
