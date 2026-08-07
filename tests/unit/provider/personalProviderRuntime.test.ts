import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  CustomEndpointRow,
  FallbackModelRef,
  LlmRow,
  TomoriState,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import * as realRepositories from "@/utils/db/repositories";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const primary = { llm_id: 11, llm_provider: "custom:u4:local", llm_codename: "primary" } as LlmRow;
const fallback = { llm_id: 12, llm_provider: "google", llm_codename: "fallback" } as LlmRow;
const serverFallback = { llm_id: 90, llm_provider: "google", llm_codename: "server-fallback" } as LlmRow;
const endpoint = {
  custom_endpoint_id: 5,
  server_id: null,
  user_id: 4,
  label: "local",
  capability: "text",
  model_ref_id: 13,
} as CustomEndpointRow;

let rows: UserSavedProviderConfigRow[] = [];
let userChain: FallbackModelRef[] = [];

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories": realRepositories,
});

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadById: async (id: number) => (id === primary.llm_id ? primary : id === fallback.llm_id ? fallback : null),
    getLlmsByIds: async (ids: number[]) => (ids.includes(fallback.llm_id as number) ? [fallback] : []),
  }),
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    loadUserSavedProviderConfigs: async () => rows,
    loadUserFallbackChain: async () => userChain,
    loadCustomEndpointsByIds: async (ids: number[]) =>
      ids.includes(endpoint.custom_endpoint_id as number) ? [endpoint] : [],
  }),
}));

function makeState(): TomoriState {
  return {
    llm: { llm_id: 1, llm_provider: "google", llm_codename: "server-primary" },
    fallback_llms: [serverFallback],
    fallback_chain: [{ kind: "llm", model: serverFallback }],
    config: { fallback_llm_ids: [90] },
  } as TomoriState;
}

function makePersonalRow(
  enabledCapabilities: UserSavedProviderConfigRow["enabled_capabilities"],
  provider = "custom:u4:local",
): UserSavedProviderConfigRow {
  return {
    user_id: 4,
    provider,
    enabled_capabilities: enabledCapabilities,
    llm_id: 11,
  } as UserSavedProviderConfigRow;
}

describe("personal provider fallback overlay", () => {
  beforeEach(() => {
    rows = [];
    userChain = [
      { type: "custom_endpoint", id: 5 },
      { type: "llm", id: 12 },
    ];
  });

  it("materializes user custom endpoints and preserves the configured fallback order", async () => {
    rows = [makePersonalRow(["text"])];

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(), 4);

    expect(result.tomoriState.config.fallback_llm_ids).toEqual([12]);
    expect(result.tomoriState.fallback_chain).toEqual([
      { kind: "custom_endpoint", endpoint },
      { kind: "llm", model: fallback },
    ]);
    expect(result.tomoriState.fallback_llms).toEqual([fallback]);
  });

  it("keeps the server fallback chain when no personal text provider is active", async () => {
    rows = [makePersonalRow(["embedding"])];
    const state = makeState();

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(state, 4);

    expect(result.tomoriState.fallback_chain).toBe(state.fallback_chain);
    expect(result.tomoriState.fallback_llms).toBe(state.fallback_llms);
  });

  // The chain is stored per user, so switching which provider answers must not
  // change which chain is read. Storing it per provider row is what previously
  // stranded a configured chain on an inactive provider.
  it("applies the same chain whichever personal text provider is active", async () => {
    rows = [makePersonalRow(["text"], "deepseek")];

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(), 4);

    expect(result.tomoriState.fallback_chain).toEqual([
      { kind: "custom_endpoint", endpoint },
      { kind: "llm", model: fallback },
    ]);
    expect(result.tomoriState.config.fallback_llm_ids).toEqual([12]);
  });

  it("drops the personal chain to undefined when the user has none", async () => {
    rows = [makePersonalRow(["text"])];
    userChain = [];

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(), 4);

    expect(result.tomoriState.fallback_chain).toBeUndefined();
    expect(result.tomoriState.fallback_llms).toBeUndefined();
    expect(result.tomoriState.config.fallback_llm_ids).toEqual([]);
  });
});
