import { describe, expect, it } from "bun:test";
import { embeddingSections, llmSections, videoSections } from "@/db/seed/catalog/models";

describe("OpenRouter model catalog defaults", () => {
  it("defaults to paid DeepSeek Flash and retires free Gemma", () => {
    const rows = llmSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    const defaults = rows.filter((row) => row.isDefault);
    expect(defaults.map((row) => row.codename)).toEqual(["~deepseek/deepseek-flash-latest"]);
    expect(defaults[0].isFree ?? false).toBe(false);
    expect(defaults[0].seesImages).toBe(true);
    expect(rows.find((row) => row.codename === "google/gemma-4-31b-it:free")?.isDeprecated).toBe(true);
  });

  it("uses H3 Max as the OpenRouter default video model", () => {
    const rows = videoSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    expect(rows.filter((row) => row.isDefault).map((row) => row.codename)).toEqual(["minimax/hailuo-3-max"]);
  });

  it("uses google/gemini-embedding-2 as the OpenRouter default embedding model", () => {
    const rows = embeddingSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    const defaults = rows.filter((row) => row.isDefault);

    expect(defaults.map((row) => row.codename)).toEqual(["google/gemini-embedding-2"]);
  });
});
