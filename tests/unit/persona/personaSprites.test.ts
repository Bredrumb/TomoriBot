import { afterEach, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { invalidatePersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import { convertMentions } from "@/utils/text/context/mentionNormalizer";
import { buildPersonaSpriteContextItem, buildPersonaSpritePromptText } from "@/utils/text/context/personaSprites";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { normalizePersonaSpriteKey, validatePersonaSpriteName } from "@/utils/persona/sprites";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";

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
    expect(prompt).toContain("`Tomori ({sprite label}):`");
    expect(prompt).toContain("start a line with `Tomori:` to return to Tomori's default appearance");
    expect(prompt).toContain("Valid sprite labels:");
    expect(prompt).toContain("`Tomori (mad):` Use when annoyed.");
    expect(prompt).not.toContain("Tomori (sad)");
  });

  describe("context item", () => {
    afterEach(() => invalidatePersonaSpriteCache(10));

    it("limits tool selection to the same sprite roster as the prompt and omits empty rosters", async () => {
      const sprites = Array.from({ length: PERSONA_SPRITE_LIMITS.PROMPT_MAX_COUNT + 1 }, (_, i) => sprite(`pose ${i}`));
      setPersonaSpriteCache(10, sprites);
      const params = {
        client: {} as Client,
        guildId: "1",
        tomoriState: createPersona({ persona_id: 10 }),
        tomoriConfig: createServerConfig(),
        botName: "Juno",
        isUserImpersonation: false,
        convertMentions,
      };
      const item = await buildPersonaSpriteContextItem(params);
      expect(item?.personaSprites?.spriteKeys).toEqual(
        sprites.slice(0, PERSONA_SPRITE_LIMITS.PROMPT_MAX_COUNT).map((entry) => entry.sprite_key),
      );
      const text = item?.parts[0]?.type === "text" ? item.parts[0].text : "";
      expect(text).not.toContain(sprites.at(-1)?.sprite_name ?? "");
      expect(await buildPersonaSpriteContextItem({ ...params, isUserImpersonation: true })).toBeNull();
      setPersonaSpriteCache(10, []);
      expect(await buildPersonaSpriteContextItem(params)).toBeNull();
    });

    it("resolves identity macros in usage instructions", async () => {
      setPersonaSpriteCache(10, [sprite("drunk", "Use when {user} hands {bot} a drink.")]);

      const item = await buildPersonaSpriteContextItem({
        client: {} as Client,
        guildId: "1",
        tomoriState: createPersona({ persona_id: 10 }),
        tomoriConfig: createServerConfig(),
        botName: "Mirri",
        isUserImpersonation: false,
        convertMentions,
      });

      const part = item?.parts[0];
      const text = part?.type === "text" ? part.text : "";
      expect(text).toContain("`Mirri (drunk):` Use when User hands Mirri a drink.");
      expect(text).not.toMatch(/\{(user|bot)\}/);
      expect(item?.personaSprites).toEqual({ personaId: 10, spriteKeys: ["drunk"] });
    });
  });
});
