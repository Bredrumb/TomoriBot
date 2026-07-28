import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { ModalOptions, SelectOption } from "@/types/discord/modal";

/**
 * Anchor-migration tests for `/model fallback`.
 *
 * This command could not ride the engine's own `>25` bridge — it renders five selects over
 * one shared option list (the bridge slices only the first) and reserves one entry per page
 * for the explicit "None" choice. It therefore picks a range on the anchor message via
 * `acquireModalOptionRange` and hands the modal an already-sliced list. These tests cover
 * that hand-off plus the per-slot merge rules, and assert every terminal lands on the one
 * anchor message rather than escaping to `replyInfoEmbed`.
 */

interface NoticeOptions {
  titleKey: string;
  descriptionKey?: string;
  descriptionVars?: Record<string, string>;
}

interface FallbackRef {
  type: "llm" | "custom_endpoint";
  id: number;
}

const chronology: string[] = [];
const infoReplies: NoticeOptions[] = [];
const replacements: NoticeOptions[] = [];
/** Option lists handed to each modal opened through the anchor engine. */
const modalOptionLists: SelectOption[][] = [];
const writtenRefs: FallbackRef[][] = [];

interface Scenario {
  /** How many models the selected provider exposes (drives the range step). */
  modelCount: number;
  /** Which rendered range button the fake collector "clicks" (0-based). */
  rangePick: number;
  /** Values the fake modal submits, keyed by slot id. */
  submitted: Record<string, string>;
  /** Refs already stored on the server config. */
  existingRefs: FallbackRef[];
  /** llm_id of the primary chat model, for the conflict guard. */
  primaryLlmId: number;
  writeSucceeds: boolean;
}

let scenario: Scenario;

function makeScenario(): Scenario {
  return {
    modelCount: 5,
    rangePick: 0,
    submitted: {},
    existingRefs: [],
    primaryLlmId: 1,
    writeSucceeds: true,
  };
}

/** Model `n` is codename `model-n` with llm_id `n` (1-based), so ids are readable in assertions. */
function makeModels(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    llm_id: index + 1,
    llm_codename: `model-${index + 1}`,
    llm_provider: "provider-a",
    llm_description: "desc",
    ja_description: "desc",
    is_free: false,
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
    is_scoped_registration: false,
  }));
}

const tomoriState = {
  server_id: 7,
  persona_id: 70,
  llm: { llm_id: 1, llm_codename: "primary-model", llm_provider: "provider-a" },
  get config() {
    return {
      llm_id: scenario.primaryLlmId,
      fallback_model_refs: scenario.existingRefs,
    };
  },
  fallback_chain: [],
} as unknown as TomoriState;

// Full export surface — see the repositories mock below for why partial stubs are unsafe.
mock.module("@/utils/cache/tomoriStateCache", () => ({
  getCachedTomoriState: async () => tomoriState,
  getCachedAllPersonas: async () => [],
  getCachedMainPersona: async () => tomoriState,
  invalidateTomoriStateCache: () => undefined,
  getLastDbError: () => null,
  clearTomoriStateCache: () => undefined,
  getTomoriStateCacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
}));

mock.module("@/utils/provider/savedProviderConfig", () => ({
  loadSavedProvidersForCapability: async () => [{ provider: "provider-a" }],
  loadUserSavedProvidersForCapability: async () => [{ provider: "provider-a" }],
}));

