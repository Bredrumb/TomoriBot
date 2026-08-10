import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type {
  CustomEndpointRow,
  FallbackModelRef,
  LlmRow,
  TomoriState,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import {
  assignPersonalCapabilityToProvider,
  loadSmartestModelForRoutedProvider,
} from "@/utils/provider/personalProviderHelpers";

// Both subjects reach the repositories through the shared singletons and resolve the
// member at call time, so `spyOn` suffices. Module-level mocking would pin this file
// into the isolated test lane for no benefit, since Bun cannot unregister one. Keep the
// marker token out of this file entirely: the lane planner detects it by plain substring
// match and would isolate the file over a mention in a comment.
const spies: Array<{ mockRestore: () => void }> = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, impl: T[K]): void {
  const spy = spyOn(target, key as never).mockImplementation(impl as never);
  spies.push(spy as unknown as { mockRestore: () => void });
}

const serverLlm = { llm_id: 1, llm_provider: "openrouter", llm_codename: "xiaomi/mimo" } as LlmRow;
const koboldLlm = { llm_id: 2, llm_provider: "custom:u49:koboldcpp", llm_codename: "gemma-4" } as LlmRow;
const googleLlm = { llm_id: 5, llm_provider: "google", llm_codename: "gemini-flash" } as LlmRow;
const smartestByProvider: Record<string, LlmRow> = {
  openrouter: { llm_id: 3, llm_provider: "openrouter", llm_codename: "openrouter-smartest" } as LlmRow,
  google: { llm_id: 4, llm_provider: "google", llm_codename: "gemini-2.5-pro" } as LlmRow,
};

// model_ref_id ties this endpoint to llm 12, so promoting llm 12 must prune it too.
const endpoint = { custom_endpoint_id: 5, user_id: 49, server_id: null, model_ref_id: 12 } as CustomEndpointRow;

let rows: UserSavedProviderConfigRow[] = [];
let chain: FallbackModelRef[] = [];
let smartestLookups: string[] = [];
let chainWrites: FallbackModelRef[][] = [];
let savedConfig: UserSavedProviderConfigRow | null = null;

function makeRow(provider: string, llmId: number | null): UserSavedProviderConfigRow {
  return {
    user_id: 49,
    provider,
    enabled_capabilities: ["text"],
    assigned_capabilities: ["text"],
    llm_id: llmId,
  } as UserSavedProviderConfigRow;
}

