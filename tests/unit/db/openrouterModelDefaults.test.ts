import { describe, expect, it, spyOn } from "bun:test";
import {
  decisionSections,
  embeddingSections,
  imageSections,
  llmSections,
  videoSections,
} from "@/db/seed/catalog/models";
import { openrouterProviderInfo } from "@/providers/openrouter/providerInfo";
import { llmModelRepo } from "@/utils/db/repositories";
import { loadAvailableModelsForCapability } from "@/utils/discord/interactions/personalConfigLoaders";
import { loadProviderModelChoices } from "@/utils/provider/modelCatalog";
import { createLlmRow } from "../../helpers/fixtures";

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
    ["server", () => loadProviderModelChoices({ kind: "server", ownerId: 1 }, "vision", "openrouter")],
    ["personal", () => loadAvailableModelsForCapability(1, "openrouter", "vision")],
  ] as const)("marks the Vision default in the %s picker", async (_scope, loadChoices) => {
    const textDefault = "~deepseek/deepseek-flash-latest";
    const visionDefault = openrouterProviderInfo.defaultVisionModel;
    if (!visionDefault) throw new Error("Expected an OpenRouter Vision default");
    const loadModels = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([
      createLlmRow({
        llm_id: 1,
        llm_provider: "openrouter",
        llm_codename: textDefault,
        sees_images: true,
        is_default: true,
      }),
      createLlmRow({
        llm_id: 2,
        llm_provider: "openrouter",
        llm_codename: visionDefault,
        sees_images: true,
        is_default: false,
      }),
    ]);
    try {
      const choices = await loadChoices();
      expect(choices.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
        { name: textDefault, isDefault: false },
        { name: visionDefault, isDefault: true },
      ]);
    } finally {
      loadModels.mockRestore();
    }
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
