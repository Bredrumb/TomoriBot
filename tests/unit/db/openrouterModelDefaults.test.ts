import { describe, expect, it } from "bun:test";
import {
  decisionSections,
  embeddingSections,
  imageSections,
  llmSections,
  videoSections,
} from "@/db/seed/catalog/models";

describe("OpenRouter model catalog defaults", () => {
  it("defaults to paid DeepSeek Flash and retires free Gemma", () => {
    const rows = llmSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    const defaults = rows.filter((row) => row.isDefault);
    expect(defaults.map((row) => row.codename)).toEqual(["~deepseek/deepseek-flash-latest"]);
    expect(defaults[0].isFree ?? false).toBe(false);
    expect(defaults[0].seesImages).toBe(true);
    expect(rows.find((row) => row.codename === "google/gemma-4-31b-it:free")?.isDeprecated).toBe(true);
  });

  it.each([
    ["image", imageSections, "google/gemini-nano-banana-2.1"],
    ["video", videoSections, "x-ai/grok-imagine-video-1.5-lite"],
    ["Decision", decisionSections, "typesafe/jev-1.13"],
  ] as const)("uses the chosen OpenRouter %s default", (_capability, sections, codename) => {
    const defaults = sections
      .flatMap(({ rows }) => [...rows])
      .filter((row) => row.provider === "openrouter" && row.isDefault && !row.isDeprecated);
    expect(defaults.map((row) => row.codename)).toEqual([codename]);
  });

  it("uses google/gemini-embedding-2 as the OpenRouter default embedding model", () => {
    const rows = embeddingSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    const defaults = rows.filter((row) => row.isDefault);

    expect(defaults.map((row) => row.codename)).toEqual(["google/gemini-embedding-2"]);
  });
});
