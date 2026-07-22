import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ErrorContext, LlmRow, NaiPresetRow, TomoriState, UserRow } from "@/types/db/schema";

interface Scenario {
  branch: "custom" | "regular";
  modelUpdated: boolean;
  chatUpdated: boolean;
  presetApplied: boolean;
  replaceResult: boolean;
  selectedModel: LlmRow;
  naiPresets: NaiPresetRow[];
}

interface InfoOptions {
  titleKey: string;
  descriptionKey: string;
}

interface ErrorLog {
  message: string;
  error: Error;
  context: ErrorContext;
}

const chronology: string[] = [];
const invalidations: string[] = [];
const infoReplies: InfoOptions[] = [];
const replacements: InfoOptions[] = [];
const errorLogs: ErrorLog[] = [];
const presetCalls: Array<{ serverId: number; preset: NaiPresetRow; model: string; serverDiscId: string }> = [];

let scenario: Scenario;

function makeModel(codename: string, provider = "provider-a"): LlmRow {
  return {
    llm_id: 42,
    llm_codename: codename,
    llm_provider: provider,
    llm_description: codename,
    ja_description: codename,
    is_scoped_registration: false,
    is_free: false,
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
  } as unknown as LlmRow;
}

const defaultPreset = {
  preset_name: "Carefree-Kayra",
  model_target: "kayra",
  is_default: true,
  preset_desc: "Default Kayra preset",
  ja_preset_desc: "Default Kayra preset",
  parameters: { temperature: 1.2, top_p: 0.9, top_k: 20, min_p: 0.05 },
} satisfies NaiPresetRow;

const tomoriState = {
  server_id: 7,
  persona_id: 70,
  persona_nickname: "Tomori",
  llm: {
    llm_id: 1,
    llm_codename: "current-model",
    llm_provider: "current-provider",
  },
  config: {
    llm_id: 1,
    llm_temperature: 1,
    llm_top_p: 0.95,
    llm_top_k: 0,
    llm_frequency_penalty: 0,
    llm_presence_penalty: 0,
    llm_min_p: 0.05,
    llm_logit_biases: [],
  },
} as unknown as TomoriState;

function makeScenario(): Scenario {
  return {
    branch: "regular",
    modelUpdated: true,
    chatUpdated: true,
    presetApplied: true,
    replaceResult: false,
    selectedModel: makeModel("next-model"),
    naiPresets: [],
  };
}

mock.module("@/utils/cache/tomoriStateCache", () => ({
  getCachedTomoriState: async () => tomoriState,
  getCachedAllPersonas: async () => [],
  invalidateTomoriStateCache: (serverDiscId: string) => {
    chronology.push("cache.invalidate");
    invalidations.push(serverDiscId);
  },
}));

mock.module("@/utils/provider/savedProviderConfig", () => ({
  loadSavedProvidersForCapability: async () => [
    {
      provider: scenario.selectedModel.llm_provider,
      api_key: "encrypted-key",
      llm_logit_biases: [],
      fallback_model_refs: [],
      llm_disabled_params: [],
    },
  ],
}));

mock.module("@/utils/db/repositories", () => ({
  llmModelRepo: {
    loadAvailableModelsForProvider: async () => [scenario.selectedModel],
  },
  llmOverrideRepo: {
    getChannelLlmOverride: async () => null,
    setChannelLlmOverride: async () => true,
    setPersonaLlmOverride: async () => true,
  },
  configRepository: {
    updateModelConfig: async () => {
      chronology.push("repo.update-model");
      return scenario.modelUpdated;
    },
    updateChatConfig: async () => {
      chronology.push("repo.update-chat");
      return scenario.chatUpdated;
    },
    loadNaiPresets: async () => scenario.naiPresets,
    applyNaiPreset: async (serverId: number, preset: NaiPresetRow, model: string, serverDiscId: string) => {
      chronology.push("repo.apply-preset");
      presetCalls.push({ serverId, preset, model, serverDiscId });
      return scenario.presetApplied;
    },
  },
}));

mock.module("@/utils/discord/ui/modals", () => ({
  safeSelectOptionText: (value: string) => value,
  promptWithPaginatedModal: async (interaction: unknown) => ({
    outcome: "submit",
    interaction,
    values: { model_select: scenario.selectedModel.llm_codename },
  }),
}));

mock.module("@/utils/discord/ui/embeds", () => ({
  replyInfoEmbed: async (_interaction: unknown, _locale: string, options: InfoOptions) => {
    chronology.push("reply.info");
    infoReplies.push(options);
  },
}));

mock.module("@/utils/discord/providerPicker", () => ({
  promptForSavedProvider: async (interaction: unknown) => ({
    provider: scenario.selectedModel.llm_provider.toLowerCase(),
    interaction,
  }),
  replaceProviderPickerWithInfo: async (
    _selection: unknown,
    _interaction: unknown,
    _locale: string,
    options: InfoOptions,
  ) => {
    chronology.push("provider.replace");
    replacements.push(options);
    return scenario.replaceResult;
  },
}));

mock.module("@/utils/discord/customProviderModal", () => ({
  isCustomProvider: () => scenario.branch === "custom",
}));

mock.module("@/utils/provider/customModelPicker", () => ({
  promptCustomModelSelection: async (options: { interaction: unknown }) => ({
    model: scenario.selectedModel,
    submitInteraction: options.interaction,
  }),
}));

