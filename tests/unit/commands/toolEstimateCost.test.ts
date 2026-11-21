import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { execute as estimateCost, measureOpenRouterInputTokens } from "@/commands/tool/estimate/cost";
import { OpenrouterProvider, type OpenrouterProviderConfig } from "@/providers/openrouter/openrouterProvider";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { DeepseekProvider } from "@/providers/deepseek/deepseekProvider";
import { useEnvSandbox } from "../../helpers/env";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { localizedCopy } from "../../helpers/localeCases";
import { savedProviderConfigSchema, userSavedProviderConfigSchema } from "@/types/db/schema";
import { llmModelRepo, personaRepository } from "@/utils/db/repositories";
import * as credentials from "@/utils/provider/credentialResolver";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as channelPromptCache from "@/utils/cache/channelPromptCache";
import * as openrouterCache from "@/utils/cache/openrouterCapabilityCache";
import * as contextBudget from "@/utils/provider/contextBudget";
import { initializeLocalizer } from "@/utils/text/localizer";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
let configSpy: ReturnType<typeof spyOn<OpenrouterProvider, "createConfig">> | undefined;
let messagesSpy: ReturnType<typeof spyOn<OpenrouterStreamAdapter, "buildProbeMessages">> | undefined;

useEnvSandbox(["OPENROUTER_APP_ATTRIBUTION_ENABLED"]);
beforeAll(initializeLocalizer);

afterEach(() => {
  fetchSpy?.mockRestore();
  configSpy?.mockRestore();
  messagesSpy?.mockRestore();
});

describe("DeepSeek live token estimate", () => {
  it("counts tool definitions and visible chat history with thinking disabled", async () => {
    const model = createLlmRow({
      llm_id: 19,
      llm_provider: "deepseek",
      llm_codename: "deepseek-flash",
      input_price_per_million: 1,
      output_price_per_million: 2,
    });
    const state = createPersona({ llm: model, config: { thinking_level: "high" } });
    const fake = makeFakeInteraction({
      guild: { id: "fixture-guild", name: "Fixture guild" },
      guildId: "fixture-guild",
      channel: {
        id: "fixture-channel",
        isTextBased: () => true,
        isThread: () => false,
        messages: { fetch: async () => new Map() },
      },
    });
    const tools = [{ type: "function", function: { name: "roll_dice" } }];
    const probe = stubGlobalFetch((_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual(tools);
      expect(body.messages).toContainEqual(expect.objectContaining({ role: "assistant" }));
      if (body.thinking?.type !== "disabled") return new Response(null, { status: 400 });
      return Response.json({ usage: { prompt_tokens: 731 } });
    });
    const spies = [
      spyOn(DeepseekProvider.prototype, "createConfig").mockResolvedValue({
        apiKey: "fixture-key",
        model: model.llm_codename,
        endpointUrl: "https://api.deepseek.com/chat/completions",
        temperature: 0.7,
        tools,
      }),
      spyOn(personaRepository, "loadState").mockResolvedValue(state),
      spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(state),
      spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([state]),
      spyOn(channelPromptCache, "getCachedChannelPrompt").mockResolvedValue(null),
      spyOn(contextBudget, "applyProviderContextTruncation").mockImplementation(async () => [
        { role: "user", parts: [{ type: "text", text: "Roll a die." }] },
        { role: "model", parts: [{ type: "text", text: "The result is 3." }] },
        { role: "user", parts: [{ type: "text", text: "Try again." }] },
      ]),
      spyOn(llmModelRepo, "loadById").mockResolvedValue(model),
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
        provider: "deepseek",
        source: "server",
        modelId: 19,
        apiKey: "fixture-key",
        keyVersion: 1,
        savedConfig: savedProviderConfigSchema.parse({
          server_id: state.server_id,
          provider: "deepseek",
          llm_id: 19,
          thinking_level: "high",
          api_key: null,
          diffusion_model_id: null,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          nai_preset_name: null,
        }),
      }),
    ];
    try {
      await estimateCost(
        { user: { id: "fixture-bot" }, guilds: { cache: new Map() } } as unknown as Client,
        fake.interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
      );
      expect(probe).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fake.calls)).toContain(
        JSON.stringify(
          localizedCopy("en-US", "commands.tool.estimate.cost.current_input_value", {
            inputTokens: "731",
            inputCost: "$0.00073",
          }),
        ),
      );
    } finally {
      probe.mockRestore();
      for (const spy of spies.reverse()) spy.mockRestore();
    }
  });
});

