import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
// Real namespaces captured at link time, before any `mock.module` below runs.
// `mock.module` is process-global and never restored, so every factory spreads
// the real surface and overrides only what this file controls.
import * as realRepositories from "@/utils/db/repositories";
import * as realCommandRegistry from "@/utils/discord/commandRegistry";
import * as realEmbeds from "@/utils/discord/ui/embeds";
import * as realModals from "@/utils/discord/ui/modals";
import * as realPersonaWorkflow from "@/utils/discord/ui/personaWorkflow";
import * as realLogger from "@/utils/misc/logger";
import * as realPersonalProviderHelpers from "@/utils/provider/personalProviderHelpers";
import * as realProviderInfoRegistry from "@/utils/provider/providerInfoRegistry";
import * as realSavedProviderConfig from "@/utils/provider/savedProviderConfig";
import * as realLocalizer from "@/utils/text/localizer";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

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
  /** The row the updater produced from a pristine baseline i.e. what would be written. */
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

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/provider/savedProviderConfig": realSavedProviderConfig,
  "@/utils/db/repositories": realRepositories,
  "@/utils/provider/personalProviderHelpers": realPersonalProviderHelpers,
  "@/utils/discord/ui/embeds": realEmbeds,
  "@/utils/discord/ui/modals": realModals,
  "@/utils/provider/providerInfoRegistry": realProviderInfoRegistry,
  "@/utils/discord/commandRegistry": realCommandRegistry,
  "@/utils/misc/logger": realLogger,
  "@/utils/text/localizer": realLocalizer,
  "@/utils/discord/ui/personaWorkflow": realPersonaWorkflow,
});

scopedMock.module("@/utils/provider/savedProviderConfig", () => ({
  ...realSavedProviderConfig,
  loadSavedProvidersForCapability: async () => [],
  loadUserSavedProvidersForCapability: async () =>
    scenario.providers.map((provider) => ({ ...baselineRow(provider), api_key: "encrypted-key" })),
}));

// The commands under test only touch `llmModelRepo`. Spreading the real barrel
// replaces the hand-maintained placeholder list this mock used to carry, and
// `overrideMembers` delegates through the repository instance's prototype so its
// unstubbed methods survive for later test files.
scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadAvailableModelsForProvider: async () => llmModels,
    loadAvailableVideoGenerationModels: async () => videoModels,
    loadAvailableDiffusionModels: async () => diffusionModels,
    loadAvailableEmbeddingModels: async () => embeddingModels,
  }),
}));

scopedMock.module("@/utils/provider/personalProviderHelpers", () => ({
  ...realPersonalProviderHelpers,
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

scopedMock.module("@/utils/discord/ui/embeds", () => ({
  ...realEmbeds,
  replyInfoEmbed: async (_interaction: unknown, _locale: string, options: NoticeOptions) => {
    chronology.push("reply.info");
    infoReplies.push(options);
  },
}));

scopedMock.module("@/utils/discord/ui/modals", () => ({
  ...realModals,
  safeSelectOptionText: (value: string) => value,
}));

scopedMock.module("@/utils/provider/providerInfoRegistry", () => ({
  ...realProviderInfoRegistry,
  getProviderDisplayName: (provider: string) => provider,
  getStaticProviderInfo: () => ({ featureSupport: { imageGeneration: scenario.imageGenerationStyle } }),
}));

scopedMock.module("@/utils/discord/commandRegistry", () => ({
  ...realCommandRegistry,
  commandRegistry: overrideMembers(realCommandRegistry.commandRegistry, {
    getCommandMention: () => "/personal openrouter-model",
  }),
}));

scopedMock.module("@/utils/misc/logger", () => ({
  ...realLogger,
  log: {
    ...realLogger.log,
    error: async (_message: string, _error: Error, context: ErrorContext) => {
      chronology.push("log.error");
      errorLogs.push({ context });
    },
    info: () => undefined,
    warn: () => undefined,
  },
}));

scopedMock.module("@/utils/text/localizer", () => ({
  ...realLocalizer,
  localizer: (_locale: string, key: string) => key,
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

scopedMock.module("@/utils/discord/ui/personaWorkflow", () => ({
  ...realPersonaWorkflow,
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
      // flash before the terminal and nothing downstream runs.
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
