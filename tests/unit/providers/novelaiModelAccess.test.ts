import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { savedProviderConfigSchema, userSavedProviderConfigSchema } from "@/types/db/schema";
import { getNovelAIModelAccessError } from "@/providers/novelai/modelAccess";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { NovelaiProvider } from "@/providers/novelai/novelaiProvider";
import { prepareNovelAIRequest } from "@/providers/novelai/promptFitting";
import { clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { configModelOperations } from "@/utils/discord/interactions/configModelOperations";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as savedProviderConfig from "@/utils/provider/savedProviderConfig";
import * as personalProviderHelpers from "@/utils/provider/personalProviderHelpers";
import { providerPanelOperations } from "@/utils/provider/providerPanelOperations";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import * as crypto from "@/utils/security/crypto";
import { isOperatorActionableProviderError } from "@/utils/provider/providerErrorClassification";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createNaiPreset, createPersona, createServerConfig } from "../../helpers/fixtures";
import { naiPresetSections } from "@/db/seed/catalog/naiPresets";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
const restores: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore.mockRestore();
  clearNovelaiSubscriptionCache();
});

const xialong = createLlmRow({ llm_id: 2, llm_provider: "novelai", llm_codename: "xialong-v1", has_tools: false });

function serverRow() {
  return savedProviderConfigSchema.parse({
    ...createServerConfig(),
    server_id: 7,
    provider: "novelai",
    llm_id: 1,
    api_key: Buffer.from("stored-credential"),
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  });
}

function personalRow() {
  return userSavedProviderConfigSchema.parse({
    ...serverRow(),
    user_id: 8,
    enabled_capabilities: ["text"],
    assigned_capabilities: ["text"],
  });
}

