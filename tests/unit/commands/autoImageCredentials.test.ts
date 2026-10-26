import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { OpenrouterProvider } from "@/providers/openrouter/openrouterProvider";
import { ToolRegistry } from "@/tools/toolRegistry";
import { configRepository, llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import * as channelPrompts from "@/utils/cache/channelPromptCache";
import * as whitelist from "@/utils/cache/channelWhitelistCache";
import * as spotlight from "@/utils/cache/personalSpotlightCache";
import * as personaCache from "@/utils/cache/tomoriStateCache";
import * as modals from "@/utils/discord/ui/modals";
import * as textDisplayModals from "@/utils/discord/textDisplayModal";
import { executeAutoImageCommand } from "@/utils/image/autoImageCommand";
import * as providerFactory from "@/utils/provider/providerFactory";
import { registerProviderOption } from "@/utils/provider/providerOptionRegistry";
import { currentProviderUsageContext } from "@/utils/provider/providerUsage";
import * as quota from "@/utils/quota/imageQuotaManager";
import * as crypto from "@/utils/security/crypto";
import * as context from "@/utils/text/contextBuilder";
import { initializeLocalizer } from "@/utils/text/localizer";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import * as participants from "@/utils/text/participants/preparation";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

const state = createPersona({
  llm: createLlmRow({ llm_id: 9, llm_provider: "openrouter", has_tools: true }),
  config: { llm_id: 9, api_key: null, imagegen_enabled: true, diffusion_model_id: 2 },
});
const usageContext = { credentialProvider: "test-option", credentialScope: "server" as const };
const savedConfig = savedProviderConfigSchema.parse({
  server_id: state.server_id,
  provider: "test-option",
  api_key: null,
  llm_id: 9,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
});
const provider = new OpenrouterProvider();
const channel = { id: "synthetic-channel", messages: { fetch: async () => new Map() } };
const disposers: Array<() => void> = [];
const restores: Array<{ mockRestore(): void }> = [];
let credentialAvailable = true;
let command = makeFakeInteraction({ channel });
let modal = makeFakeInteraction({ deferred: true });

const resolveCredentials = mock(async () =>
  credentialAvailable ? { apiKey: "synthetic-managed-key", usageContext } : null,
);
const createConfig = mock<OpenrouterProvider["createConfig"]>(async (resolved, apiKey) => ({
  model: resolved.llm.llm_codename,
  apiKey,
  temperature: resolved.config.llm_temperature,
}));
const stream = mock(async () => {
  expect(currentProviderUsageContext()).toBe(usageContext);
  return { status: "function_call" as const, data: { name: "generate_image", args: {} } };
});

beforeAll(initializeLocalizer);

beforeEach(() => {
  credentialAvailable = true;
  resolveCredentials.mockClear();
  createConfig.mockClear();
  stream.mockClear();
  command = makeFakeInteraction({ channel });
  modal = makeFakeInteraction({ deferred: true });
  disposers.push(
    registerProviderOption({
      value: "test-option",
      catalogProvider: "openrouter",
      capabilities: ["text"],
      copy: {
        labelKey: "general.errors.api_key_missing_title",
        entryDescriptionKeys: {
          server: "general.errors.api_key_missing_description",
          personal: "general.errors.api_key_missing_description",
        },
        addActionLabelKey: "general.errors.api_key_missing_title",
        addActionDescriptionKeys: {
          server: "general.errors.api_key_missing_description",
          personal: "general.errors.api_key_missing_description",
        },
        removeImpactKey: "general.errors.api_key_missing_description",
      },
      availability: () => ({ eligible: true }),
      selection: {
        load: async () => null,
        ensure: async () => true,
        claim: async () => true,
        remove: async () => "removed",
        owns: (scope, capability) =>
          scope.kind === "server" && scope.ownerId === state.server_id && capability === "text",
        resolveCredentials,
      },
    }),
  );
  restores.push(
    spyOn(personaRepository, "loadState").mockResolvedValue(state),
    spyOn(personaRepository, "loadServerPersonaSummaries").mockResolvedValue([
      {
        persona_id: state.persona_id ?? 1,
        persona_nickname: state.persona_nickname,
        webhook_avatar_url: state.webhook_avatar_url ?? null,
        is_alter: state.is_alter,
        persona_prompt: state.persona_prompt,
        attribute_list: state.attribute_list,
        persona_lineage_id: state.persona_lineage_id,
      },
    ]),
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([]),
    spyOn(llmProviderRepo, "loadSavedProviderConfig").mockImplementation(async (_serverId, name) =>
      name === "test-option" ? savedConfig : null,
    ),
    spyOn(configRepository, "loadModelCapabilityIds").mockResolvedValue(state.config),
    spyOn(llmModelRepo, "loadById").mockResolvedValue(state.llm),
    spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
      isOnCooldown: false,
      remainingSeconds: 0,
      cooldownType: 0,
    }),
    spyOn(cooldownRepository, "setMessageTriggerCooldownWithWhitelist").mockResolvedValue(),
    spyOn(whitelist, "getCachedWhitelistStatus").mockResolvedValue({
      hasActiveWhitelist: false,
      hasActiveChannelWhitelist: false,
      isChannelWhitelisted: false,
      hasActiveRoleWhitelist: false,
      isRoleWhitelisted: false,
      hasActivePersonaWhitelist: false,
      isTriggerAllowed: true,
      hasChannelCooldownOverride: false,
    }),
    spyOn(spotlight, "getCachedPersonalSpotlightStatus").mockResolvedValue(null),
    spyOn(quota, "checkImageQuota").mockResolvedValue({ allowed: true }),
    spyOn(crypto, "hasOptApiKey").mockResolvedValue(false),
    spyOn(textDisplayModals, "attachTextDisplayModalCollector").mockImplementation(() => {}),
    spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
      expect(command.interaction.deferred).toBe(false);
      await command.interaction.showModal({});
      return {
        outcome: "submit",
        interaction: modal.interaction as unknown as ModalSubmitInteraction,
        values: { generate_image_auto_setting: "storybeat" },
      };
    }),
    spyOn(providerFactory, "getProviderForTomori").mockResolvedValue(provider),
    spyOn(provider, "createConfig").mockImplementation(createConfig),
    spyOn(provider, "streamToDiscord").mockImplementation(stream),
    spyOn(ToolRegistry, "executeTool").mockResolvedValue({ success: true, endTurn: true }),
    spyOn(channelPrompts, "getCachedChannelPrompt").mockResolvedValue(null),
    spyOn(personaCache, "getCachedAllPersonas").mockResolvedValue([state]),
    spyOn(context, "buildContext").mockResolvedValue({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      messageIdMap: new MessageIdMap(),
    }),
    spyOn(participants, "prepareParticipantContext").mockResolvedValue({
      discoveryPlan: {
        seeds: [],
        evidence: [],
        rejections: [],
        aliasReferenceDiagnostics: {
          evaluatedAliasCount: 0,
          acceptedAliasCount: 0,
          ambiguousAliasCount: 0,
          unmatchedAliasCount: 0,
        },
      },
      matrixUsers: new Map(),
      syntheticUsers: new Map(),
      messageProxyUsers: new Map(),
      publicPersonaProfiles: [],
      referencedUserRows: new Map(),
      referencedUserIds: new Set(),
      diagnostics: {
        discoveryCacheHit: false,
        discoveryDurationMs: 0,
        candidateCount: 0,
        includedCount: 0,
        rejectionCounts: {
          ineligible_state: 0,
          bot: 0,
          non_member: 0,
          ambiguous_alias: 0,
          existing_participant: 0,
          blocked_source: 0,
          missing_guild: 0,
        },
        externalCalls: {
          candidateSourceReads: 0,
          memberCacheHits: 0,
          memberFetches: 0,
          messageProxyIdentityReads: 0,
        },
        sourceContributions: [],
      },
    }),
  );
});

