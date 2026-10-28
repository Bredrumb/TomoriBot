import { afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute } from "@/commands/persona/generate";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { llmModelRepo } from "@/utils/db/repositories";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import * as interactions from "@/utils/discord/interactionHelper";
import * as rateLimiter from "@/utils/security/rateLimiter";
import * as modelLimits from "@/utils/provider/modelLimits";
import * as features from "@/providers/utils/providerFeatureExecutors";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { notifyProviderToolFailure, ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { collectCaseFailures, localizedProse, RUNTIME_LOCALES } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
const restore: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0).reverse()) spy.mockRestore();
});

test("a failed persona search renders one localized abort with the inputs and no provider detail", async () => {
  const state = createPersona({
    llm: createLlmRow({ llm_provider: "google", supports_structoutput: true }),
    config: { web_search_enabled: true, api_key: null, custom_endpoint_url: "https://stale.invalid" },
  });
  const selected = createLlmRow({
    llm_id: 9,
    llm_provider: "openrouter",
    llm_codename: "fixture/selected-persona",
    supports_structoutput: true,
  });
  const requests: Parameters<typeof features.generatePresetForProvider>[0][] = [];
  let fake = createRouteInteraction({ kind: "modal" });
  const canary = "fixture-private-provider-detail";
  restore.push(
    spyOn(personaRepository, "loadState").mockResolvedValue(state),
    spyOn(llmModelRepo, "loadById").mockResolvedValue(selected),
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: state,
      activeConfigs: {},
    }),
    spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
      provider: "openrouter",
      apiKey: "fixture-api-key",
      keyVersion: 1,
      source: "personal",
      modelId: 9,
      savedConfig: userSavedProviderConfigSchema.parse({
        user_id: 1,
        provider: "test-option",
        api_key: state.config.api_key,
        llm_id: 9,
        llm_temperature: 0.42,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
      }),
    }),
    spyOn(interactions, "promptWithRawModal").mockImplementation(async () => ({
      outcome: "submit",
      interaction: fake as unknown as ModalSubmitInteraction,
      values: { character_name: "Juno", character_info: "A fictional explorer.", web_search: "yes" },
    })),
    spyOn(rateLimiter, "reservePersonaQuota").mockReturnValue({ allowed: true }),
    spyOn(modelLimits, "resolveModelLimits").mockResolvedValue({ contextWindow: 8192, maxOutputTokens: 4096 }),
    spyOn(features, "generatePresetForProvider").mockImplementation(async (request) => {
      requests.push(request);
      const { toolContext } = request;
      if (!toolContext) throw new Error("Missing persona search context");
      const denied = new ProviderRequestDeniedError(undefined, () => ({
        titleKey: "general.errors.api_key_error_title",
        description: canary,
      }));
      await notifyProviderToolFailure(toolContext, denied);
      return { error: canary, errorType: "CONNECTION", failureStage: "web_search" };
    }),
  );
  const failures = collectCaseFailures();
  for (const locale of RUNTIME_LOCALES) {
    fake = createRouteInteraction({ kind: "modal" });
    const send = spyOn(fake.channel, "send").mockResolvedValue(undefined);
    restore.push(send);
    await execute(
      fake.client as unknown as Client,
      fake as unknown as ChatInputCommandInteraction,
      createUserRow(),
      locale,
    );
    failures.check(locale, () => {
      const copyLocale = hasLocaleKey(locale, "commands.persona.generate.web_search_failed_title") ? locale : "en-US";
      const receipt = collectTextDisplays(fake.edits.at(-1)).join("\n");
      expect(receipt).toMatch(localizedProse(copyLocale, "commands.persona.generate.web_search_failed_title"));
      expect(receipt).toMatch(localizedProse(copyLocale, "commands.persona.generate.web_search_failed_description"));
      expect(receipt).not.toContain(canary);
      expect(fake.edits.at(-1)).toMatchObject({ files: [expect.anything()] });
      expect(
        fake.edits.filter((payload) =>
          collectTextDisplays(payload)
            .join("\n")
            .match(localizedProse(copyLocale, "commands.persona.generate.web_search_failed_title")),
        ),
      ).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
    });
  }
  failures.expectNoFailures();
  expect(requests).toHaveLength(RUNTIME_LOCALES.length);
  for (const request of requests) {
    expect(request).toMatchObject({
      providerName: "openrouter",
      apiKey: "fixture-api-key",
      tomoriState: { llm: selected, config: { llm_temperature: 0.42, custom_endpoint_url: null } },
    });
  }
});
