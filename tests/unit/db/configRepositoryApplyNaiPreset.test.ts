import { beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { NaiPresetRow } from "@/types/db/schema";
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

const preset = {
  preset_name: "Carefree-Kayra",
  model_target: "kayra",
  is_default: true,
  preset_desc: "Default Kayra preset",
  ja_preset_desc: "Default Kayra preset",
  parameters: { temperature: 1.2, top_p: 0.9, top_k: 20, min_p: 0.05 },
} satisfies NaiPresetRow;

async function applyWithResults(results: readonly [boolean, boolean, boolean]): Promise<boolean> {
  const repository = new ConfigRepository();
  spyOn(repository, "updateModelConfig").mockResolvedValue(results[0]);
  spyOn(repository, "updateChatConfig").mockResolvedValue(results[1]);
  spyOn(repository, "updateNovelaiImagegenConfig").mockResolvedValue(results[2]);
  return repository.applyNaiPreset(7, preset, "kayra-v1", "guild-1");
}

describe("ConfigRepository.applyNaiPreset", () => {
  it("returns true and invalidates after all split-table writes succeed", async () => {
    expect(await applyWithResults([true, true, true])).toBe(true);
    expect(invalidations).toEqual(["guild-1"]);
  });

  it("returns false but still invalidates when only some split-table writes succeed", async () => {
    expect(await applyWithResults([true, false, true])).toBe(false);
    expect(invalidations).toEqual(["guild-1"]);
  });

  it("returns false without invalidating when every split-table write fails", async () => {
    expect(await applyWithResults([false, false, false])).toBe(false);
    expect(invalidations).toEqual([]);
  });
});
