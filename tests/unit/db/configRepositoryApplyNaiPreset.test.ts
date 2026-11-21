import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { llmProviderRepo } from "@/utils/db/repositories";
import { createLlmRow, createNaiPreset } from "../../helpers/fixtures";
// Hoisted real namespace so the mock below stays full-surface; `mock.module` is
// process-global for the whole run and a partial factory breaks later files.
import * as realTomoriStateCacheStore from "@/utils/cache/tomoriStateCacheStore";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const invalidations: string[] = [];

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/tomoriStateCacheStore": realTomoriStateCacheStore,
});

scopedMock.module("@/utils/cache/tomoriStateCacheStore", () => ({
  ...realTomoriStateCacheStore,
  invalidateTomoriStateCache: (serverDiscId: string) => invalidations.push(serverDiscId),
}));

let ConfigRepository: typeof import("@/utils/db/repositories/ConfigRepository").ConfigRepository;

beforeAll(async () => {
  ({ ConfigRepository } = await import("@/utils/db/repositories/ConfigRepository"));
});

beforeEach(() => {
  invalidations.length = 0;
});

const preset = createNaiPreset();
const model = createLlmRow({ llm_id: 7, llm_provider: "novelai", llm_codename: "kayra-v1" });
const saved = savedProviderConfigSchema.parse({
  server_id: 7,
  provider: "novelai",
  api_key: null,
  llm_id: 3,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_temperature: 1.035,
  llm_disabled_params: ["temperature"],
});
afterEach(() => {
  spyOn(llmProviderRepo, "loadSavedProviderConfig").mockRestore();
  spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockRestore();
});

async function applyWithResults(results: readonly [boolean, boolean, boolean, boolean]): Promise<boolean> {
  const repository = new ConfigRepository();
  spyOn(repository, "updateModelConfig").mockResolvedValue(results[0]);
  spyOn(repository, "updateChatConfig").mockResolvedValue(results[1]);
  spyOn(repository, "updateNovelaiImagegenConfig").mockResolvedValue(results[2]);
  spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved);
  spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(results[3]);
  return repository.applyNaiPreset(7, preset, model, "guild-1");
}

describe("ConfigRepository.applyNaiPreset", () => {
  it("resolves only presets from the serving model's target and clears presets for GLM", async () => {
    const repository = new ConfigRepository();
    const preset = createNaiPreset({ model_target: "erato" });
    const load = spyOn(repository, "loadNaiPresets").mockResolvedValue([preset]);
    expect(await repository.resolveNaiPreset("llama-3-erato-v1", "Carefree-Kayra")).toBe(preset);
    expect(load).toHaveBeenCalledWith("erato");
    expect(await repository.resolveNaiPreset("glm-4-6", "Carefree-Kayra")).toBeUndefined();
  });
  it("returns true and invalidates after all split-table writes succeed", async () => {
    expect(await applyWithResults([true, true, true, true])).toBe(true);
    expect(invalidations).toEqual(["guild-1"]);
    expect(llmProviderRepo.upsertSavedProviderConfig).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        llm_id: model.llm_id,
        nai_preset_name: preset.preset_name,
        llm_temperature: preset.parameters.temperature,
        llm_top_p: preset.parameters.top_p,
        llm_top_k: preset.parameters.top_k,
        llm_min_p: preset.parameters.min_p,
        llm_disabled_params: [],
      }),
      { serverDiscId: "guild-1" },
    );
  });

  it("returns false but still invalidates when only some split-table writes succeed", async () => {
    expect(await applyWithResults([true, false, true, true])).toBe(false);
    expect(invalidations).toEqual(["guild-1"]);
  });

  it("returns false without invalidating when every split-table write fails", async () => {
    expect(await applyWithResults([false, false, false, false])).toBe(false);
    expect(invalidations).toEqual([]);
  });

  it("reports a saved-provider write failure and invalidates committed active writes", async () => {
    expect(await applyWithResults([true, true, true, false])).toBe(false);
    expect(invalidations).toEqual(["guild-1"]);
  });
});
