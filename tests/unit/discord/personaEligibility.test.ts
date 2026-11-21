import { describe, expect, it } from "bun:test";
import { hasPersonaPrompt } from "@/utils/discord/ui/personaEligibility";
import { createPersona } from "../../helpers/fixtures";

describe("hasPersonaPrompt", () => {
  it("is true only for a non-blank, trimmed prompt", () => {
    expect(hasPersonaPrompt(createPersona({ persona_prompt: null }))).toBe(false);
    expect(hasPersonaPrompt(createPersona({ persona_prompt: "   " }))).toBe(false);
    expect(hasPersonaPrompt(createPersona({ persona_prompt: "be kind" }))).toBe(true);
  });
});
