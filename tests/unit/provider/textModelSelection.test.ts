import { afterEach, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { customEndpointSchema, savedProviderConfigSchema, userSavedProviderConfigSchema } from "@/types/db/schema";
import { clearChannelLlmCache, setChannelLlmCache } from "@/utils/cache/channelLlmCache";
import { resolveTextCredentialPolicy } from "@/utils/chat/turnPlanner";
import { llmModelRepo } from "@/utils/db/repositories";
import * as credentials from "@/utils/provider/credentialResolver";
import { resolveServerTextModel, resolveTextCredentialState } from "@/utils/provider/textModelSelection";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";

const restore: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0).reverse()) spy.mockRestore();
  clearChannelLlmCache();
});

it("keeps the resolved model, sampler settings and endpoint together without changing the persona", async () => {
  const state = createPersona({
    config: { custom_endpoint_url: "https://stale.invalid", custom_model_name: "stale-model" },
  });
  const savedConfig = userSavedProviderConfigSchema.parse({
    user_id: 13,
    provider: "custom:7",
    api_key: Buffer.from("fixture-key"),
    llm_id: 9,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
    llm_temperature: 0.42,
    llm_top_p: 0.8,
    llm_max_output_tokens: 123,
  });
  const model = createLlmRow({ llm_id: 9, llm_provider: "custom:7" });
  const load = spyOn(llmModelRepo, "loadById").mockResolvedValue(model);
  restore.push(load);
  const resolved: credentials.ResolvedCredentials = {
    source: "personal",
    provider: "custom:7",
    modelId: 9,
    apiKey: "fixture-key",
    keyVersion: 1,
    savedConfig,
    customEndpoint: customEndpointSchema.parse({
      custom_endpoint_id: 5,
      connection_id: 7,
      server_id: state.server_id,
      label: "Fixture endpoint",
      capability: "text",
      api_style: "openai-compatible",
      endpoint_url: "https://selected.invalid",
      model_name: "selected-model",
      model_ref_id: 9,
      num_ctx: 8192,
    }),
  };
  expect(await resolveTextCredentialState(state, resolved)).toMatchObject({
    llm: model,
    config: {
      llm_id: 9,
      llm_temperature: 0.42,
      llm_top_p: 0.8,
      llm_max_output_tokens: 123,
      custom_endpoint_url: "https://selected.invalid",
      custom_model_name: "selected-model",
      custom_num_ctx: 8192,
    },
  });
  expect(state.config.custom_endpoint_url).toBe("https://stale.invalid");
  resolved.customEndpoint = undefined;
  expect((await resolveTextCredentialState(state, resolved)).config.custom_endpoint_url).toBeNull();
  load.mockResolvedValue(null);
  await expect(resolveTextCredentialState(state, resolved)).rejects.toBeInstanceOf(
    credentials.CredentialUnavailableError,
  );
});

it("shares persona, channel, thread-parent and workspace precedence with credential admission", async () => {
  const workspace = createLlmRow({ llm_id: 1, llm_provider: "google" });
  const persona = createLlmRow({ llm_id: 2, llm_provider: "openrouter" });
  const channelModel = createLlmRow({ llm_id: 3, llm_provider: "nvidia" });
  const parent = createLlmRow({ llm_id: 4, llm_provider: "deepseek" });
  const state = createPersona({ server_id: 7, llm: workspace });
  const channel = { id: "fixture-channel", parentId: "fixture-parent", isThread: () => true } as Message["channel"];
  const savedConfig = savedProviderConfigSchema.parse({
    server_id: 7,
    provider: "google",
    api_key: null,
    llm_id: 1,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  });
  const personal = spyOn(credentials, "resolvePersonalCapabilityCredentials").mockResolvedValue(null);
  const resolve = spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
    source: "server",
    provider: "google",
    apiKey: "fixture-key",
    keyVersion: 1,
    savedConfig,
  });
  restore.push(personal, resolve);
  for (const [personaModel, ownModel, parentModel, impersonation, expected] of [
    [null, null, null, false, workspace],
    [null, null, parent, false, parent],
    [null, channelModel, parent, false, channelModel],
    [persona, channelModel, parent, false, persona],
    [persona, channelModel, parent, true, workspace],
  ] as const) {
    state.persona_llm = personaModel ?? undefined;
    setChannelLlmCache(7, channel.id, ownModel);
    setChannelLlmCache(7, "fixture-parent", parentModel);
    expect(await resolveServerTextModel(state, channel, impersonation)).toBe(expected);
    await resolveTextCredentialPolicy({
      tomoriState: state,
      channel,
      userRow: createUserRow(),
      locale: "en-US",
      isSelfMessage: false,
      isPersonaJob: false,
      isUserImpersonation: impersonation,
      borrowsTriggerMessage: false,
      isDMChannel: false,
      shouldSurfaceUserErrors: false,
    });
    expect(resolve.mock.lastCall?.[2]?.textModel).toBe(expected);
  }
  personal.mockResolvedValue({
    source: "personal",
    provider: "nvidia",
    apiKey: "fixture-personal-key",
    keyVersion: 1,
    savedConfig: userSavedProviderConfigSchema.parse({ ...savedConfig, user_id: 1 }),
  });
  resolve.mockClear();
  expect(
    await resolveTextCredentialPolicy({
      tomoriState: state,
      channel,
      userRow: createUserRow(),
      locale: "en-US",
      isSelfMessage: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      borrowsTriggerMessage: false,
      isDMChannel: false,
      shouldSurfaceUserErrors: false,
    }),
  ).toMatchObject({ source: "personal", personalTextProvider: "nvidia" });
  expect(resolve).not.toHaveBeenCalled();
});

it("loads an invocation override's model metadata within the selected provider", async () => {
  const state = createPersona();
  const channel = { id: "fixture-channel", isThread: () => false } as Message["channel"];
  setChannelLlmCache(state.server_id, channel.id, null);
  const override = createLlmRow({ llm_id: 9, llm_codename: "fixture-override", sees_images: false });
  const load = spyOn(llmModelRepo, "loadByProviderAndCodename").mockResolvedValue(override);
  restore.push(load);
  expect(await resolveServerTextModel(state, channel, false, override.llm_codename)).toBe(override);
  expect(load).toHaveBeenCalledWith(state.llm.llm_provider, override.llm_codename);
  load.mockResolvedValue(null);
  expect(await resolveServerTextModel(state, channel, false, "unlisted-model")).toEqual({
    ...state.llm,
    llm_codename: "unlisted-model",
  });
});
