import { describe, expect, it } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import {
  collectRenderModifierSourceNames,
  formatRenderModifierWebhookName,
  isAllowedRenderModifierSpeakerLabel,
  parseLeadingRenderModifier,
  parseRenderModifierWebhookName,
  resolveRenderModifierSourcePersona,
} from "@/utils/discord/renderModifierParser";

function persona(nickname: string, id = 1): TomoriState {
  return {
    persona_id: id,
    persona_nickname: nickname,
  } as TomoriState;
}

describe("render modifier parser", () => {
  it("parses active persona copied-render syntax", () => {
    const result = parseLeadingRenderModifier("Ren (bredrumb): hi", ["Ren"]);

    expect(result).toEqual({
      sourceName: "Ren",
      modifier: "bredrumb",
      body: "hi",
      matchedPrefix: "Ren (bredrumb): ",
    });
  });

  it("parses unresolved modifiers so callers can strip the parenthetical label", () => {
    const result = parseLeadingRenderModifier("Ren (unknown): hi", ["Ren"]);

    expect(result?.modifier).toBe("unknown");
    expect(result?.body).toBe("hi");
  });

  it("does not parse other speakers", () => {
    expect(parseLeadingRenderModifier("Other (bredrumb): hi", ["Ren"])).toBeNull();
  });

  it("ignores code-block and list-like starts", () => {
    expect(parseLeadingRenderModifier("```\nRen (bredrumb): hi\n```", ["Ren"])).toBeNull();
    expect(parseLeadingRenderModifier("- Ren (bredrumb): hi", ["Ren"])).toBeNull();
    expect(parseLeadingRenderModifier("1. Ren (bredrumb): hi", ["Ren"])).toBeNull();
  });

  it("rejects overlong modifiers", () => {
    expect(parseLeadingRenderModifier(`Ren (${"a".repeat(65)}): hi`, ["Ren"])).toBeNull();
  });

  it("formats webhook names within Discord's username limit", () => {
    const formatted = formatRenderModifierWebhookName("R".repeat(90), "bredrumb");

    expect(formatted.length).toBeLessThanOrEqual(80);
    expect(formatted.endsWith(" (bredrumb)")).toBe(true);
  });

  it("parses visible webhook names back into source and modifier", () => {
    expect(parseRenderModifierWebhookName("Ren (bredrumb)")).toEqual({
      sourceName: "Ren",
      modifier: "bredrumb",
    });
  });

  it("resolves legacy copied-render webhook names to the source persona while preserving display label", () => {
    const personaByNickname = new Map([["ren", persona("Ren", 123)]]);

    const result = resolveRenderModifierSourcePersona("Ren (bredrumb)", personaByNickname);

    expect(result?.persona.persona_id).toBe(123);
    expect(result?.displayName).toBe("Ren (bredrumb)");
  });

  it("resolves flipped copied-render webhook names and rebuilds the source-first context label", () => {
    const personaByNickname = new Map([["ren", persona("Ren", 123)]]);

    // Discord display puts the impersonated name first; the model-facing label
    // must come back source-persona-first.
    const result = resolveRenderModifierSourcePersona("bredrumb (Ren)", personaByNickname);

    expect(result?.persona.persona_id).toBe(123);
    expect(result?.displayName).toBe("Ren (bredrumb)");
  });

  it("prefers the flipped orientation when both name parts match personas", () => {
    const personaByNickname = new Map([
      ["ren", persona("Ren", 123)],
      ["tomori", persona("Tomori", 456)],
    ]);

    // New persona-impersonates-persona display: "Tomori (Ren)" = Ren disguised
    // as Tomori. Legacy messages with the same shape are misattributed until
    // they age out of the history fetch window (documented trade-off).
    const result = resolveRenderModifierSourcePersona("Tomori (Ren)", personaByNickname);

    expect(result?.persona.persona_id).toBe(123);
    expect(result?.displayName).toBe("Ren (Tomori)");
  });

  it("allows active render-modifier speaker labels through the speaker guard", () => {
    const sourceNames = collectRenderModifierSourceNames("Ren", ["Tomori"]);

    expect(isAllowedRenderModifierSpeakerLabel("Ren (bredrumb)", sourceNames)).toBe(true);
    expect(isAllowedRenderModifierSpeakerLabel("Tomori (bredrumb)", sourceNames)).toBe(true);
    expect(isAllowedRenderModifierSpeakerLabel("Other (bredrumb)", sourceNames)).toBe(false);
  });
});