// Full barrel surface — `mock.module` is process-wide, so a partial stub would break
// module linking for anything else importing a missing repository name.
mock.module("@/utils/db/repositories", () => ({
  llmModelRepo: {
    loadAvailableModelsForProvider: async () => makeModels(scenario.modelCount),
    getLlmsByIds: async () => [],
  },
  llmOverrideRepo: {
    setFallbackModelRefs: async (_serverId: number, refs: FallbackRef[]) => {
      chronology.push("repo.write");
      writtenRefs.push(refs);
      return scenario.writeSucceeds;
    },
  },
  llmProviderRepo: {
    loadCustomEndpointsForServer: async () => [],
    loadCustomEndpointsByIds: async () => [],
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
  getStaticProviderInfo: () => null,
}));

mock.module("@/utils/provider/customProviderUtils", () => ({
  isCustomProvider: () => false,
  parseCustomProvider: () => null,
}));

mock.module("@/utils/discord/commandRegistry", () => ({
  commandRegistry: { getCommandMention: () => "/openrouter model" },
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: { INFO: "#3498DB", SUCCESS: "#2ECC71", WARN: "#F1C40F", ERROR: "#E74C3C" },
  log: {
    error: async (_message: string, _error: Error, _context: ErrorContext) => {
      chronology.push("log.error");
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

/**
 * Recursively collects every `customId` in a rendered payload. The range selector is built
 * by the REAL `buildRangeSelectorPayload`, so the fake collector can hand back a button that
 * genuinely exists in what was just rendered instead of inventing an id.
 */
function collectCustomIds(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectCustomIds(child, found);
    return found;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.customId === "string") found.push(record.customId);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") collectCustomIds(value, found);
    }
  }
  return found;
}

let lastRendered: unknown = null;

function makeAnchorController() {
  const replace = async (payload: NoticeOptions) => {
    chronology.push("message.replace");
    lastRendered = payload;
    replacements.push(payload);
    return {};
  };
  return {
    anchorMessageId: "anchor-msg",
    fetchMessage: async () => ({
      id: "anchor-msg",
      awaitMessageComponent: async () => {
        // Prefer a real range button from the payload on screen; otherwise this is the
        // provider/opener step, which resolves from the saved-provider list.
        const rangeIds = collectCustomIds(lastRendered).filter((id) => id.includes("_range_"));
        const customId = rangeIds[scenario.rangePick] ?? rangeIds[0] ?? "opener";
        return { id: "btn", customId, user: { id: "user-1" } };
      },
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
    const controller = makeAnchorController();
    lastRendered = initialPayload;
    const modalPhase = {
      get values() {
        return scenario.submitted;
      },
      message: controller,
      beginInPlaceWork: async () => ({ message: controller }),
      replace: controller.replace,
    };
    const nestedButton = {
      message: controller,
      replace: controller.replace,
      beginInPlaceWork: async () => ({ message: controller }),
      openModal: async (options: ModalOptions) => {
        const select = options.components.find((component) => "options" in component);
        if (select && "options" in select) modalOptionLists.push(select.options as SelectOption[]);
        return { outcome: "submitted", phase: modalPhase };
      },
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
    id: "interaction-1",
    channel: { id: "channel-1" },
    channelId: "channel-1",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    user: { id: "user-1" },
    options: { getString: () => null },
  } as unknown as ChatInputCommandInteraction;
}

const userData = { user_id: 4, user_disc_id: "user-1", language_pref: "en-US" } as unknown as UserRow;

async function runCommand(): Promise<void> {
  const { execute } = await import("@/commands/model/fallback");
  await execute({} as Client, makeInteraction(), userData, "en-US");
}

beforeEach(() => {
  scenario = makeScenario();
  chronology.length = 0;
  infoReplies.length = 0;
  replacements.length = 0;
  modalOptionLists.length = 0;
  writtenRefs.length = 0;
  lastRendered = null;
});

describe("/model fallback anchor workflow", () => {
  it("prepends the clear option and skips the range step at or below 24 models", async () => {
    scenario.modelCount = 5;
    scenario.submitted = { fallback_slot_1: "model-2" };

    await runCommand();

    expect(modalOptionLists).toHaveLength(1);
    const options = modalOptionLists[0];
    // 1 clear entry + 5 models, clear first, and no range selector was rendered.
    expect(options).toHaveLength(6);
    expect(options[0]?.value).toBe("__none__");
    expect(options[1]?.value).toBe("model-1");
    expect(replacements.some((payload) => payload.titleKey === "general.pagination.select_page_title")).toBe(false);
    expect(writtenRefs).toEqual([[{ type: "llm", id: 2 }]]);
  });

  it("slices to the chosen range and still offers the clear option on a later page", async () => {
    scenario.modelCount = 60;
    scenario.rangePick = 1; // second range button => models 25-48
    scenario.submitted = { fallback_slot_1: "model-30" };

    await runCommand();

    const options = modalOptionLists[0];
    // The clear entry is re-prepended to the page, so a user deep in the list can still
    // empty a slot — the behaviour the flat 25-wide bridge would have lost.
    expect(options[0]?.value).toBe("__none__");
    expect(options).toHaveLength(25);
    expect(options[1]?.value).toBe("model-25");
    expect(options.at(-1)?.value).toBe("model-48");
    expect(writtenRefs).toEqual([[{ type: "llm", id: 30 }]]);
  });

  it("keeps untouched slots, clears explicit __none__ slots, and de-duplicates", async () => {
    scenario.modelCount = 5;
    scenario.existingRefs = [
      { type: "llm", id: 2 },
      { type: "llm", id: 3 },
      { type: "llm", id: 4 },
    ];
    scenario.submitted = {
      fallback_slot_1: "", // untouched -> keeps id 2
      fallback_slot_2: "__none__", // explicit clear -> drops id 3
      fallback_slot_3: "model-2", // duplicate of slot 1 -> de-duplicated away
      fallback_slot_4: "model-5",
    };

    await runCommand();

    expect(writtenRefs).toEqual([
      [
        { type: "llm", id: 2 },
        { type: "llm", id: 5 },
      ],
    ]);
    expect(infoReplies).toHaveLength(0);
  });

  it("refuses a chain containing the primary model and never writes", async () => {
    scenario.modelCount = 5;
    scenario.primaryLlmId = 3;
    scenario.submitted = { fallback_slot_1: "model-3" };

    await runCommand();

    expect(writtenRefs).toHaveLength(0);
    expect(infoReplies).toHaveLength(0);
    expect(replacements).toContainEqual(
      expect.objectContaining({ titleKey: "commands.model.fallback.primary_conflict_title" }),
    );
  });

  it("renders the cleared terminal in place when every slot is emptied", async () => {
    scenario.modelCount = 5;
    scenario.existingRefs = [{ type: "llm", id: 2 }];
    scenario.submitted = { fallback_slot_1: "__none__" };

    await runCommand();

    expect(writtenRefs).toEqual([[]]);
    expect(infoReplies).toHaveLength(0);
    expect(replacements).toContainEqual(expect.objectContaining({ titleKey: "commands.model.fallback.cleared_title" }));
  });

  it("renders the write failure in place without a success notice", async () => {
    scenario.modelCount = 5;
    scenario.submitted = { fallback_slot_1: "model-2" };
    scenario.writeSucceeds = false;

    await runCommand();

    expect(infoReplies).toHaveLength(0);
    expect(replacements.some((payload) => payload.titleKey === "general.errors.update_failed_title")).toBe(true);
    expect(replacements.some((payload) => payload.titleKey === "commands.model.fallback.success_title")).toBe(false);
  });
});
