import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LlmRow, SavedProviderConfigUpsert, TomoriState } from "@/types/db/schema";
import * as realTomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as realRepositories from "@/utils/db/repositories";
import * as realLogitBiasResolver from "@/utils/provider/logitBiasResolver";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const modelConfigPatches: Array<Record<string, unknown>> = [];
const chatConfigPatches: Array<Record<string, unknown>> = [];

const selectedModel = {
  llm_id: 42,
  llm_codename: "provider-b-primary",
  llm_provider: "provider-b",
} as LlmRow;

const tomoriState = {
  server_id: 7,
  llm: { llm_id: 1, llm_codename: "provider-a-primary", llm_provider: "provider-a" },
  config: {
    llm_id: 1,
    fallback_model_refs: [
      { type: "llm", id: 7 },
      { type: "custom_endpoint", id: 9 },
      { type: "llm", id: 42 },
    ],
  },
} as TomoriState;

const savedConfig = {
  server_id: 7,
  provider: "provider-b",
  llm_id: 42,
  fallback_model_refs: [{ type: "llm", id: 99 }],
} as SavedProviderConfigUpsert;

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/tomoriStateCache": realTomoriStateCache,
  "@/utils/db/repositories": realRepositories,
  "@/utils/provider/logitBiasResolver": realLogitBiasResolver,
});

scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realTomoriStateCache,
  invalidateTomoriStateCache: () => undefined,
}));

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadById: async () => selectedModel,
  }),
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateModelConfig: async (_serverId: number, patch: Record<string, unknown>) => {
      modelConfigPatches.push(patch);
      return true;
    },
    updateChatConfig: async (_serverId: number, patch: Record<string, unknown>) => {
      chatConfigPatches.push(patch);
      return true;
    },
  }),
}));

scopedMock.module("@/utils/provider/logitBiasResolver", () => ({
  ...realLogitBiasResolver,
  resolveLogitBiasEntriesForLlm: () => ({ entries: [] }),
}));

beforeEach(() => {
  modelConfigPatches.length = 0;
  chatConfigPatches.length = 0;
});

describe("server provider activation fallback persistence", () => {
  it("preserves the live cross-provider chain instead of restoring or clearing the provider snapshot", async () => {
    const { activateServerTextModelFromSavedConfig } = await import("@/utils/provider/providerActivation");

    const result = await activateServerTextModelFromSavedConfig({
      serverDiscId: "guild-1",
      tomoriState,
      savedConfig,
    });

    expect(result.status).toBe("activated");
    expect(modelConfigPatches[0]).toMatchObject({ fallback_llm_ids: [7] });
    expect(chatConfigPatches[0]).toMatchObject({
      fallback_model_refs: [
        { type: "llm", id: 7 },
        { type: "custom_endpoint", id: 9 },
      ],
    });
  });
});