describe("OpenRouter live token estimate attribution", () => {
  it("probes with the resolved personal model, settings and credential when the server has no key", async () => {
    const state = createPersona({ config: { api_key: null, custom_endpoint_url: "https://stale.invalid" } });
    const selected = createLlmRow({
      llm_id: 19,
      llm_provider: "openrouter",
      llm_codename: "fixture/selected-estimate",
      input_price_per_million: 1,
      output_price_per_million: 2,
    });
    const row = userSavedProviderConfigSchema.parse({
      user_id: 1,
      provider: "test-option",
      api_key: null,
      llm_id: 19,
      llm_temperature: 0.42,
      llm_max_output_tokens: 123,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    const fake = makeFakeInteraction({
      guild: { id: "fixture-guild", name: "Fixture guild" },
      guildId: "fixture-guild",
      channelId: "fixture-channel",
      channel: {
        id: "fixture-channel",
        name: "Fixture",
        topic: null,
        isTextBased: () => true,
        isThread: () => false,
        client: { user: { id: "fixture-bot" } },
        messages: { fetch: async () => new Map() },
      },
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const config = spyOn(OpenrouterProvider.prototype, "createConfig").mockImplementation(
      async (resolved, apiKey) =>
        ({
          apiKey,
          model: resolved.llm.llm_codename,
          temperature: resolved.config.llm_temperature,
          tools: [],
          seesImages: false,
          seesVideos: false,
        }) as OpenrouterProviderConfig,
    );
    const spies = [
      config,
      spyOn(personaRepository, "loadState").mockResolvedValue(state),
      spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(state),
      spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([state]),
      spyOn(channelPromptCache, "getCachedChannelPrompt").mockResolvedValue(null),
      spyOn(contextBudget, "applyProviderContextTruncation").mockImplementation(async (items) => items),
      spyOn(openrouterCache, "getOpenRouterPricing").mockReturnValue({
        promptPricePerMillion: 1,
        completionPricePerMillion: 2,
      }),
      spyOn(llmModelRepo, "loadById").mockResolvedValue(selected),
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
        provider: "openrouter",
        source: "personal",
        modelId: 19,
        apiKey: "fixture-selected-key",
        keyVersion: 1,
        savedConfig: row,
      }),
      spyOn(OpenrouterStreamAdapter.prototype, "buildProbeMessages").mockResolvedValue([]),
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            const url = String(input);
            calls.push({ url, init: init ?? {} });
            return url.includes("/generation")
              ? Response.json({ data: { native_prompt_tokens: 90 } })
              : Response.json({ id: "fixture-generation", usage: { prompt_tokens: 100, cost: 0.001 } });
          },
          { preconnect: fetch.preconnect },
        ),
      ),
    ];
    try {
      await estimateCost(
        { user: { id: "fixture-bot" }, guilds: { cache: new Map() } } as unknown as Client,
        fake.interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
      );
      expect(config.mock.calls[0]?.[0]).toMatchObject({
        llm: selected,
        config: { llm_temperature: 0.42, llm_max_output_tokens: 123, custom_endpoint_url: null },
      });
      const probe = calls.find((call) => call.url.includes("/chat/completions"));
      expect(JSON.parse(String(probe?.init.body))).toMatchObject({ model: selected.llm_codename });
      expect(new Headers(probe?.init.headers).get("Authorization")).toBe("Bearer fixture-selected-key");
      expect(state.config.custom_endpoint_url).toBe("https://stale.invalid");
    } finally {
      for (const spy of spies.reverse()) spy.mockRestore();
    }
  });
  it("attributes both probe requests and honors the attribution opt-out", async () => {
    configSpy = spyOn(OpenrouterProvider.prototype, "createConfig").mockResolvedValue({
      apiKey: "synthetic-key",
      model: "synthetic/model",
      temperature: 0.7,
      tools: [],
      seesImages: true,
      seesVideos: false,
    } as OpenrouterProviderConfig);
    messagesSpy = spyOn(OpenrouterStreamAdapter.prototype, "buildProbeMessages").mockResolvedValue([]);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = String(input);
          calls.push({ url, init: init ?? {} });
          return url.includes("/generation/")
            ? Response.json({ data: { native_prompt_tokens: 9 } })
            : Response.json({ id: "gen_synthetic", usage: { prompt_tokens: 10 } });
        },
        { preconnect: () => undefined },
      ),
    );
    const tomoriState = createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", input_price_per_million: 1, output_price_per_million: 2 }),
    });

    delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
    const measured = await measureOpenRouterInputTokens(tomoriState, "synthetic-key", []);
    expect(measured.inputTokens).toBe(9);
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      const headers = new Headers(init.headers);
      expect(headers.get("HTTP-Referer")).toBe("https://tomoribot.app");
      expect(headers.get("X-OpenRouter-Title")).toBe("TomoriBot");
    }

    calls.length = 0;
    process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = "false";
    await measureOpenRouterInputTokens(tomoriState, "synthetic-key", []);
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      const headers = new Headers(init.headers);
      expect(headers.has("HTTP-Referer")).toBe(false);
      expect(headers.has("X-OpenRouter-Title")).toBe(false);
    }
  });
});
