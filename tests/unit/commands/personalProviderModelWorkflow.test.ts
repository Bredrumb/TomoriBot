import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";

/**
 * Anchor-migration tests for the personal provider-model family
 * (`/personal provider model-text|vision|video|image|embedding`).
 *
 * The engine is replaced with a fake anchor controller (same template as
 * `modelTextGlobalPersistence.test.ts`) so these tests assert the two things a migration
 * can silently get wrong: that the terminal notice lands on the ONE anchor message
 * rather than escaping to a fresh `replyInfoEmbed`, and that the capability write still
 * targets the right column with the right provider.
 */

interface NoticeOptions {
  titleKey: string;
  descriptionKey?: string;
  descriptionVars?: Record<string, string>;
}

/** A capability row as `assignPersonalCapabilityToProvider` hands it to the updater. */
interface CapabilityRow {
  provider: string;
  enabled_capabilities: string[];
  llm_id: number | null;
  vision_llm_id: number | null;
  video_model_id: number | null;
  diffusion_model_id: number | null;
  nai_diffusion_model_id: number | null;
  embedding_model_id: number | null;
}

interface AssignCall {
  userId: number;
  provider: string;
  capability: string;
  /** The row the updater produced from a pristine baseline — i.e. what would be written. */
  result: CapabilityRow;
}

const chronology: string[] = [];
const infoReplies: NoticeOptions[] = [];
const replacements: NoticeOptions[] = [];
const initialPayloads: NoticeOptions[] = [];
const assignCalls: AssignCall[] = [];
const errorLogs: Array<{ context: ErrorContext }> = [];

interface Scenario {
  /** Saved providers for the capability; length drives the picker vs. opener branch. */
  providers: string[];
  /** Value the fake modal submits for `model_select`. */
  submittedValue: string;
  /** What `assignPersonalCapabilityToProvider` reports back. */
  updateSucceeds: boolean;
  /** Image-generation style the fake provider registry reports (drives NAI column routing). */
  imageGenerationStyle: string;
}

let scenario: Scenario;

function makeScenario(): Scenario {
  return {
    providers: ["provider-a"],
    submittedValue: "",
    updateSucceeds: true,
    imageGenerationStyle: "standard",
  };
}

function baselineRow(provider: string): CapabilityRow {
  return {
    provider,
    enabled_capabilities: [],
    llm_id: null,
    vision_llm_id: null,
    video_model_id: null,
    diffusion_model_id: null,
    nai_diffusion_model_id: null,
    embedding_model_id: null,
  };
}

// Every model table exposes the same two models, keyed by whatever id column its
// command reads, so one fixture serves all five subcommands.
const llmModels = [
  {
    llm_id: 11,
    llm_codename: "text-model",
    llm_provider: "provider-a",
    llm_description: "text",
    ja_description: "text",
    is_scoped_registration: false,
    is_free: false,
    has_tools: true,
    sees_images: true,
    sees_videos: false,
    supports_structoutput: false,
  },
];
const videoModels = [
  {
    video_model_id: 22,
    codename: "video-model",
    provider: "provider-a",
    model_description: "video",
    ja_description: "video",
    is_scoped_registration: false,
    is_free: false,
  },
];
const diffusionModels = [
  {
    diffusion_model_id: 33,
    codename: "image-model",
    provider: "provider-a",
    model_description: "image",
    ja_description: "image",
    is_scoped_registration: false,
    is_free: false,
    is_default: false,
    is_uncensored: false,
  },
];
const embeddingModels = [
  {
    embedding_model_id: 44,
    codename: "embedding-model",
    provider: "provider-a",
    model_description: "embedding",
    ja_description: "embedding",
    is_scoped_registration: false,
    is_default: false,
  },
];

mock.module("@/utils/provider/savedProviderConfig", () => ({
  loadSavedProvidersForCapability: async () => [],
  loadUserSavedProvidersForCapability: async () =>
    scenario.providers.map((provider) => ({ ...baselineRow(provider), api_key: "encrypted-key" })),
}));

// The commands under test only touch `llmModelRepo`, but the mock must still expose the
// barrel's whole export surface: `mock.module` is process-wide, so a partial stub breaks
// module linking for anything else in this process that imports a missing name (the
// anchor helpers pull in `interactionCore`, which reaches most of these).
mock.module("@/utils/db/repositories", () => ({
  llmModelRepo: {
    loadAvailableModelsForProvider: async () => llmModels,
    loadAvailableVideoGenerationModels: async () => videoModels,
    loadAvailableDiffusionModels: async () => diffusionModels,
    loadAvailableEmbeddingModels: async () => embeddingModels,
  },
  configRepository: {},
  errorLogRepository: {},
  mcpRepository: {},
  quotaRepository: {},
  speechRepository: {},
  channelContextNoteRepo: {},
  channelPromptRepo: {},
  conditioningMemoryRepository: {},
  cooldownRepository: {},
  exportRepository: {},
  importRepository: {},
  llmOverrideRepo: {},
  llmProviderRepo: {},
  personalMemoryRepository: {},
  personaUserBlockRepository: {},
  personaSpriteMessageRepository: {},
  personaSpriteRepository: {},
  personaRepository: {},
  presetRepository: {},
  ragRepository: {},
  serverMemoryRepository: {},
  serverRepository: {},
  serverScheduleRepository: {},
  shortTermMemoryRepository: {},
  statRepository: {},
  toolRepository: {},
  userRepository: {},
  whitelistRepository: {},
}));

