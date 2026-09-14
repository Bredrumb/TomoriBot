import { describe, expect, it } from "bun:test";
import { resolveDescription } from "@/utils/text/localizer";

describe("resolveDescription", () => {
  const descriptions = {
    "en-US": "English",
    ja: "Japanese",
    "pt-BR": "Portuguese",
    pt: "Generic Portuguese",
  };

  it("uses exact, base, matching base, English, then legacy English", () => {
    expect(resolveDescription(descriptions, "pt-BR", "Legacy")).toBe("Portuguese");
    expect(resolveDescription(descriptions, "pt-PT", "Legacy")).toBe("Generic Portuguese");
    expect(resolveDescription({ "pt-BR": "Portuguese" }, "pt-PT", "Legacy")).toBe("Portuguese");
    expect(resolveDescription(descriptions, "fr", "Legacy")).toBe("English");
    expect(resolveDescription({ ja: "Japanese" }, "fr", "Legacy")).toBe("Legacy");
    expect(resolveDescription(null, "ja", null)).toBeNull();
  });

  it("ignores empty translations", () => {
    expect(resolveDescription({ ja: "", "en-US": "English" }, "ja", "Legacy")).toBe("English");
  });
});