describe("Xialong access", () => {
  it("applies model-matched samplers to the active server and saved NovelAI row on model switches", async () => {
    const row = {
      ...serverRow(),
      api_key: null,
      llm_temperature: 1.035,
      llm_disabled_params: ["temperature" as const],
    };
    const list = spyOn(llmModelRepo, "loadAvailableModelsForProvider");
    const savedWrite = spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true);
    restores.push(
      list,
      savedWrite,
      spyOn(savedProviderConfig, "loadSavedProvidersForCapability").mockResolvedValue([row]),
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(row),
      spyOn(configRepository, "loadNaiPresets").mockImplementation(async (target) => [
        createNaiPreset({ model_target: target }),
      ]),
      spyOn(configRepository, "updateModelConfig").mockResolvedValue(true),
      spyOn(configRepository, "updateChatConfig").mockResolvedValue(true),
      spyOn(configRepository, "updateNovelaiImagegenConfig").mockResolvedValue(true),
    );
    for (const [codename, target] of [
      ["kayra-v1", "kayra"],
      ["llama-3-erato-v1", "erato"],
      ["xialong-v1", "xialong"],
      ["glm-4-6", null],
    ] as const) {
      const model = createLlmRow({ llm_id: 2, llm_provider: "novelai", llm_codename: codename });
      list.mockResolvedValue([model]);
      const result = await configModelOperations.setCapabilityModel({
        tomoriState: createPersona({ server_id: 7, config: { llm_max_output_tokens: 512 } }),
        serverDiscId: "fixture-guild",
        capability: "text",
        provider: "novelai",
        modelId: 2,
      });
      expect(result.status).toBe("success");
      const preset = target ? createNaiPreset({ model_target: target }) : undefined;
      expect(savedWrite.mock.calls.at(-1)?.[1]).toMatchObject({
        llm_id: 2,
        nai_preset_name: preset?.preset_name ?? null,
        llm_temperature: preset?.parameters.temperature ?? 1,
        llm_disabled_params: [],
      });
    }
  });
  it("rechecks a key added after a keyless Xialong selection for either owner", async () => {
    const provider = new NovelaiProvider();
    restores.push(spyOn(provider, "validateApiKey").mockResolvedValue({ valid: true }));
    restores.push(
      stubGlobalFetch(() => Response.json({ tier: 1, active: true })),
      spyOn(ProviderFactory, "getProviderByName").mockResolvedValue(provider),
      spyOn(crypto, "encryptApiKey").mockResolvedValue({ encrypted: Buffer.from("encrypted"), version: 1 }),
      spyOn(savedProviderConfig, "buildSavedProviderConfigFromExistingOrDefaults").mockResolvedValue({
        ...serverRow(),
        llm_id: 2,
      }),
      spyOn(savedProviderConfig, "buildUserSavedProviderConfigFromExistingOrDefaults").mockResolvedValue({
        ...personalRow(),
        llm_id: 2,
      }),
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue({ ...serverRow(), llm_id: 2, api_key: null }),
      spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockResolvedValue({
        ...personalRow(),
        llm_id: 2,
        api_key: null,
      }),
      spyOn(llmModelRepo, "loadLlmById").mockResolvedValue(xialong),
    );
    const serverWrite = spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true);
    const personalWrite = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockResolvedValue(true);
    restores.push(serverWrite, personalWrite);
    const base = {
      serverDiscId: "guild",
      provider: "novelai",
      state: createPersona({ llm: xialong }),
      apiKey: "tablet-credential",
    };
    for (const input of [base, { ...base, scopeKind: "personal" as const, ownerId: 8 }]) {
      expect(await providerPanelOperations.addServerProvider(input)).toEqual({
        status: "novelai-unavailable",
        descriptionKey: "genai.novelai.xialong_opus",
      });
    }
    expect(serverWrite).not.toHaveBeenCalled();
    expect(personalWrite).not.toHaveBeenCalled();
  });

  it("checks each credential independently and allows selection before a key is saved", async () => {
    const fetch = stubGlobalFetch((_url, init) =>
      Response.json({ tier: new Headers(init?.headers).get("Authorization")?.includes("opus") ? 3 : 1, active: true }),
    );
    restores.push(fetch);
    expect(await getNovelAIModelAccessError("xialong-v1", null)).toBeNull();
    expect(await getNovelAIModelAccessError("glm-4-6", "tablet-key")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await getNovelAIModelAccessError("xialong-v1", "opus-key")).toBeNull();
    expect(await getNovelAIModelAccessError("xialong-v1", "tablet-key")).toBe("genai.novelai.xialong_opus");
    expect(await getNovelAIModelAccessError("xialong-v1", "opus-key")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes subscription facts when adding a previously cached credential", async () => {
    let tier = 3;
    const fetch = stubGlobalFetch(() => Response.json({ tier, active: true }));
    restores.push(fetch);
    expect(await getNovelAIModelAccessError("xialong-v1", "replaced-credential")).toBeNull();
    tier = 1;
    expect(await getNovelAIModelAccessError("xialong-v1", "replaced-credential", true)).toBe(
      "genai.novelai.xialong_opus",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("removes a cached active allowance when a fresh key check finds an inactive subscription", async () => {
    let active = true;
    const fetch = stubGlobalFetch(() => Response.json({ tier: 3, active }));
    restores.push(fetch);
    expect(await getNovelAIModelAccessError("xialong-v1", "expired-credential")).toBeNull();
    active = false;
    expect(await getNovelAIModelAccessError("xialong-v1", "expired-credential", true)).toBe(
      "genai.novelai.subscription_inactive",
    );
    expect(await getNovelAIModelAccessError("xialong-v1", "expired-credential")).toBe(
      "genai.novelai.subscription_inactive",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects inactive, unknown-tier, malformed, and unavailable subscriptions", async () => {
    for (const [body, key] of [
      [{ tier: 3, active: false }, "genai.novelai.subscription_inactive"],
      [{ tier: 99, active: true }, "genai.novelai.xialong_opus"],
      [{ tier: "invalid", active: true }, "genai.novelai.subscription_unavailable"],
    ] as const) {
      clearNovelaiSubscriptionCache();
      const fetch = stubGlobalFetch(() => Response.json(body));
      try {
        expect(await getNovelAIModelAccessError("xialong-v1", "test-credential")).toBe(key);
      } finally {
        fetch.mockRestore();
      }
    }
    restores.push(stubGlobalFetch(() => new Response("Unavailable", { status: 503 })));
    expect(await getNovelAIModelAccessError("xialong-v1", "test-credential")).toBe(
      "genai.novelai.subscription_unavailable",
    );
  });

  it("blocks server and personal model-selection writes on non-Opus keys", async () => {
    restores.push(
      stubGlobalFetch(() => Response.json({ tier: 2, active: true })),
      spyOn(crypto, "decryptApiKey").mockResolvedValue("scroll-credential"),
      spyOn(savedProviderConfig, "loadSavedProvidersForCapability").mockResolvedValue([serverRow()]),
      spyOn(savedProviderConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([personalRow()]),
      spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([xialong]),
    );
    const serverWrite = spyOn(configRepository, "updateModelConfig").mockResolvedValue(true);
    const personalWrite = spyOn(personalProviderHelpers, "setPersonalTextPrimary").mockResolvedValue(true);
    restores.push(serverWrite, personalWrite);
    const expected = { status: "novelai-unavailable", descriptionKey: "genai.novelai.xialong_opus" } as const;
    expect(
      await configModelOperations.setCapabilityModel({
        tomoriState: createPersona({ server_id: 7 }),
        serverDiscId: "guild",
        capability: "text",
        provider: "novelai",
        modelId: 2,
      }),
    ).toEqual(expected);
    expect(
      await personalConfigOperations.setCapabilityModel({
        userId: 8,
        userDiscId: "mirri",
        capability: "text",
        provider: "novelai",
        modelId: 2,
      }),
    ).toEqual(expected);
    expect(serverWrite).not.toHaveBeenCalled();
    expect(personalWrite).not.toHaveBeenCalled();
  });

  it("permits keyless selections for both owners and applies the server's Xialong default preset", async () => {
    const row = { ...serverRow(), api_key: null };
    const definition = naiPresetSections
      .flatMap((section) => section.rows)
      .find((preset) => preset.modelTarget === "xialong");
    if (!definition) throw new Error("Missing Xialong sampling definition");
    const preset = {
      nai_preset_id: 1,
      preset_name: definition.name,
      model_target: definition.modelTarget,
      is_default: true,
      preset_desc: definition.desc,
      descriptions: null,
      parameters: { ...definition.parameters },
    };
    restores.push(
      spyOn(savedProviderConfig, "loadSavedProvidersForCapability").mockResolvedValue([row]),
      spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([xialong]),
      spyOn(configRepository, "updateModelConfig").mockResolvedValue(true),
      spyOn(configRepository, "updateChatConfig").mockResolvedValue(true),
      spyOn(configRepository, "loadNaiPresets").mockResolvedValue([preset]),
      spyOn(savedProviderConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([
        { ...personalRow(), api_key: null },
      ]),
      spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockResolvedValue([]),
    );
    const apply = spyOn(configRepository, "applyNaiPreset").mockResolvedValue(true);
    restores.push(apply);
    const personalWrite = spyOn(personalProviderHelpers, "setPersonalTextPrimary").mockResolvedValue(true);
    restores.push(personalWrite);
    expect(
      (
        await configModelOperations.setCapabilityModel({
          tomoriState: createPersona({ server_id: 7 }),
          serverDiscId: "guild",
          capability: "text",
          provider: "novelai",
          modelId: 2,
        })
      ).status,
    ).toBe("success");
    expect(apply).toHaveBeenCalledWith(7, preset, xialong, "guild");
    expect(
      (
        await personalConfigOperations.setCapabilityModel({
          userId: 8,
          userDiscId: "mirri",
          capability: "text",
          provider: "novelai",
          modelId: 2,
        })
      ).status,
    ).toBe("success");
    expect(personalWrite).toHaveBeenCalledWith(8, "novelai", 2, []);
  });

  it("rechecks server replacement, rotation, and personal credentials before storing them", async () => {
    const provider = new NovelaiProvider();
    restores.push(spyOn(provider, "validateApiKey").mockResolvedValue({ valid: true }));
    restores.push(
      stubGlobalFetch(() => Response.json({ tier: 1, active: true })),
      spyOn(ProviderFactory, "getProviderByName").mockResolvedValue(provider),
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(serverRow()),
      spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockResolvedValue({ ...personalRow(), llm_id: 2 }),
      spyOn(llmModelRepo, "loadLlmById").mockImplementation(async (id) =>
        id === 2 ? xialong : createLlmRow({ llm_id: 1, llm_provider: "novelai", llm_codename: "glm-4-6" }),
      ),
    );
    const encrypt = spyOn(crypto, "encryptApiKey").mockResolvedValue({
      encrypted: Buffer.from("encrypted"),
      version: 1,
    });
    const serverWrite = spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true);
    const personalWrite = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockResolvedValue(true);
    restores.push(encrypt, serverWrite, personalWrite);
    const base = {
      serverDiscId: "guild",
      provider: "novelai",
      state: createPersona({ llm: xialong }),
      apiKey: "tablet-credential",
      rotationKey: "",
      deleteRotationKeys: false,
    };
    for (const input of [
      base,
      { ...base, apiKey: "", rotationKey: "tablet-rotation-credential" },
      { ...base, scopeKind: "personal" as const, ownerId: 8 },
    ]) {
      expect(await providerPanelOperations.editServerProvider(input)).toEqual({
        status: "novelai-unavailable",
        descriptionKey: "genai.novelai.xialong_opus",
      });
    }
    expect(encrypt).not.toHaveBeenCalled();
    expect(serverWrite).not.toHaveBeenCalled();
    expect(personalWrite).not.toHaveBeenCalled();
  });

  it("uses the selection key for preparation and observed HTTP tier errors in every locale", async () => {
    restores.push(stubGlobalFetch(() => Response.json({ tier: 1, active: true })));
    const adapter = new NovelaiStreamAdapter();
    const selectionKey = await getNovelAIModelAccessError("xialong-v1", "tablet-key");
    const errors = [400, 403].map((statusCode) =>
      adapter.handleProviderError(
        Object.assign(new Error("bad request: model 'xialong-v1' not allowed for current user tier 'Tablet'"), {
          statusCode,
        }),
      ),
    );
    try {
      await prepareNovelAIRequest({
        model: "xialong-v1",
        apiKey: "tablet-key",
        contextItems: [],
        tomoriState: createPersona(),
      });
      throw new Error("Expected tier rejection");
    } catch (error) {
      errors.push(adapter.handleProviderError(error));
    }
    expect(selectionKey).toBe("genai.novelai.xialong_opus");
    expectForEveryLocale((locale) => {
      for (const error of errors) {
        expect(adapter.createErrorDescription(error, locale)).toBe(
          localizedCopy(hasLocaleKey(locale, selectionKey ?? "") ? locale : "en-US", selectionKey ?? ""),
        );
        expect(error.retryable).toBe(false);
        expect(isOperatorActionableProviderError(error)).toBe(false);
      }
    });
  });
});