mock.module("@/utils/provider/personalProviderHelpers", () => ({
  resolveActivePersonalProviderModelSelections: async () => [],
  assignPersonalCapabilityToProvider: async (
    userId: number,
    provider: string,
    capability: string,
    updater: (row: CapabilityRow) => CapabilityRow,
  ) => {
    chronology.push("repo.assign");
    assignCalls.push({ userId, provider, capability, result: updater(baselineRow(provider)) });
    return scenario.updateSucceeds;
  },
}));

mock.module("@/utils/discord/ui/embeds", () => ({
  replyInfoEmbed: async (_interaction: unknown, _locale: string, options: NoticeOptions) => {
    chronology.push("reply.info");
    infoReplies.push(options);
  },
}));

mock.module("@/utils/discord/ui/modals", () => ({
  safeSelectOptionText: (value: string) => value,
}));

mock.module("@/utils/provider/providerInfoRegistry", () => ({
  getProviderDisplayName: (provider: string) => provider,
  getStaticProviderInfo: () => ({ featureSupport: { imageGeneration: scenario.imageGenerationStyle } }),
}));

mock.module("@/utils/discord/commandRegistry", () => ({
  commandRegistry: { getCommandMention: () => "/personal openrouter-model" },
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
  },
  log: {
    error: async (_message: string, _error: Error, context: ErrorContext) => {
      chronology.push("log.error");
      errorLogs.push({ context });
    },
    info: () => undefined,
    warn: () => undefined,
  },
}));

mock.module("@/utils/text/localizer", () => ({
  localizer: (_locale: string, key: string) => key,
  initializeLocalizer: async () => undefined,
  getSupportedLocales: () => ["en-US", "ja"],
  getLocaleSubKeys: () => [],
  getDefaultBotName: () => "Tomori",
  getBaseTriggerWords: () => [],
}));

// Fake anchor one-message engine. The provider step always resolves to the single
// "open selector" button, the modal opens and submits the scenario's value, and every
// terminal `replace` is recorded so assertions can inspect what landed on the message.
function makeAnchorController() {
  const replace = async (payload: NoticeOptions) => {
    chronology.push("message.replace");
    replacements.push(payload);
    return {};
  };
  return {
    anchorMessageId: "anchor-msg",
    fetchMessage: async () => ({
      id: "anchor-msg",
      // Stands in for the collector: hands back the opener click immediately. The single
      // -provider path resolves its provider from the saved list rather than the button's
      // id, so this fake stays agnostic of each subcommand's ID_ROOT.
      awaitMessageComponent: async () => ({
        id: "opener-button",
        customId: "opener",
        user: { id: "user-1" },
      }),
    }),
    replace,
  };
}

mock.module("@/utils/discord/ui/personaWorkflow", () => ({
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS: 120_000,
  MIGRATED_ANCHOR_CALLERS: [],
  PRE_ANCHOR_PRIMITIVES: [],
  isCollectorTimeoutError: () => false,
  buildPersonaWorkflowNotice: (options: NoticeOptions) => options,
  completePersonaWorkflow: () => ({ action: "complete" }),
  retryPersonaWorkflow: () => ({ action: "retry" }),
  runPersonaPickerWorkflow: async () => undefined,
  beginAnchorPrivateWorkflow: async (_interaction: unknown, _locale: string, initialPayload: NoticeOptions) => {
    initialPayloads.push(initialPayload);
    const controller = makeAnchorController();
    const modalPhase = {
      values: { model_select: scenario.submittedValue },
      message: controller,
      beginInPlaceWork: async () => ({ message: controller }),
      replace: controller.replace,
    };
    const nestedButton = {
      message: controller,
      replace: controller.replace,
      beginInPlaceWork: async () => ({ message: controller }),
      openModal: async () => ({ outcome: "submitted", phase: modalPhase }),
      delete: async () => undefined,
    };
    return {
      phaseId: "phase-1",
      message: controller,
      useButton: () => nestedButton,
    };
  },
}));

function makeInteraction(): ChatInputCommandInteraction {
  return {
    channel: { id: "channel-1" },
    channelId: "channel-1",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    user: { id: "user-1" },
    options: { getString: () => null },
  } as unknown as ChatInputCommandInteraction;
}

const userData = {
  user_id: 4,
  user_disc_id: "user-1",
  language_pref: "en-US",
} as unknown as UserRow;

