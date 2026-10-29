import { describe, expect, it } from "bun:test";
import { createPersona } from "../../helpers/fixtures";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";
import { resolvePersonaSnippet } from "@/utils/text/personaPrompt";

const snippetFor = (attribute_list: string[], max = 100) =>
  resolvePersonaSnippet(createPersona({ persona_nickname: "Mirri", attribute_list }), max);

describe("resolvePersonaSnippet", () => {
  it("prefers the Personality attribute over earlier attributes and drops its label", () => {
    expect(snippetFor(["{bot}'s Appearance: white hair", "{bot}'s Personality: shy, soft-spoken"])).toBe(
      "shy, soft-spoken",
    );
    expect(snippetFor(["{bot}の外見: 白い髪", "{bot}の性格: 内気で控えめ"])).toBe("内気で控えめ");
  });

  it("falls back to the first attribute and fills the nickname placeholder", () => {
    expect(snippetFor(["{bot} collects teacups", "{bot}'s Likes: tea"])).toBe("Mirri collects teacups");
    expect(snippetFor(["{bot}'s Appearance: white hair"])).toBe("white hair");
  });

  it("returns null when there is nothing to show", () => {
    expect(snippetFor([])).toBeNull();
    expect(snippetFor(["{bot}'s Personality:   "])).toBeNull();
  });

  it("truncates at a word boundary within the limit", () => {
    const result = snippetFor(["{bot}'s Personality: shy and soft-spoken but multi-layered, deferential"], 30);
    expect(result).toBe("shy and soft-spoken but...");
    expect(getDiscordTextLength(result ?? "")).toBeLessThanOrEqual(30);
  });

  it("keeps a hard cut when the text has no separator to back up to", () => {
    const result = snippetFor(["{bot}の性格: 内気で控えめで優しくて努力家で負けず嫌いな子"], 10);
    expect(getDiscordTextLength(result ?? "")).toBeLessThanOrEqual(10);
    expect(result?.endsWith("...")).toBe(true);
  });
});
