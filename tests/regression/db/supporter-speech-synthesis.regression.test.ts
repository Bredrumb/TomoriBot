import { createSpeechCallerFixture } from "../../helpers/speechCallers";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import type { CustomEndpointRow } from "@/types/db/schema";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { execute as generateVoiceMessage } from "@/commands/generate/voice-message";
import { GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";
import { getAvailableToolsWithMCP } from "@/tools/availability";
import type { ToolContext, ToolAssemblyState } from "@/types/tool/interfaces";
import { storeVoiceSample, deleteStoredVoiceSample } from "@/utils/storage/voiceSampleStorage";
import { activateProviderSpeechDefaults } from "@/utils/provider/providerActivation";
import { buildProvidersPanelPayload } from "@/utils/discord/ui/providersPanel";
import { setPersonalCapabilityEnabled } from "@/utils/provider/personalProviderHelpers";
import { synthesizeVoiceMessage } from "@/utils/speech/voiceMessageSynthesis";
import { createMemberKeyMetadata } from "../../helpers/memberKeyMetadata";
import { useEnvSandbox } from "../../helpers/env";
import {
  initializeSupporterBillingSchema,
  SupporterIdentityRepository,
  SupporterEntitlementRepository,
  SupporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { providerPanelOperations, saveProviderModel } from "@/utils/provider/providerPanelOperations";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { initializeLocalizer } from "@/utils/text/localizer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import { setHostedSpeechSelection, setSpeechEndpointSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { encryptApiKey } from "@/utils/security/crypto";
import { createSpeechWav, createSpeechMp3 } from "../../helpers/speechAudio";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { cleanupFixtures, insertFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted speech synthesis lifecycle and fallback", () => {
  useEnvSandbox([
    "RUN_ENV",
    "TOMORI_SUPPORTER_BILLING_ENABLED",
    "TOMORI_SUPPORTER_CONFIG_JSON",
    "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  ]);
  let refs: FixtureRefs;
  let googleId: number;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let created: number;
  let synthesisStatuses: number[];
  let deleteFails: boolean;
  let creationExpiry: string;
  let malformedSynthesis: boolean;
  let upstreamError: string;
  let onCreate: (() => Promise<void>) | undefined;
  let onSynthesize: (() => Promise<void>) | undefined;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const wav = createSpeechWav();
  let mp3: Buffer;
  const serverScope = () => ({ kind: "server" as const, ownerId: refs.serverId });
  const personalScope = () => ({ kind: "personal" as const, ownerId: refs.userId });

  beforeAll(async () => {
    await setupTestDb();
    await initializeLocalizer();
    mp3 = await createSpeechMp3();
    refs = await insertFixtures(testSql);
    await testSql`INSERT INTO persona_voice_configs (persona_id) VALUES (${refs.personaId}) ON CONFLICT DO NOTHING`;
    const models = await llmModelRepo.loadAvailableSpeechModels("google", serverScope());
    googleId = models.find((model) => model.is_default)?.speech_model_id ?? 0;
    for (const personal of [false, true]) {
      const key = await encryptApiKey(personal ? "synthetic-personal-google" : "synthetic-server-google");
      if (personal)
        await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${refs.userId}, 'google', ${key.encrypted}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
      else
        await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${refs.serverId}, 'google', ${key.encrypted}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    }
  });

  beforeEach(async () => {
    created = 0;
    synthesisStatuses = [];
    deleteFails = false;
    creationExpiry = "2099-01-01T00:00:00Z";
    malformedSynthesis = false;
    upstreamError = "synthetic upstream content";
    onCreate = undefined;
    onSynthesize = undefined;
    requests.length = 0;
    await testSql`DELETE FROM speech_voice_bindings`;
    await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'Warm narration', speech_voice_id = 'preset_synthetic', voice_source_priority = 'design' WHERE persona_id = ${refs.personaId}`;
    await testSql`UPDATE server_byok_configs SET user_byok_mode = false WHERE server_id = ${refs.serverId}`;
    await testSql`INSERT INTO user_personalization_configs (user_id, personal_server_fallback_enabled) VALUES (${refs.userId}, true) ON CONFLICT (user_id) DO UPDATE SET personal_server_fallback_enabled = true`;
    await setHostedSpeechSelection(serverScope(), googleId);
    await setHostedSpeechSelection(personalScope(), googleId);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/keys/"))
            return Response.json({
              data: createMemberKeyMetadata({ hash: url.slice(url.lastIndexOf("/") + 1), limit: 0.1 }),
            });
          requests.push({ url, init: init ?? {} });
          if (init?.method === "DELETE")
            return deleteFails
              ? Response.json({ error: { message: upstreamError } }, { status: 500 })
              : new Response(null, { status: 204 });
          if (url.includes("openrouter.ai/api/v1/models"))
            return Response.json(
              url.endsWith("/endpoints")
                ? { data: { endpoints: [{ supports_voice_cloning: true }] } }
                : { data: [{ id: "fish-audio/s2.1-pro", pricing: { prompt: "0.000015", completion: "0" } }] },
            );
          if (url.endsWith("/audio/speech"))
            return new Response(new Uint8Array(mp3), { headers: { "Content-Type": "audio/mpeg" } });
          if (init?.method === "GET") return new Response(null, { status: 404 });
          if (url.endsWith("/voices")) {
            const voiceId = `voice_synthetic_${++created}`;
            await onCreate?.();
            return Response.json({
              id: voiceId,
              usage: { total_input_tokens: 11 },
              expire_time: creationExpiry,
            });
          }
          await onSynthesize?.();
          const status = synthesisStatuses.shift() ?? 200;
          if (status !== 200)
            return Response.json({ usage: { total_input_tokens: 3 }, error: { message: upstreamError } }, { status });
          if (url.startsWith("https://api.elevenlabs.io/"))
            return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav" } });
          const data = malformedSynthesis ? "invalid" : wav.toString("base64");
          malformedSynthesis = false;
          return Response.json({
            status: "completed",
            usage: { total_output_tokens: 9 },
            steps: [
              {
                type: "model_output",
                content: [{ type: "audio", mime_type: "audio/wav", data }],
              },
            ],
          });
        },
        { preconnect: () => undefined },
      ),
    );
  });

  afterEach(() => fetchSpy?.mockRestore());
  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("connects Subscription speech to both callers in server and personal scope", async () => {
    const [sample] =
      await testSql`INSERT INTO voice_samples (server_id, name, file_path, duration_ms) VALUES (${refs.serverId}, 'Synthetic sample', 'pending', 200) RETURNING sample_id`;
    const storedPath = await storeVoiceSample({ serverId: refs.serverId, sampleId: sample.sample_id, buffer: wav });
    if (!storedPath) throw new Error("Missing stored sample");
    await testSql`UPDATE voice_samples SET file_path = ${storedPath} WHERE sample_id = ${sample.sample_id}`;
    const key = await encryptApiKey("synthetic-openrouter");
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${refs.serverId}, 'openrouter', ${key.encrypted}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${refs.userId}, 'openrouter', ${key.encrypted}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    const endpoint = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Synthetic Auto",
      capability: "speech",
      apiStyle: "tts-clone",
      endpointUrl: "http://127.0.0.1:9000",
      requiresAuth: false,
      extraConfig: { voice_mode: "auto" },
    });
    if (!endpoint?.custom_endpoint_id) throw new Error("Missing custom target");
    const preset = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Synthetic ElevenLabs",
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      requiresAuth: true,
    });
    if (!preset?.custom_endpoint_id || !preset.connection_id) throw new Error("Missing preset target");
    const saved = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    if (!saved) throw new Error("Missing credential fixture");
    await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
      ...saved,
      provider: `custom:${preset.connection_id}`,
      api_key: key.encrypted,
      key_version: key.version,
    });
    await initializeSupporterBillingSchema(testSql);
    for (const personal of [false, true]) {
      const identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
        discordUserId: personal ? FIXTURE_IDS.userDiscId : "synthetic-server-sponsor",
        patreonUserId: `synthetic-voice-user-${personal}`,
        patreonMemberId: `synthetic-voice-member-${personal}`,
        patreonCampaignId: "synthetic-voice-campaign",
      });
      await new SupporterEntitlementRepository(testSql).upsertSnapshot({
        supporterIdentityId: identity.supporter_identity_id,
        tierKey: "test",
        patreonTierId: "test",
        patronStatus: "active_patron",
        isActive: true,
        source: "oauth",
        lastVerifiedAt: new Date(),
        periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 3_600_000),
      });
      const memberKeys = new MemberKeyRepository(testSql);
      const initial = await memberKeys.initialize(identity);
      const created = await memberKeys.storeCreated(
        initial,
        `synthetic-voice-hash-${personal}`,
        `synthetic-${personal ? "personal" : "server"}-member`,
      );
      await memberKeys.save({ ...created, applied_limit: 0.1, disabled: false, pending_action: null });
      if (!personal)
        await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
          serverId: refs.serverId,
          serverDiscId: FIXTURE_IDS.serverDiscId,
          sponsorIdentityId: identity.supporter_identity_id,
          createdByDiscId: "synthetic-server-sponsor",
        });
    }
    await testSql`INSERT INTO saved_provider_configs (server_id, provider) VALUES (${refs.serverId}, 'supporter') ON CONFLICT DO NOTHING`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider) VALUES (${refs.userId}, 'supporter') ON CONFLICT DO NOTHING`;
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: "synthetic-voice-campaign",
        oauthClientIdEnv: "CLIENT_ID",
        oauthClientSecretEnv: "CLIENT_SECRET",
        webhookSecretEnv: "WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/example",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        test: {
          displayNameKey: "supporter.tiers.test",
          patreonTierIds: ["test"],
          monthlyBudgetMicros: 100000,
          defaultModelByCapability: { text: "example/text", voice: { clone: "fish-audio/s2.1-pro" } },
        },
      },
    });
    let persona = createPersona({
      persona_id: refs.personaId,
      server_id: refs.serverId,
      speech_voice_design_prompt: "Warm narration",
      speech_voice_sample_id: sample.sample_id,
      speech_voice_id: "preset_synthetic",
      config: { voice_message_enabled: true },
    });
    const callers = createSpeechCallerFixture(() => persona);
    const { channel, modal } = callers;
    try {
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      const previousTargets: CustomEndpointRow[] = [endpoint, preset];
      for (const previous of previousTargets) {
        for (const personal of [false, true]) {
          await testSql`UPDATE user_saved_provider_configs SET enabled_capabilities = '{}', assigned_capabilities = '{}' WHERE user_id = ${refs.userId}`;
          expect(await setSpeechEndpointSelection(refs.serverId, endpoint.custom_endpoint_id)).toBe(true);
          if (previous === preset)
            expect(await setSpeechEndpointSelection(refs.serverId, preset.custom_endpoint_id)).toBe(true);
          expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.endpoint?.custom_endpoint_id).toBe(
            previous.custom_endpoint_id,
          );
          const scope = personal ? personalScope() : serverScope();
          expect(await activateProviderSpeechDefaults(scope, "google")).toBe(true);
          expect(
            await saveProviderModel({
              serverDiscId: FIXTURE_IDS.serverDiscId,
              ownerId: scope.ownerId,
              scopeKind: scope.kind,
              state: persona,
              entryId: "provider:supporter",
              capability: "speech",
              codeName: "fish-audio/s2.1-pro",
            }),
          ).toMatchObject({ status: "success" });
          for (const mode of ["design", "clone"] as const) {
            persona = { ...persona, voice_source_priority: mode };
            await testSql`UPDATE persona_voice_configs SET speech_voice_sample_id = ${sample.sample_id}, voice_source_priority = ${mode} WHERE persona_id = ${refs.personaId}`;
            const targets = await resolveSpeechTargets(refs.serverId, refs.userId);
            expect(targets[mode]?.owner.kind).toBe(personal ? "personal" : "server");
            expect(targets[mode]?.kind).toBe("hosted-model");
            const command = makeFakeInteraction({ guildId: FIXTURE_IDS.serverDiscId, channel });
            Object.assign(command.interaction.options, { getAttachment: () => null });
            const before = requests.length;
            await generateVoiceMessage(
              {} as Client,
              command.interaction as unknown as ChatInputCommandInteraction,
              createUserRow({ user_id: refs.userId }),
              "en-US",
            );
            expect(
              requests
                .slice(before)
                .some(({ url }) => url.endsWith(mode === "design" ? "/interactions" : "/audio/speech")),
            ).toBe(true);
            const tool = new GenerateVoiceMessageTool();
            const speechToolState: NonNullable<ToolAssemblyState["speechToolState"]> = { userId: refs.userId };
            const available = await getAvailableToolsWithMCP([tool], "google", {
              server_id: String(refs.serverId),
              speechToolState,
              activePersonaHasElevenlabsVoice: true,
              activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt,
              activePersonaVoiceSampleId: persona.speech_voice_sample_id,
              activePersonaVoiceSourcePriority: mode,
              llm: persona.llm,
              config: persona.config,
            });
            expect(available.builtInTools.map((entry) => entry.name)).toContain("generate_voice_message");
            const result = await tool.execute({ title: "test", script: "Hello" }, {
              tomoriState: persona,
              channel,
              internalUserId: refs.userId,
              streamContext: { speechToolState },
              locale: "en-US",
            } as unknown as ToolContext);
            expect(result.success).toBe(true);
            const speechRequests = requests.slice(before).filter(({ url }) => url.endsWith("/audio/speech"));
            if (mode === "clone") {
              expect(speechRequests).toHaveLength(2);
              for (const { init } of speechRequests)
                expect(new Headers(init.headers).get("Authorization")).toBe(
                  `Bearer synthetic-${personal ? "personal" : "server"}-member`,
                );
            }
            for (const secret of ["synthetic-personal-member", "synthetic-server-member"]) {
              expect(JSON.stringify({ result, command: command.calls, modal: modal.calls })).not.toContain(secret);
            }
            expect(result.data).toMatchObject({
              mode,
              target: mode === "design" ? "gemini-3.8-flash-tts" : "fish-audio/s2.1-pro",
            });
          }
        }
      }
      expect(callers.delivered).toBe(16);
      for (const scope of [serverScope(), personalScope()]) {
        const row =
          scope.kind === "personal"
            ? await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, "supporter")
            : await llmProviderRepo.loadSavedProviderConfig(scope.ownerId, "supporter");
        expect(row?.api_key).toBeNull();
      }
      expect(await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "openrouter")).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.apiKey).toBe("synthetic-personal-member");
      expect(
        await saveProviderModel({
          serverDiscId: FIXTURE_IDS.serverDiscId,
          ownerId: refs.serverId,
          scopeKind: "server",
          state: persona,
          entryId: "provider:supporter",
          capability: "speech",
          codeName: "fish-audio/s2.1-pro",
        }),
      ).toMatchObject({ status: "success" });
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone).toBeNull();
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      expect(await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "openrouter")).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-server-member");
      await testSql`UPDATE server_byok_configs SET user_byok_mode = true WHERE server_id = ${refs.serverId}`;
      expect(await setPersonalCapabilityEnabled(refs.userId, "speech_clone", false)).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone).toBeNull();
      await testSql`UPDATE server_byok_configs SET user_byok_mode = false WHERE server_id = ${refs.serverId}`;
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.apiKey).toBe("synthetic-server-member");
      expect(await setPersonalCapabilityEnabled(refs.userId, "speech_clone", true)).toBe(true);
      const target = (await resolveSpeechTargets(refs.serverId, refs.userId)).clone;
      if (!target) throw new Error("Missing personal subscription speech target");
      const memberKeys = new MemberKeyRepository(testSql);
      const oldKey = await memberKeys.load("synthetic-voice-member-true");
      if (!oldKey) throw new Error("Missing personal member key");
      const changed = await memberKeys.storeCreated(oldKey, "synthetic-rotated-voice-hash", "synthetic-rotated-member");
      await memberKeys.save({ ...changed, applied_limit: 0.1, disabled: false, pending_action: null });
      const before = requests.length;
      const stale = await synthesizeVoiceMessage({
        target,
        endpoint: null,
        endpointApiKey: "",
        elevenLabsApiKey: "",
        script: "Hello",
        source: { kind: "clone-buffer", refAudio: wav, refText: null },
      });
      expect(stale.success).toBe(false);
      expect(stale.errorKind).toBe("invalid_request");
      expect(requests).toHaveLength(before);
      await testSql`UPDATE supporter_entitlements SET is_active = false WHERE supporter_identity_id = ${oldKey.supporter_identity_id}`;
      const inactive = await resolveSpeechTargets(refs.serverId, refs.userId);
      expect(inactive.clone?.apiKey).toBe("synthetic-server-member");
      expect(inactive.clone?.owner).toEqual(serverScope());
      expect(inactive.design?.apiKey).toBe("synthetic-personal-google");
      const panels = await Promise.all([
        providerPanelOperations.loadServerProviderPanelScope(FIXTURE_IDS.serverDiscId, true),
        providerPanelOperations.loadPersonalProviderPanelScope(FIXTURE_IDS.userDiscId, FIXTURE_IDS.serverDiscId),
      ]);
      for (const panel of panels) {
        if (!panel) throw new Error("Missing provider panel");
        const payload = buildProvidersPanelPayload({
          ...panel.data,
          locale: "en-US",
          page: { kind: "entry", entryId: "provider:supporter" },
          routeNamespace: panel.routeNamespace,
        });
        const serialized = JSON.stringify(payload);
        for (const secret of ["synthetic-server-member", "synthetic-personal-member", "synthetic-rotated-member"]) {
          expect(serialized).not.toContain(secret);
        }
      }
    } finally {
      callers.restore();
      await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = 'synthetic-voice-campaign'`;
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "supporter");
      await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "supporter");
      await deleteStoredVoiceSample(storedPath);
      await testSql`UPDATE persona_voice_configs SET speech_voice_sample_id = NULL WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM voice_samples WHERE sample_id = ${sample.sample_id}`;
    }
  });

  it("resolves refused server Subscription speech to no target when funding is unavailable or revoked", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: "synthetic-speech-refusal-campaign",
        oauthClientIdEnv: "CLIENT_ID",
        oauthClientSecretEnv: "CLIENT_SECRET",
        webhookSecretEnv: "WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/example",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        test: {
          displayNameKey: "supporter.tiers.test",
          patreonTierIds: ["test"],
          monthlyBudgetMicros: 100000,
          defaultModelByCapability: { text: "example/text", voice: { clone: "fish-audio/s2.1-pro" } },
        },
      },
    });
    await initializeSupporterBillingSchema(testSql);
    const fish = (await llmModelRepo.loadAvailableSpeechModels("openrouter", serverScope())).find(
      (model) => model.codename === "fish-audio/s2.1-pro",
    );
    if (!fish) throw new Error("Missing Fish speech model");
    const identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
      discordUserId: "synthetic-speech-refusal-sponsor",
      patreonUserId: "synthetic-speech-refusal-user",
      patreonMemberId: "synthetic-speech-refusal-member",
      patreonCampaignId: "synthetic-speech-refusal-campaign",
    });
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "test",
      patreonTierId: "test",
      patronStatus: "active_patron",
      isActive: true,
      source: "oauth",
      lastVerifiedAt: new Date(),
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
    });
    const memberKeys = new MemberKeyRepository(testSql);
    const initial = await memberKeys.initialize(identity);
    const createdKey = await memberKeys.storeCreated(
      initial,
      "synthetic-speech-refusal-hash",
      "synthetic-speech-refusal-member",
    );
    await memberKeys.save({ ...createdKey, applied_limit: 0.1, disabled: false, pending_action: null });
    const sponsorship = await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: identity.supporter_identity_id,
      createdByDiscId: "synthetic-speech-refusal-sponsor",
    });
    await testSql`INSERT INTO saved_provider_configs (server_id, provider) VALUES (${refs.serverId}, 'supporter') ON CONFLICT DO NOTHING`;
    const markers = async () =>
      (await testSql`SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${refs.serverId}`)[0]
        .subscription_capabilities as string[];
    try {
      expect(
        await setHostedSpeechSelection(serverScope(), fish.speech_model_id, undefined, false, undefined, "supporter"),
      ).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-speech-refusal-member");
      expect(await markers()).toContain("speech_clone");

      expect(
        await new SupporterSponsorshipRepository(testSql).revokeActiveSponsorship({
          sponsorshipId: sponsorship.sponsorship_id,
        }),
      ).toMatchObject({ status: "revoked" });
      expect(await markers()).toContain("speech_clone");
      const revoked = await resolveSpeechTargets(refs.serverId);
      expect(revoked.clone).toBeNull();
      expect(revoked.denials?.clone).toMatchObject({ reason: "missing_sponsorship", fundingScope: "server" });

      await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: identity.supporter_identity_id,
        createdByDiscId: "synthetic-speech-refusal-sponsor",
      });
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-speech-refusal-member");

      await testSql`UPDATE supporter_entitlements SET is_active = false WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
      expect((await resolveSpeechTargets(refs.serverId)).clone).toBeNull();
      await testSql`UPDATE supporter_entitlements SET is_active = true WHERE supporter_identity_id = ${identity.supporter_identity_id}`;

      const validConfig = process.env.TOMORI_SUPPORTER_CONFIG_JSON;
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = "{}";
      expect((await resolveSpeechTargets(refs.serverId)).clone).toBeNull();
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = validConfig;
    } finally {
      await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = 'synthetic-speech-refusal-campaign'`;
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'supporter'`;
      await setHostedSpeechSelection(serverScope(), null, "clone");
    }
  });

  it("preserves shared OpenRouter models until the final provider entry is removed", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const [text] =
      await testSql`INSERT INTO llms (llm_provider, llm_codename, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-text', true) RETURNING llm_id`;
    const [speech] =
      await testSql`INSERT INTO speech_models (provider, codename, voice_mode, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-speech', 'clone', true) RETURNING speech_model_id`;
    const [decision] =
      await testSql`INSERT INTO decision_models (provider, codename, input_token_limit, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-decision', 8192, true) RETURNING decision_model_id`;
    const key = await encryptApiKey("synthetic-removal-key");
    try {
      for (const scope of [serverScope(), personalScope()]) {
        for (const first of ["openrouter", "supporter"]) {
          const serverId = scope.kind === "server" ? scope.ownerId : null;
          const userId = scope.kind === "personal" ? scope.ownerId : null;
          for (const provider of ["openrouter", "supporter"]) {
            const apiKey = provider === "openrouter" ? key.encrypted : null;
            if (userId)
              await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${userId}, ${provider}, ${apiKey}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key`;
            else
              await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${serverId}, ${provider}, ${apiKey}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key`;
          }
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, llm_id) VALUES (${serverId}, ${userId}, ${text.llm_id})`;
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, speech_model_id) VALUES (${serverId}, ${userId}, ${speech.speech_model_id})`;
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, decision_model_id) VALUES (${serverId}, ${userId}, ${decision.decision_model_id})`;
          const remaining = first === "openrouter" ? "supporter" : "openrouter";
          expect(
            await setHostedSpeechSelection(scope, speech.speech_model_id, undefined, false, undefined, remaining),
          ).toBe(true);
          if (serverId) {
            await testSql`UPDATE server_chat_configs SET response_reviewer_llm_id = ${text.llm_id} WHERE server_id = ${serverId}`;
            await testSql`UPDATE server_model_configs SET decision_model_id = ${decision.decision_model_id},
              subscription_capabilities = CASE WHEN ${remaining === "supporter"}
                THEN array_append(array_remove(subscription_capabilities, 'decision'), 'decision')
                ELSE array_remove(subscription_capabilities, 'decision') END
              WHERE server_id = ${serverId}`;
          }
          if (serverId) {
            const fallbackRefs = JSON.stringify([{ type: "llm", id: text.llm_id, credentialProvider: "supporter" }]);
            await testSql`UPDATE server_chat_configs SET fallback_model_refs = ${fallbackRefs}::jsonb WHERE server_id = ${serverId}`;
            const states = [
              await personaRepository.loadState(FIXTURE_IDS.serverDiscId),
              ...(await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)),
            ];
            for (const state of states) {
              expect(
                state?.fallback_chain?.find((entry) => entry.kind === "llm" && entry.model.llm_id === text.llm_id),
              ).toMatchObject({ credentialProvider: "supporter" });
            }
          }
          if (userId) {
            const panel = await providerPanelOperations.loadPersonalProviderPanelScope(
              FIXTURE_IDS.userDiscId,
              FIXTURE_IDS.serverDiscId,
            );
            if (!panel) throw new Error("Missing personal provider panel");
            for (const entry of panel.data.entries.filter(
              (entry) => entry.kind === "provider" && ["openrouter", "supporter"].includes(entry.provider),
            )) {
              if (entry.kind !== "provider") continue;
              const models = entry.capabilities.flatMap((capability) => capability.models);
              const selected = models.find(
                (model) => model.id === speech.speech_model_id && model.codeName === "synthetic/removal-speech",
              );
              expect(selected?.isWorkspaceActive).toBe(entry.id === `provider:${remaining}`);
            }
          }
          for (const [provider, preserved] of [
            [first, true],
            [remaining, false],
          ] as const) {
            expect(
              await providerPanelOperations.removeServerProviderEntry({
                serverDiscId: FIXTURE_IDS.serverDiscId,
                scopeKind: scope.kind,
                ownerId: scope.ownerId,
                state: createPersona({ server_id: refs.serverId }),
                entry: {
                  id: `provider:${provider}`,
                  kind: "provider",
                  provider,
                  displayName: provider,
                  savedAt: null,
                  rotationKeyCount: 0,
                  capabilities: [],
                },
              }),
            ).toMatchObject({ status: "success" });
            const [registered] =
              await testSql`SELECT COUNT(*)::int AS count FROM scoped_model_registrations WHERE server_id IS NOT DISTINCT FROM ${serverId} AND user_id IS NOT DISTINCT FROM ${userId} AND (llm_id = ${text.llm_id} OR speech_model_id = ${speech.speech_model_id} OR decision_model_id = ${decision.decision_model_id})`;
            expect(registered.count).toBe(preserved ? 3 : 0);
            if (serverId) {
              const [pins] =
                await testSql`SELECT response_reviewer_llm_id, decision_model_id, speech_clone_model_id FROM server_chat_configs JOIN server_model_configs USING (server_id) JOIN server_speech_configs USING (server_id) WHERE server_id = ${serverId}`;
              expect(pins).toEqual({
                response_reviewer_llm_id: preserved && provider !== "openrouter" ? text.llm_id : null,
                decision_model_id: preserved ? decision.decision_model_id : null,
                speech_clone_model_id: preserved ? speech.speech_model_id : null,
              });
            } else if (preserved) {
              const saved = await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, remaining);
              expect(saved?.speech_clone_model_id).toBe(speech.speech_model_id);
              expect(saved?.enabled_capabilities).toContain("speech_clone");
            }
          }
        }
      }
    } finally {
      await testSql`UPDATE server_chat_configs SET fallback_model_refs = '[]'::jsonb WHERE server_id = ${refs.serverId}`;
      await testSql`DELETE FROM llms WHERE llm_id = ${text.llm_id}`;
      await testSql`DELETE FROM speech_models WHERE speech_model_id = ${speech.speech_model_id}`;
      await testSql`DELETE FROM decision_models WHERE decision_model_id = ${decision.decision_model_id}`;
    }
  });
});