beforeEach(() => {
  rows = [];
  chain = [];
  smartestLookups = [];
  chainWrites = [];
  savedConfig = null;

  stub(llmProviderRepo, "loadUserSavedProviderConfigs", (async () => rows) as never);
  stub(llmProviderRepo, "loadUserFallbackChain", (async () => chain) as never);
  stub(llmProviderRepo, "loadCustomEndpointsForUser", (async () => [endpoint]) as never);
  stub(llmProviderRepo, "upsertUserSavedProviderConfig", (async () => true) as never);
  stub(llmProviderRepo, "setUserFallbackChain", (async (_userId: number, refs: FallbackModelRef[]) => {
    chainWrites.push(refs);
    return true;
  }) as never);
  stub(llmModelRepo, "loadById", (async (id: number) =>
    id === koboldLlm.llm_id ? koboldLlm : id === googleLlm.llm_id ? googleLlm : null) as never);
  stub(llmModelRepo, "loadSmartestModel", (async (provider: string) => {
    smartestLookups.push(provider);
    return smartestByProvider[provider] ?? null;
  }) as never);
  stub(llmProviderRepo, "loadUserSavedProviderConfig", (async () => savedConfig) as never);
  stub(llmProviderRepo, "deleteCustomEndpointById", (async () => true) as never);
  stub(llmModelRepo, "deleteSyntheticCustomCapabilityModelById", (async () => true) as never);
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("loadSmartestModelForRoutedProvider", () => {
  const serverState = () => ({ llm: serverLlm, config: {} }) as TomoriState;

  it("resolves against the server provider when no personal text provider is active", async () => {
    const model = await loadSmartestModelForRoutedProvider(serverState(), 49);

    expect(smartestLookups).toEqual(["openrouter"]);
    expect(model?.llm_codename).toBe("openrouter-smartest");
  });

  // The override reaches generation as a bare codename and inherits the answering row's
  // provider, so a server-provider codename would be sent to the personal endpoint.
  // Returning null lets the caller say so instead of substituting a foreign model.
  it("does not offer the server provider's model to a personal-routed turn", async () => {
    rows = [makeRow("custom:u49:koboldcpp", koboldLlm.llm_id as number)];

    const model = await loadSmartestModelForRoutedProvider(serverState(), 49);

    expect(smartestLookups).toEqual(["custom:u49:koboldcpp"]);
    expect(model).toBeNull();
  });

  it("resolves against the personal provider when it publishes a smartest model", async () => {
    rows = [makeRow("google", googleLlm.llm_id as number)];

    const model = await loadSmartestModelForRoutedProvider(serverState(), 49);

    expect(smartestLookups).toEqual(["google"]);
    expect(model?.llm_codename).toBe("gemini-2.5-pro");
  });
});

describe("promoting a personal text primary", () => {
  beforeEach(() => {
    rows = [makeRow("deepseek", 1)];
  });

  // The chain lives on the user now, so a promotion that ignored it would leave the
  // primary in its own fallback chain and the runtime pool would run it twice.
  it("removes the promoted model from the user's chain", async () => {
    chain = [
      { type: "llm", id: 12 },
      { type: "llm", id: 99 },
    ];

    await assignPersonalCapabilityToProvider(49, "deepseek", "text", (row) => ({ ...row, llm_id: 12 }));

    expect(chainWrites).toEqual([[{ type: "llm", id: 99 }]]);
  });

  // A custom endpoint and a catalog llm can denote the same model, so pruning only the
  // numerically equal ref would leave the other representation behind.
  it("removes a custom-endpoint ref that resolves to the promoted model", async () => {
    chain = [{ type: "custom_endpoint", id: 5 }];

    await assignPersonalCapabilityToProvider(49, "deepseek", "text", (row) => ({ ...row, llm_id: 12 }));

    expect(chainWrites).toEqual([[]]);
  });

  it("leaves the chain alone when the promoted model is not in it", async () => {
    chain = [{ type: "llm", id: 99 }];

    await assignPersonalCapabilityToProvider(49, "deepseek", "text", (row) => ({ ...row, llm_id: 12 }));

    expect(chainWrites).toEqual([]);
  });

  it("does not touch the chain when promoting a non-text capability", async () => {
    chain = [{ type: "llm", id: 12 }];

    await assignPersonalCapabilityToProvider(49, "deepseek", "image", (row) => ({
      ...row,
      diffusion_model_id: 12,
    }));

    expect(chainWrites).toEqual([]);
  });
});

describe("removing a custom endpoint that was the personal text primary", () => {
  // The endpoint standing in for the promoted sibling: same label and capability, and
  // model_ref_id 12, which is also the chain entry that must not survive the promotion.
  const sibling = {
    custom_endpoint_id: 6,
    user_id: 49,
    server_id: null,
    label: "local",
    capability: "text",
    model_ref_id: 12,
    is_default: true,
  } as CustomEndpointRow;

  // This path promotes a sibling with a direct upsert rather than through
  // assignPersonalCapabilityToProvider, so it needs its own prune or the promoted model
  // stays in its own fallback chain.
  it("prunes the promoted sibling out of the user's chain", async () => {
    savedConfig = { user_id: 49, provider: "custom:u49:local", llm_id: 7 } as UserSavedProviderConfigRow;
    chain = [
      { type: "llm", id: 12 },
      { type: "llm", id: 99 },
    ];
    spies.push(
      spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockImplementation((async () => [
        sibling,
      ]) as never) as never,
    );

    const { removeCustomEndpointRegistration } = await import("@/utils/provider/customEndpointService");
    await removeCustomEndpointRegistration({
      scope: { kind: "personal", ownerId: 49, baseConfig: {} as never },
      customEndpointId: 5,
      label: "local",
      capability: "text",
      modelRefId: 7,
    });

    expect(chainWrites).toEqual([[{ type: "llm", id: 99 }]]);
  });

  it("leaves the chain alone when the removed model was not the active primary", async () => {
    savedConfig = { user_id: 49, provider: "custom:u49:local", llm_id: 99 } as UserSavedProviderConfigRow;
    chain = [{ type: "llm", id: 12 }];
    spies.push(
      spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockImplementation((async () => [
        sibling,
      ]) as never) as never,
    );

    const { removeCustomEndpointRegistration } = await import("@/utils/provider/customEndpointService");
    await removeCustomEndpointRegistration({
      scope: { kind: "personal", ownerId: 49, baseConfig: {} as never },
      customEndpointId: 5,
      label: "local",
      capability: "text",
      modelRefId: 7,
    });

    expect(chainWrites).toEqual([]);
  });
});