afterEach(() => {
  for (const restore of restores.splice(0)) restore.mockRestore();
  for (const dispose of disposers.splice(0)) dispose();
});

async function execute(): Promise<void> {
  await executeAutoImageCommand(
    {} as Client,
    command.interaction as unknown as ChatInputCommandInteraction,
    createUserRow(),
    "en-US",
  );
}

describe("auto image planning credentials", () => {
  it("generates through a registered option without a stored text key", async () => {
    await execute();

    expect(command.calls.map((call) => call.method)).toEqual(["showModal"]);
    expect(resolveCredentials).toHaveBeenCalledWith({
      scope: { kind: "server", ownerId: state.server_id },
      capability: "text",
      modelId: state.llm.llm_id,
    });
    expect(createConfig.mock.calls[0]?.[1]).toBe("synthetic-managed-key");
    expect(stream).toHaveBeenCalled();
    expect(JSON.stringify(modal.calls)).toContain(
      localizedCopy("en-US", "commands.tool.visualize.success_description"),
    );
  });

  it("reports unavailable option credentials without requesting generation", async () => {
    credentialAvailable = false;

    await execute();

    expect(command.calls.map((call) => call.method)).toEqual(["showModal"]);
    expect(resolveCredentials).toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(createConfig).not.toHaveBeenCalled();
    expect(JSON.stringify(modal.calls)).toContain(localizedCopy("en-US", "general.errors.api_key_missing_description"));
    expect(JSON.stringify(modal.calls)).not.toContain(
      localizedCopy("en-US", "commands.tool.visualize.success_description"),
    );
  });
});
