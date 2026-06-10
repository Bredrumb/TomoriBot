import { describe, expect, it } from "bun:test";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { buildPersonaSpritePromptText } from "@/utils/text/context/personaSprites";
import { normalizePersonaSpriteKey, validatePersonaSpriteName } from "@/utils/persona/sprites";

function sprite(name: string, instructions = ""): PersonaSpriteRow {
  return {
    sprite_id: 1,
    persona_id: 10,
    sprite_name: name,
    sprite_key: normalizePersonaSpriteKey(name),
    avatar_url: "data/avatars/servers/test/personas/10/sprites/1.png",
    usage_instructions: instructions,
    is_identity: false,
  };
}

describe("persona sprites", () => {
  it("normalizes valid sprite names into display names and lookup keys", () => {
    const result = validatePersonaSpriteName("  very   mad  ");

    expect(result).toEqual({
      ok: true,
      displayName: "very mad",
      spriteKey: "very mad",
    });
  });

  it("rejects empty, invisible, and parser-breaking sprite names", () => {
    expect(validatePersonaSpriteName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validatePersonaSpriteName("\u200B")).toEqual({ ok: false, reason: "empty" });
    expect(validatePersonaSpriteName("mad:angry")).toEqual({ ok: false, reason: "invalid_chars" });
    expect(validatePersonaSpriteName("mad (angry)")).toEqual({ ok: false, reason: "invalid_chars" });
  });

  it("builds bounded prompt guidance with exact render labels", () => {
    const prompt = buildPersonaSpritePromptText(
      "Tomori",
      [sprite("mad", "Use when annoyed."), sprite("sad", "Use when upset.")],
      1,
    );

    expect(prompt).toContain("Available sprites for Tomori:");
    expect(prompt).toContain("`Tomori ({sprite name}):`");
    expect(prompt).toContain("Only use the sprite names listed below.");
    expect(prompt).toContain("`Tomori (mad):` Use when annoyed.");
    expect(prompt).not.toContain("Tomori (sad)");
  });
});