mock.module("@/utils/provider/logitBiasResolver", () => ({
  resolveLogitBiasEntriesForLlm: () => ({ entries: [] }),
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
  },
  log: {
    error: async (message: string, error: Error, context: ErrorContext) => {
      chronology.push("log.error");
      errorLogs.push({ message, error, context });
    },
    info: () => undefined,
    warn: () => undefined,
  },
}));

mock.module("@/utils/text/localizer", () => ({
  localizer: (_locale: string, key: string) => key,
}));

mock.module("@/utils/discord/openrouterModelMigrationNotice", () => ({
  replyLegacyOpenRouterOtherModelMoved: async () => undefined,
}));

mock.module("@/utils/provider/providerInfoRegistry", () => ({
  getProviderDisplayName: (provider: string) => provider,
}));

mock.module("@/utils/discord/commandRegistry", () => ({
  commandRegistry: { getCommandMention: () => "/openrouter model" },
}));

mock.module("@/utils/discord/ui/personaWorkflow", () => ({
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS: 120_000,
  buildPersonaWorkflowNotice: (options: unknown) => options,
  completePersonaWorkflow: () => ({ action: "complete" }),
  retryPersonaWorkflow: () => ({ action: "retry" }),
  runPersonaPickerWorkflow: async () => undefined,
}));

function makeInteraction(): ChatInputCommandInteraction {
  return {
    channel: { id: "channel-1", toString: () => "#channel" },
    channelId: "channel-1",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    user: { id: "user-1" },
    options: { getString: (name: string) => (name === "scope" ? "global" : null) },
  } as unknown as ChatInputCommandInteraction;
}

const userData = {
  user_id: 4,
  user_disc_id: "user-1",
  language_pref: "en-US",
} as unknown as UserRow;

async function runCommand(): Promise<void> {
  const { execute } = await import("@/commands/model/text");
  await execute({} as Client, makeInteraction(), userData, "en-US");
}

function expectUpdateFailure(): void {
  const rendered = [...infoReplies, ...replacements];
  expect(rendered).toContainEqual({
    titleKey: "general.errors.update_failed_title",
    descriptionKey: "general.errors.update_failed_description",
    color: "#E74C3C",
  });
  expect(rendered.some((options) => options.titleKey === "commands.model.text.success_title")).toBe(false);
}

function expectBefore(first: string, second: string): void {
  expect(chronology.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(chronology.indexOf(second)).toBeGreaterThan(chronology.indexOf(first));
}

beforeEach(() => {
  scenario = makeScenario();
  chronology.length = 0;
  invalidations.length = 0;
  infoReplies.length = 0;
  replacements.length = 0;
  errorLogs.length = 0;
  presetCalls.length = 0;
});

describe("/model text global persistence", () => {
  it("invalidates and fails when the regular-model chat-config write fails after the model write succeeds", async () => {
    scenario.chatUpdated = false;

    await runCommand();

    expect(invalidations).toEqual(["guild-1"]);
    expectUpdateFailure();
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.context.errorType).toBe("DatabaseUpdateError");
    expect(errorLogs[0]?.context.metadata).toMatchObject({
      modelConfigUpdated: true,
      chatConfigUpdated: false,
      selectedModelCodename: "next-model",
    });
    expect(presetCalls).toHaveLength(0);
  });

  it("invalidates and fails when the custom-model chat-config write fails after the model write succeeds", async () => {
    scenario.branch = "custom";
    scenario.selectedModel = makeModel("custom-next", "custom-provider");
    scenario.chatUpdated = false;

    await runCommand();

    expect(invalidations).toEqual(["guild-1"]);
    expectUpdateFailure();
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.context.metadata).toMatchObject({
      modelConfigUpdated: true,
      chatConfigUpdated: false,
      selectedModelCodename: "custom-next",
    });
    expect(presetCalls).toHaveLength(0);
  });

  it("passes the cache key and renders the preset failure in place after a final invalidation", async () => {
    scenario.selectedModel = makeModel("kayra-v1", "novelai");
    scenario.naiPresets = [defaultPreset];
    scenario.presetApplied = false;
    scenario.replaceResult = true;

    await runCommand();

    expect(presetCalls).toEqual([{ serverId: 7, preset: defaultPreset, model: "kayra-v1", serverDiscId: "guild-1" }]);
    expect(invalidations).toEqual(["guild-1", "guild-1"]);
    expect(infoReplies).toHaveLength(0);
    expectUpdateFailure();
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.context.metadata).toMatchObject({
      naiPresetName: "Carefree-Kayra",
      selectedModelCodename: "kayra-v1",
    });
    expectBefore("cache.invalidate", "repo.apply-preset");
    expect(chronology.lastIndexOf("cache.invalidate")).toBeGreaterThan(chronology.indexOf("repo.apply-preset"));
    expectBefore("repo.apply-preset", "provider.replace");
  });

  it("renders success only after the primary writes and default preset all succeed", async () => {
    scenario.selectedModel = makeModel("kayra-v1", "novelai");
    scenario.naiPresets = [defaultPreset];
    scenario.replaceResult = true;

    await runCommand();

    expect(presetCalls[0]).toMatchObject({ model: "kayra-v1", serverDiscId: "guild-1" });
    expect(errorLogs).toHaveLength(0);
    expect(replacements).toContainEqual(
      expect.objectContaining({
        titleKey: "commands.model.text.success_title",
        descriptionKey: "commands.model.text.success_description",
      }),
    );
    expectBefore("cache.invalidate", "repo.apply-preset");
    expectBefore("repo.apply-preset", "provider.replace");
  });
});
