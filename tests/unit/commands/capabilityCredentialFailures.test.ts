import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as generatePersona } from "@/commands/persona/generate";
import { execute as initializeExpressions } from "@/commands/expressions/initialize";
import { execute as estimateCost } from "@/commands/tool/estimate/cost";
import { executeCompactCommand } from "@/utils/compaction/compact/commandImplementation";
import { llmModelRepo, personaRepository, serverRepository } from "@/utils/db/repositories";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import { getAllEmotionKeys } from "@/types/misc/emotions";
import * as features from "@/providers/utils/providerFeatureExecutors";
import * as compactModal from "@/utils/compaction/compact/modal";
import * as compactSummary from "@/utils/compaction/compact/summaryGeneration";
import * as compactHistory from "@/utils/compaction/compact/historyExtraction";
import * as compactSupplementary from "@/utils/compaction/compact/supplementaryContext";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modals from "@/utils/discord/ui/modals";
import * as emojiSync from "@/utils/cache/emojiLazySync";
import * as stickerSync from "@/utils/cache/stickerLazySync";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import * as quotas from "@/utils/security/rateLimiter";
import { ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow, createLlmRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("capability command credential failures", () => {
  it("renders expected denials without operational errors and preserves persona modal input", async () => {
    const persona = createPersona({
      llm: createLlmRow({ llm_provider: "google", sees_images: true, supports_structoutput: true }),
      config: { api_key: Buffer.from("synthetic-encrypted-key") },
    });
    spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
    spies.push(spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona));
    spies.push(
      spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
        tomoriState: persona,
        activeConfigs: {},
      }),
    );
    spies.push(spyOn(emojiSync, "lazySyncGuildEmojis").mockResolvedValue(true));
    spies.push(spyOn(stickerSync, "lazySyncGuildStickers").mockResolvedValue(true));
    spies.push(spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(null));
    const resolver = spyOn(credentials, "resolveCapabilityCredentials");
    spies.push(resolver);
    const errors = spyOn(log, "error").mockImplementation(async () => {});
    spies.push(errors);
    const quota = spyOn(quotas, "reservePersonaQuota");
    spies.push(quota);
    const modal = makeFakeInteraction({ deferred: true });
    const prompt = spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
      expect(resolver).not.toHaveBeenCalled();
      return {
        outcome: "submit",
        interaction: modal.interaction as unknown as ModalSubmitInteraction,
        values: { character_name: "Mirri", character_info: "Synthetic character input", web_search: "no" },
      };
    });
    spies.push(prompt);
    const cases = [
      {
        error: new credentials.CredentialUnavailableError("google", "text", "no_saved_config"),
        key: "general.errors.api_key_missing_description",
      },
      {
        error: new credentials.CredentialUnavailableError("google", "text", "decryption_failed"),
        key: "general.errors.api_key_error_description",
      },
      {
        error: new credentials.CredentialUnavailableError("google", "text", "decryption_failed", "personal"),
        key: "general.errors.personal_provider_credentials_error_description",
      },
      {
        error: new credentials.PersonalProviderRequiredError("text"),
        key: "general.errors.personal_provider_required_description",
      },
      {
        error: new ProviderRequestDeniedError(undefined, (locale) => ({
          titleKey: "general.errors.api_key_error_title",
          description: localizedCopy(locale, "general.errors.api_key_error_description"),
        })),
        key: "general.errors.api_key_error_description",
      },
    ];
    for (const command of [generatePersona, initializeExpressions, executeCompactCommand, estimateCost]) {
      for (const { error, key } of cases) {
        resolver.mockClear();
        resolver.mockRejectedValue(error);
        modal.calls.length = 0;
        const fake = makeFakeInteraction({
          guild: { id: "synthetic-guild", name: "Synthetic guild" },
          channel: {},
          memberPermissions: { has: () => true },
        });
        Object.assign(fake.interaction.options, {
          getChannel: () => null,
          getString: (name: string) => (name === "type" ? "conversation" : null),
        });
        await command(
          {} as Client,
          fake.interaction as unknown as ChatInputCommandInteraction,
          createUserRow(),
          "en-US",
        );
        expect(resolver).toHaveBeenCalledTimes(1);
        const payloads = [...fake.calls, ...modal.calls].filter((call) => call.method === "editReply");
        const serialized = JSON.stringify(payloads);
        if (
          command === estimateCost &&
          error instanceof credentials.CredentialUnavailableError &&
          error.reason === "no_saved_config" &&
          error.source === "server"
        ) {
          expect(serialized).toContain(localizedCopy("en-US", "commands.tool.estimate.cost.fallback_notice_value"));
        } else {
          expect(serialized).toContain(localizedCopy("en-US", key));
        }
        expect(serialized).not.toContain(error.message);
        if (command === generatePersona) {
          const payload = modal.calls.at(-1)?.args[0] as { files?: Array<{ attachment: Buffer }> };
          expect(payload.files?.[0]?.attachment.toString()).toContain("Synthetic character input");
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });

  it("classifies expressions with the resolved vision model and its own credential", async () => {
    const primary = createLlmRow({
      llm_id: 9,
      llm_provider: "openrouter",
      sees_images: false,
      supports_structoutput: true,
    });
    const vision = createLlmRow({
      llm_id: 19,
      llm_provider: "openrouter",
      sees_images: true,
      supports_structoutput: true,
      llm_codename: "fixture/vision",
    });
    const state = createPersona({
      vision_llm: createLlmRow({ llm_id: 11, sees_images: true, supports_structoutput: true }),
      config: { custom_endpoint_url: "https://stale.invalid" },
    });
    const fake = makeFakeInteraction({
      guild: { id: "fixture-guild", name: "Fixture guild" },
      memberPermissions: { has: () => true },
    });
    Object.assign(fake.interaction.options, { getBoolean: () => false });
    const row = userSavedProviderConfigSchema.parse({
      user_id: 1,
      provider: "test-option",
      api_key: null,
      llm_id: 9,
      vision_llm_id: 19,
      llm_temperature: 0.63,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    spies.push(
      spyOn(personaRepository, "loadState").mockResolvedValue(state),
      spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
        tomoriState: state,
        activeConfigs: {},
      }),
      spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_serverId, capability) => ({
        provider: "openrouter",
        source: "personal",
        modelId: capability === "vision" ? 19 : 9,
        apiKey: capability === "vision" ? "fixture-vision-key" : "fixture-text-key",
        keyVersion: 1,
        savedConfig: row,
      })),
      spyOn(llmModelRepo, "loadById").mockImplementation(async (id) => (id === 19 ? vision : primary)),
      spyOn(emojiSync, "lazySyncGuildEmojis").mockResolvedValue(true),
      spyOn(stickerSync, "lazySyncGuildStickers").mockResolvedValue(true),
      spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(null),
      spyOn(serverRepository, "loadEmojisForClassification").mockResolvedValue([
        { emoji_disc_id: "12345678901234567", emoji_name: "fixture_expression", is_animated: false },
      ]),
      spyOn(serverRepository, "loadStickersForClassification").mockResolvedValue([]),
      spyOn(serverRepository, "initializeExpressions").mockResolvedValue({
        emojiDiscIds: ["12345678901234567"],
        stickerDiscIds: [],
      }),
    );
    const call = spyOn(features, "callExpressionInitializationForProvider").mockImplementation(async () => {
      return {
        success: true,
        data: {
          expressions: [
            { name: "fixture_expression", emotion_key: getAllEmotionKeys()[0], description: "A fictional expression." },
          ],
        },
      };
    });
    spies.push(call);
    await initializeExpressions(
      {} as Client,
      fake.interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0]).toMatchObject({
      providerName: "openrouter",
      model: vision.llm_codename,
      apiKey: "fixture-vision-key",
      endpointUrl: undefined,
    });
    expect(state.config.custom_endpoint_url).toBe("https://stale.invalid");
  });

  it("compacts through the resolved personal model and clears the server endpoint", async () => {
    const state = createPersona({ config: { custom_endpoint_url: "https://stale.invalid" } });
    const selected = createLlmRow({
      llm_id: 19,
      llm_provider: "openrouter",
      llm_codename: "fixture/compact",
      supports_structoutput: true,
    });
    const row = userSavedProviderConfigSchema.parse({
      user_id: 1,
      provider: "test-option",
      api_key: null,
      llm_id: 19,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    const fake = makeFakeInteraction({ channel: { messages: {}, send: async () => undefined }, deferred: true });
    Object.assign(fake.interaction.options, {
      getString: (name: string) => (name === "type" ? "conversation" : null),
      getChannel: () => null,
    });
    spies.push(
      spyOn(personaRepository, "loadState").mockResolvedValue(state),
      spyOn(llmModelRepo, "loadById").mockResolvedValue(selected),
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
        provider: "openrouter",
        source: "personal",
        modelId: 19,
        apiKey: "fixture-compact-key",
        keyVersion: 1,
        savedConfig: row,
      }),
      spyOn(compactModal, "promptForCompactOptions").mockResolvedValue({
        submitInteraction: fake.interaction as unknown as ModalSubmitInteraction,
        summaryType: "conversation",
        refresh: false,
        analyzeImages: false,
        systemPrompt: "fixture prompt",
      }),
      spyOn(compactHistory, "buildConversationContext").mockResolvedValue({
        conversationText: "fixture conversation",
        imageReferences: [],
        userIds: [],
      }),
      spyOn(compactSupplementary, "buildSupplementaryContext").mockResolvedValue(""),
    );
    const call = spyOn(compactSummary, "generateCompactSummary").mockResolvedValue({ error: "fixture unavailable" });
    spies.push(call);
    await executeCompactCommand(
      {} as Client,
      fake.interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    expect(call.mock.calls[0]?.[0]).toMatchObject({
      providerName: "openrouter",
      model: selected.llm_codename,
      apiKey: "fixture-compact-key",
      endpointUrl: undefined,
    });
    expect(state.config.custom_endpoint_url).toBe("https://stale.invalid");
  });
});
