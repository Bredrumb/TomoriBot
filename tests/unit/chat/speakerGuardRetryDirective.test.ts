import { describe, expect, test } from "bun:test";
import { buildSpeakerGuardRetryDirective } from "@/utils/chat/contextAnnotations";
import { buildPersonaSpritePromptText } from "@/utils/text/context/personaSprites";
import type { PersonaSpriteRow } from "@/types/db/schema";

describe("speaker guard retry directive", () => {
  test("allows the decorated opening only when the turn has a sprite prompt", () => {
    const withoutSprites = buildSpeakerGuardRetryDirective("Mirri", false);
    const withSprites = buildSpeakerGuardRetryDirective("Mirri", true);
    const plainOpening = "Mirri:";
    const spriteOpening = "Mirri ({sprite label}):";

    expect(JSON.stringify(withoutSprites)).toContain(plainOpening);
    expect(JSON.stringify(withoutSprites)).not.toContain(spriteOpening);
    expect(JSON.stringify(withSprites)).toContain(plainOpening);
    expect(JSON.stringify(withSprites)).toContain(spriteOpening);
    const spritePrompt = buildPersonaSpritePromptText("Mirri", [
      {
        sprite_id: 1,
        persona_id: 10,
        sprite_name: "smug",
        sprite_key: "smug",
        avatar_url: "data/avatars/servers/test/personas/10/sprites/1.png",
        usage_instructions: "Use when amused.",
        is_identity: false,
      } satisfies PersonaSpriteRow,
    ]);
    expect(spritePrompt).toContain(spriteOpening);
  });
});
