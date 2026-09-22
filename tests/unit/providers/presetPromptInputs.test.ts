import { describe, expect, test } from "bun:test";
import { buildPresetPrompt } from "@/providers/utils/presetCommon";

/**
 * Every provider builds its request from this one prompt, so a field that reaches the params but
 * not this function is silently dropped. Google previously carried its own copy and lost the
 * appearance caption that way, which is what these tests guard.
 */
describe("preset prompt inputs", () => {
  const base = {
    characterName: "Juno",
    characterDescription: "A careful archivist.",
    speechExamples: "Measured and precise.",
  };

  test("carries the vision caption into a labelled section", () => {
    const prompt = buildPresetPrompt({ ...base, appearanceDescription: "Tall, silver hair, green coat." });

    expect(prompt).toContain("Appearance Observed In The Uploaded Image:");
    expect(prompt).toContain("Tall, silver hair, green coat.");
  });

  test("keeps the caption distinct from uploaded card data", () => {
    // Reusing one slot would tell the model that a vision description is structured card input.
    const prompt = buildPresetPrompt({
      ...base,
      appearanceDescription: "caption text",
      existingPresetContext: '{"attribute_list":["card"]}',
    });

    expect(prompt).toContain("Existing Character Data (from uploaded card/preset):");
    expect(prompt).toContain("Appearance Observed In The Uploaded Image:");
    expect(prompt.indexOf("Appearance Observed In The Uploaded Image:")).toBeGreaterThan(
      prompt.indexOf("Existing Character Data"),
    );
  });

  test("omits both sections when neither input exists", () => {
    const prompt = buildPresetPrompt(base);

    expect(prompt).not.toContain("Appearance Observed In The Uploaded Image:");
    expect(prompt).not.toContain("Existing Character Data");
    expect(prompt).not.toContain("Web Search Instructions:");
  });

  test("tells a tool-calling provider to search when search is requested", () => {
    const prompt = buildPresetPrompt({ ...base, useWebSearch: true });

    expect(prompt).toContain("Web Search Instructions:");
    expect(prompt).toContain("web search tools");
  });

  test("stays silent about search tools when the caller already ran the search", () => {
    // Google prefetches results and exposes no search tools, so instructing the model to call
    // them would ask for a tool it was never given.
    const prompt = buildPresetPrompt({ ...base, useWebSearch: true }, { webSearchResultsProvided: true });

    expect(prompt).not.toContain("Web Search Instructions:");
    expect(prompt).not.toContain("web search tools");
  });

  test("still includes the caption when search results were provided", () => {
    const prompt = buildPresetPrompt(
      { ...base, useWebSearch: true, appearanceDescription: "captioned look" },
      { webSearchResultsProvided: true },
    );

    expect(prompt).toContain("Appearance Observed In The Uploaded Image:");
    expect(prompt).toContain("captioned look");
  });
});