/** One row per migrated subcommand: how to run it and what a successful write looks like. */
const subcommands = [
  {
    name: "model-text",
    module: "@/commands/personal/provider/model-text",
    capability: "text",
    submittedValue: "text-model",
    successDescriptionKey: "commands.personal.provider.model_text.success_description",
    expectedModelName: "text-model",
    expectedWrite: { llm_id: 11 },
  },
  {
    name: "model-vision",
    module: "@/commands/personal/provider/model-vision",
    capability: "vision",
    submittedValue: "text-model",
    successDescriptionKey: "commands.personal.provider.model_vision.success_description",
    expectedModelName: "text-model",
    expectedWrite: { vision_llm_id: 11 },
  },
  {
    name: "model-video",
    module: "@/commands/personal/provider/model-video",
    capability: "video",
    submittedValue: "22",
    successDescriptionKey: "commands.personal.provider.model_video.success_description",
    expectedModelName: "video-model",
    expectedWrite: { video_model_id: 22 },
  },
  {
    name: "model-image",
    module: "@/commands/personal/provider/model-image",
    capability: "image",
    submittedValue: "33",
    successDescriptionKey: "commands.personal.provider.model_image.success_description",
    expectedModelName: "image-model",
    expectedWrite: { diffusion_model_id: 33, nai_diffusion_model_id: null },
  },
  {
    name: "model-embedding",
    module: "@/commands/personal/provider/model-embedding",
    capability: "embedding",
    submittedValue: "44",
    successDescriptionKey: "commands.personal.provider.model_embedding.success_description",
    expectedModelName: "embedding-model",
    expectedWrite: { embedding_model_id: 44 },
  },
] as const;

async function runSubcommand(modulePath: string): Promise<void> {
  const { execute } = await import(modulePath);
  await execute({} as Client, makeInteraction(), userData, "en-US");
}

beforeEach(() => {
  scenario = makeScenario();
  chronology.length = 0;
  infoReplies.length = 0;
  replacements.length = 0;
  initialPayloads.length = 0;
  assignCalls.length = 0;
  errorLogs.length = 0;
});

describe("personal provider model-* anchor workflow", () => {
  for (const subcommand of subcommands) {
    it(`${subcommand.name} writes its own column and renders success on the anchor message`, async () => {
      scenario.submittedValue = subcommand.submittedValue;

      await runSubcommand(subcommand.module);

      // The write targets the selected provider, this capability, and only its column.
      expect(assignCalls).toHaveLength(1);
      expect(assignCalls[0]).toMatchObject({
        userId: 4,
        provider: "provider-a",
        capability: subcommand.capability,
      });
      expect(assignCalls[0]?.result).toMatchObject(subcommand.expectedWrite);

      // The terminal lands on the one anchor message, never as a fresh reply.
      expect(infoReplies).toHaveLength(0);
      expect(replacements).toContainEqual(
        expect.objectContaining({
          titleKey: "commands.personal.provider.model_success_title",
          descriptionKey: subcommand.successDescriptionKey,
          descriptionVars: { provider: "provider-a", model: subcommand.expectedModelName },
        }),
      );
      // The success notice is rendered only after the write returns.
      expect(chronology.indexOf("repo.assign")).toBeLessThan(chronology.lastIndexOf("message.replace"));
    });

    it(`${subcommand.name} renders the write failure in place without a success notice`, async () => {
      scenario.submittedValue = subcommand.submittedValue;
      scenario.updateSucceeds = false;

      await runSubcommand(subcommand.module);

      expect(infoReplies).toHaveLength(0);
      expect(replacements.some((options) => options.titleKey === "general.errors.update_failed_title")).toBe(true);
      expect(
        replacements.some((options) => options.titleKey === "commands.personal.provider.model_success_title"),
      ).toBe(false);
    });

    it(`${subcommand.name} opens the anchor message with the no-providers notice and stops`, async () => {
      scenario.providers = [];

      await runSubcommand(subcommand.module);

      // The notice is the workflow's INITIAL payload, so the user never sees a picker
      // flash before the terminal — and nothing downstream runs.
      expect(initialPayloads).toEqual([
        expect.objectContaining({ titleKey: "commands.personal.provider.no_saved_title" }),
      ]);
      expect(assignCalls).toHaveLength(0);
      expect(replacements).toHaveLength(0);
      expect(infoReplies).toHaveLength(0);
    });
  }

  it("model-image routes a NovelAI pipeline provider into the NAI column instead", async () => {
    scenario.submittedValue = "33";
    scenario.imageGenerationStyle = "nai-pipeline";

    await runSubcommand("@/commands/personal/provider/model-image");

    expect(assignCalls[0]?.result).toMatchObject({
      diffusion_model_id: null,
      nai_diffusion_model_id: 33,
    });
  });

  it("renders the moved-model notice in place for the legacy OpenRouter sentinel", async () => {
    scenario.submittedValue = "other-model";
    llmModels.push({ ...llmModels[0], llm_id: 99, llm_codename: "other-model" });

    try {
      await runSubcommand("@/commands/personal/provider/model-text");

      expect(assignCalls).toHaveLength(0);
      expect(infoReplies).toHaveLength(0);
      expect(replacements).toContainEqual(
        expect.objectContaining({ titleKey: "general.openrouter_model_moved_title" }),
      );
    } finally {
      llmModels.pop();
    }
  });
});
