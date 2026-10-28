import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { resolveTextCredentialPolicy } from "@/utils/chat/turnPlanner";
import { CredentialUnavailableError, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { registerProviderOption, type ProviderOptionDefinition } from "@/utils/provider/providerOptionRegistry";
import { ProviderRequestDeniedError, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  generationModelValue,
  GenerationModelUnavailableError,
  loadGenerationModelChoices,
  validateGenerationModelSelection,
} from "@/utils/provider/generationModels";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { encryptApiKey } from "@/utils/security/crypto";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Invocation model selection", () => {
  let refs: FixtureRefs;
  let imageId: number;
  let personalImageId: number;
  let textId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [image] =
      await testSql`SELECT diffusion_model_id FROM image_diffusion_models WHERE provider = 'google' AND NOT is_deprecated LIMIT 1`;
    const [text] = await testSql`SELECT llm_id FROM llms WHERE llm_provider = 'google' AND NOT is_deprecated LIMIT 1`;
    imageId = image.diffusion_model_id;
    textId = text.llm_id;
    await testSql`UPDATE server_model_configs SET llm_id = ${textId}, diffusion_model_id = ${imageId} WHERE server_id = ${refs.serverId}`;
    const [personal] = await testSql`
      INSERT INTO image_diffusion_models (provider, codename, is_scoped_registration)
      VALUES ('openrouter', '_rt_personal_generation_image', true) RETURNING diffusion_model_id
    `;
    personalImageId = personal.diffusion_model_id;
    await testSql`INSERT INTO scoped_model_registrations (user_id, diffusion_model_id) VALUES (${refs.userId}, ${personalImageId})`;
    for (const provider of ["google", "openrouter", "novelai"]) {
      for (const source of ["server", "personal"]) {
        const key = await encryptApiKey(`synthetic-${source}-${provider}`);
        if (source === "server") {
          await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id, diffusion_model_id)
            VALUES (${refs.serverId}, ${provider}, ${key.encrypted}, ${key.version}, ${provider === "google" ? textId : null}, ${provider === "google" ? imageId : null})`;
        } else {
          await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version)
            VALUES (${refs.userId}, ${provider}, ${key.encrypted}, ${key.version})`;
        }
      }
    }
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM image_diffusion_models WHERE diffusion_model_id = ${personalImageId}`;
  });

  it("offers all registered models on saved providers while keeping server and personal routes distinct", async () => {
    const choices = await loadGenerationModelChoices(refs.serverId, refs.userId, "image");
    const sameModel = choices.filter((choice) => choice.modelId === imageId && choice.provider === "google");
    expect(new Set(sameModel.map((choice) => choice.source))).toEqual(new Set(["server", "personal"]));
    expect(new Set(sameModel.map(generationModelValue)).size).toBe(2);
    expect(choices).toContainEqual(
      expect.objectContaining({ modelId: personalImageId, source: "personal", provider: "openrouter" }),
    );
    expect(choices.some((choice) => choice.modelId === personalImageId && choice.source === "server")).toBe(false);
    expect(
      (await loadGenerationModelChoices(refs.serverId, null, "image")).some(
        (choice) => choice.modelId === personalImageId,
      ),
    ).toBe(false);
  });

  it("uses an inactive personal provider's key for an explicit model and leaves saved selections unchanged", async () => {
    const selection: GenerationModelSelection = {
      source: "personal",
      kind: "image",
      modelId: personalImageId,
      provider: "openrouter",
    };
    const creds = await resolveCapabilityCredentials(refs.serverId, "image-standard", {
      userId: refs.userId,
      modelSelection: selection,
    });
    expect(creds).toMatchObject({
      source: "personal",
      modelId: personalImageId,
      provider: "openrouter",
      apiKey: "synthetic-personal-openrouter",
    });
    const saved = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "openrouter");
    expect(saved?.diffusion_model_id).toBeNull();
    expect(saved?.enabled_capabilities).toEqual([]);
    expect((await resolveCapabilityCredentials(refs.serverId, "image-standard", { userId: refs.userId })).source).toBe(
      "server",
    );
  });

  it("rejects forged scope, capability, missing models, and server routes in BYOK mode", async () => {
    const selection: GenerationModelSelection = {
      source: "server",
      kind: "image",
      modelId: personalImageId,
      provider: "openrouter",
    };
    for (const candidate of [
      selection,
      { ...selection, source: "personal" as const, modelId: -1 },
      { ...selection, kind: "video" as const },
    ]) {
      await expect(
        resolveCapabilityCredentials(refs.serverId, "image-standard", {
          userId: refs.userId,
          modelSelection: candidate,
        }),
      ).rejects.toBeInstanceOf(GenerationModelUnavailableError);
    }
    await testSql`UPDATE server_byok_configs SET user_byok_mode = true WHERE server_id = ${refs.serverId}`;
    try {
      const choices = await loadGenerationModelChoices(refs.serverId, refs.userId, "image");
      expect(choices.length).toBeGreaterThan(0);
      expect(choices.every((choice) => choice.source === "personal")).toBe(true);
      await expect(
        resolveCapabilityCredentials(refs.serverId, "image-standard", {
          userId: refs.userId,
          modelSelection: { ...selection, provider: "google", modelId: imageId },
        }),
      ).rejects.toBeInstanceOf(GenerationModelUnavailableError);
    } finally {
      await testSql`UPDATE server_byok_configs SET user_byok_mode = false WHERE server_id = ${refs.serverId}`;
    }
  });

  it("revalidates a removed registration instead of using a default", async () => {
    await testSql`DELETE FROM scoped_model_registrations WHERE user_id = ${refs.userId} AND diffusion_model_id = ${personalImageId}`;
    try {
      await expect(
        resolveCapabilityCredentials(refs.serverId, "image-standard", {
          userId: refs.userId,
          modelSelection: { source: "personal", kind: "image", modelId: personalImageId, provider: "openrouter" },
        }),
      ).rejects.toBeInstanceOf(GenerationModelUnavailableError);
    } finally {
      await testSql`INSERT INTO scoped_model_registrations (user_id, diffusion_model_id) VALUES (${refs.userId}, ${personalImageId})`;
    }
  });

  it("builds scene state with the chosen model and personal samplers without changing the persona", async () => {
    await testSql`UPDATE user_saved_provider_configs SET llm_temperature = 0.42, llm_max_output_tokens = 123 WHERE user_id = ${refs.userId} AND provider = 'google'`;
    const model = await llmModelRepo.loadById(textId);
    if (!model) throw new Error("Missing text fixture");
    const persona = createPersona({
      server_id: refs.serverId,
      llm: model,
      config: { model_randomizer_enabled: true, fallback_llm_ids: [textId] },
    });
    const policy = await resolveTextCredentialPolicy({
      tomoriState: persona,
      isSelfMessage: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      borrowsTriggerMessage: false,
      userRow: createUserRow({ user_id: refs.userId }),
      channel: {} as Message["channel"],
      locale: "en-US",
      isDMChannel: false,
      shouldSurfaceUserErrors: false,
      modelSelection: { source: "personal", kind: "text", modelId: textId, provider: "google" },
    });
    expect(policy?.source).toBe("personal");
    expect(policy?.modelState?.llm.llm_id).toBe(textId);
    expect(policy?.modelState?.config.llm_temperature).toBeCloseTo(0.42);
    expect(policy?.modelState?.config.llm_max_output_tokens).toBe(123);
    expect(policy?.modelState?.config.model_randomizer_enabled).toBe(false);
    expect(policy?.modelState?.config.fallback_llm_ids).toEqual([]);
    expect(persona.config.model_randomizer_enabled).toBe(true);
    expect(persona.config.fallback_llm_ids).toEqual([textId]);
  });

  it("lists NovelAI models in the dedicated command for personal providers and a server optional key", async () => {
    const choices = await loadGenerationModelChoices(refs.serverId, refs.userId, "image-nai");
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every((choice) => choice.kind === "image-nai" && choice.provider === "novelai")).toBe(true);
    const personal = choices.find((choice) => choice.source === "personal");
    if (!personal) throw new Error("Missing personal NovelAI model");
    expect(
      await resolveCapabilityCredentials(refs.serverId, "image-nai", { userId: refs.userId, modelSelection: personal }),
    ).toMatchObject({
      source: "personal",
      modelId: personal.modelId,
      apiKey: "synthetic-personal-novelai",
    });
    const saved = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "novelai");
    if (!saved) throw new Error("Missing NovelAI credential fixture");
    const key = await encryptApiKey("synthetic-optional-novelai");
    await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'novelai'`;
    await testSql`INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version) VALUES (${refs.serverId}, 'novelai', ${key.encrypted}, ${key.version})`;
    try {
      const optionalChoices = await loadGenerationModelChoices(refs.serverId, refs.userId, "image-nai");
      const server = optionalChoices.find((choice) => choice.source === "server");
      if (!server) throw new Error("Missing optional-key NovelAI model");
      expect(await validateGenerationModelSelection(refs.serverId, refs.userId, server)).toMatchObject({
        modelId: server.modelId,
        source: "server",
      });
    } finally {
      await testSql`DELETE FROM opt_api_keys WHERE server_id = ${refs.serverId} AND service_name = 'novelai'`;
      await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, saved);
    }
  });

  it("resolves an unselected hosted speech model and custom endpoint with their credential owners", async () => {
    const models = await llmModelRepo.loadAvailableSpeechModels("google", { kind: "personal", ownerId: refs.userId });
    const model = models.find((entry) => entry.voice_mode === "design");
    if (!model) throw new Error("Missing speech fixture");
    const targets = await resolveSpeechTargets(refs.serverId, refs.userId, {
      source: "personal",
      kind: "speech",
      provider: "google",
      modelId: model.speech_model_id,
    });
    expect(targets.design).toMatchObject({
      kind: "hosted-model",
      owner: { kind: "personal", ownerId: refs.userId },
      apiKey: "synthetic-personal-google",
    });
    expect(targets.clone).toBeNull();
    const endpoint = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Invocation speech",
      capability: "speech",
      apiStyle: "tts-clone",
      endpointUrl: "http://127.0.0.1:9001",
      requiresAuth: false,
      extraConfig: { voice_mode: "clone" },
    });
    if (!endpoint?.custom_endpoint_id || !endpoint.connection_id) throw new Error("Missing endpoint fixture");
    const custom = await resolveSpeechTargets(refs.serverId, refs.userId, {
      source: "server",
      kind: "speech-endpoint",
      provider: `custom:${endpoint.connection_id}`,
      modelId: endpoint.custom_endpoint_id,
    });
    expect(custom.clone).toMatchObject({
      kind: "custom-endpoint",
      owner: { kind: "server", ownerId: refs.serverId },
      apiKey: "",
    });
    expect(custom.design).toBeNull();
  });

  it("keeps explicit and default managed credentials separate from the catalog's BYOK selection", async () => {
    const text = (await llmModelRepo.loadAvailableModelsForProvider("openrouter", false))?.[0];
    const video = (await llmModelRepo.loadAvailableVideoGenerationModels("openrouter"))?.[0];
    if (!text?.llm_id || !video?.video_model_id) throw new Error("Missing managed catalog fixtures");
    const config = await configRepository.loadModelCapabilityIds(refs.serverId);
    const contexts: Record<"server" | "personal", ProviderUsageContext> = { server: {}, personal: {} };
    let owns = false;
    let refuse = false;
    const option: ProviderOptionDefinition = {
      value: "test-option",
      catalogProvider: "openrouter",
      capabilities: ["text", "image", "video", "speech-design", "speech-clone"],
      copy: {
        labelKey: "commands.providers.entry_kind_provider",
        entryDescriptionKeys: {
          server: "commands.providers.entry_kind_provider",
          personal: "commands.providers.entry_kind_provider",
        },
        addActionLabelKey: "commands.providers.select_add_provider",
        addActionDescriptionKeys: {
          server: "commands.providers.select_add_provider_description",
          personal: "commands.providers.select_add_provider_description",
        },
        removeImpactKey: "commands.providers.remove_impact_provider",
      },
      availability: () => ({ eligible: true }),
      selection: {
        load: async () => null,
        ensure: async () => true,
        claim: async () => true,
        remove: async () => "removed",
        owns: (scope) => owns && scope.kind === "server" && scope.modelConfig?.llm_id === text.llm_id,
        resolveCredentials: async (input) => {
          if ("usageContext" in input) return null;
          const { scope } = input;
          if (refuse)
            throw new ProviderRequestDeniedError(contexts[scope.kind], () => ({
              titleKey: "fixture",
              description: "fixture",
            }));
          return {
            apiKey: `synthetic-managed-${scope.kind}`,
            usageContext: contexts[scope.kind],
            savedProvider: "test-option",
          };
        },
      },
    };
    const dispose = registerProviderOption(option);
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, llm_id, llm_temperature)
      VALUES (${refs.serverId}, 'test-option', ${text.llm_id}, 0.37)`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, llm_id, diffusion_model_id, video_model_id, llm_temperature)
      VALUES (${refs.userId}, 'test-option', ${text.llm_id}, ${personalImageId}, ${video.video_model_id}, 0.42)`;
    await testSql`INSERT INTO scoped_model_registrations (server_id, diffusion_model_id) VALUES (${refs.serverId}, ${personalImageId})`;
    try {
      for (const source of ["server", "personal"] as const) {
        for (const [kind, capability, modelId] of [
          ["text", "text", text.llm_id],
          ["image", "image-standard", personalImageId],
          ["video", "video", video.video_model_id],
        ] as const) {
          const selected = { source, kind, modelId, provider: "test-option" };
          const before =
            source === "personal"
              ? await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "test-option")
              : await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "test-option");
          if (!before) throw new Error("Missing managed settings fixture");
          const credentials = await resolveCapabilityCredentials(refs.serverId, capability, {
            userId: refs.userId,
            modelSelection: selected,
          });
          expect(credentials).toMatchObject({
            source,
            provider: "openrouter",
            modelId,
            apiKey: `synthetic-managed-${source}`,
            savedConfig: { provider: "test-option" },
          });
          expect(credentials.savedConfig).toEqual(before);
          expect(credentials.usageContext).toBe(contexts[source]);
          const after =
            source === "personal"
              ? await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "test-option")
              : await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "test-option");
          expect(after).toEqual(before);
          refuse = true;
          await expect(
            resolveCapabilityCredentials(refs.serverId, capability, { userId: refs.userId, modelSelection: selected }),
          ).rejects.toBeInstanceOf(ProviderRequestDeniedError);
          refuse = false;
        }
      }
      const speech = await llmModelRepo.loadAvailableSpeechModels("openrouter", {
        kind: "server",
        ownerId: refs.serverId,
      });
      for (const source of ["server", "personal"] as const) {
        for (const mode of ["design", "clone"] as const) {
          const model = speech.find((entry) => entry.voice_mode === mode);
          if (!model) throw new Error("Missing managed speech catalog fixture");
          const selected = { source, provider: "test-option", kind: "speech" as const, modelId: model.speech_model_id };
          const targets = await resolveSpeechTargets(refs.serverId, refs.userId, selected);
          expect(targets[mode]).toMatchObject({
            apiKey: `synthetic-managed-${source}`,
            credentialProvider: "test-option",
            model: { speech_model_id: model.speech_model_id },
            owner: { kind: source, ownerId: source === "server" ? refs.serverId : refs.userId },
          });
          expect(targets[mode]?.kind === "hosted-model" && targets[mode].usageContext).toBe(contexts[source]);
          expect(targets[mode === "design" ? "clone" : "design"]).toBeNull();
          refuse = true;
          await expect(resolveSpeechTargets(refs.serverId, refs.userId, selected)).rejects.toBeInstanceOf(
            ProviderRequestDeniedError,
          );
          refuse = false;
        }
      }
      await testSql`UPDATE user_saved_provider_configs SET enabled_capabilities = ARRAY['text', 'image', 'video'], assigned_capabilities = ARRAY['text', 'image', 'video'] WHERE user_id = ${refs.userId} AND provider = 'test-option'`;
      for (const [capability, modelId] of [
        ["text", text.llm_id],
        ["image-standard", personalImageId],
        ["video", video.video_model_id],
      ] as const) {
        expect(await resolveCapabilityCredentials(refs.serverId, capability, { userId: refs.userId })).toMatchObject({
          source: "personal",
          modelId,
          apiKey: "synthetic-managed-personal",
        });
      }
      await testSql`UPDATE user_saved_provider_configs SET enabled_capabilities = '{}' WHERE user_id = ${refs.userId} AND provider = 'test-option'`;
      await testSql`UPDATE server_model_configs SET llm_id = ${text.llm_id}, diffusion_model_id = ${personalImageId}, video_model_id = ${video.video_model_id} WHERE server_id = ${refs.serverId}`;
      owns = true;
      for (const [capability, modelId] of [
        ["text", text.llm_id],
        ["image-standard", personalImageId],
        ["video", video.video_model_id],
      ] as const) {
        expect(await resolveCapabilityCredentials(refs.serverId, capability)).toMatchObject({
          source: "server",
          modelId,
          apiKey: "synthetic-managed-server",
        });
      }
      expect(
        await resolveCapabilityCredentials(refs.serverId, "text", {
          modelSelection: { source: "server", kind: "text", modelId: text.llm_id, provider: "openrouter" },
        }),
      ).toMatchObject({ apiKey: "synthetic-server-openrouter" });
      option.availability = () => ({ eligible: false });
      await expect(resolveCapabilityCredentials(refs.serverId, "text")).rejects.toBeInstanceOf(
        CredentialUnavailableError,
      );
      option.availability = () => ({ eligible: true });
      delete option.selection.resolveCredentials;
      await expect(resolveCapabilityCredentials(refs.serverId, "text")).rejects.toBeInstanceOf(
        CredentialUnavailableError,
      );
    } finally {
      dispose();
      await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId} AND provider = 'test-option'`;
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'test-option'`;
      await testSql`UPDATE server_model_configs SET llm_id = ${config?.llm_id}, diffusion_model_id = ${config?.diffusion_model_id}, video_model_id = ${config?.video_model_id} WHERE server_id = ${refs.serverId}`;
      await testSql`DELETE FROM scoped_model_registrations WHERE server_id = ${refs.serverId} AND diffusion_model_id = ${personalImageId}`;
    }
  });
});
