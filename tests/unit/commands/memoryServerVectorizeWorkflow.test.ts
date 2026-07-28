import { beforeEach, describe, expect, it, mock } from "bun:test";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";

type Payload = Record<string, unknown>;

interface Scenario {
  removeResult: boolean;
}

const chronology: string[] = [];
const renderedNotices: Payload[] = [];
const invalidations: string[] = [];
const removals: number[] = [];
const insertCalls: Payload[] = [];
const workflowDirectives: string[] = [];
const rootCalls: Array<{ method: string; payload: unknown }> = [];
const errorLogs: Array<{ message: string; error: unknown; context?: Payload }> = [];
const successLogs: string[] = [];

let scenario: Scenario;

const selectedPersona = {
  server_id: 7,
  persona_id: 77,
  persona_lineage_id: 700,
  persona_nickname: "Kayra",
  config: {
    server_memteaching_enabled: true,
    embedding_model_id: 901,
  },
} as unknown as TomoriState;

const selectedMemory = {
  server_memory_id: 41,
  server_id: 7,
  persona_id: 77,
  persona_lineage_id: 700,
  user_id: 4,
  content: "The moonlit archive opens only at midnight.",
  tags: ["#lore"],
};

const controller = {
  anchorMessageId: "anchor-vectorize",
  replace: async (payload: unknown) => {
    const notice = payload as Payload;
    chronology.push(
      typeof notice.titleKey === "string" ? `notice:${notice.titleKey}` : "notice:confirmation-components",
    );
    renderedNotices.push(notice);
  },
  fetchMessage: async () => ({
    id: "anchor-vectorize",
    awaitMessageComponent: async () => {
      chronology.push("confirmation.await");
      return {
        id: "confirm-button",
        customId: "memory_server_vectorize_confirm_persona-phase",
        user: { id: "user-1" },
        message: { id: "anchor-vectorize" },
      };
    },
  }),
};

function submittedPhase(values: Record<string, string>, phaseId: string) {
  return {
    phaseId,
    message: controller,
    values,
    multiValues: {},
    attachments: {},
    optionOffset: 0,
    beginInPlaceWork: async () => {
      chronology.push(`ack:${phaseId}.deferUpdate`);
      return { phaseId: `${phaseId}-work`, message: controller };
    },
  };
}

mock.module("@/utils/discord/ui/personaWorkflow", () => ({
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS: 120_000,
  buildPersonaWorkflowNotice: (options: Payload) => options,
  completePersonaWorkflow: () => ({ action: "complete" }),
  retryPersonaWorkflow: () => ({ action: "retry" }),
  runPersonaPickerWorkflow: async (
    _interaction: ChatInputCommandInteraction,
    _locale: string,
    options: { onSelected: (selection: unknown) => Promise<{ action: string }> },
  ) => {
    const directive = await options.onSelected({
      phaseId: "persona-phase",
      persona: selectedPersona,
      message: controller,
      openModal: async (buildOptions: () => Promise<unknown>) => {
        chronology.push("selection-modal.open");
        await buildOptions();
        return {
          outcome: "submitted",
          phase: submittedPhase({ memory_select: "0" }, "selection-modal"),
        };
      },
      useButton: () => ({
        openModal: async () => {
          chronology.push("vectorize-modal.open");
          return {
            outcome: "submitted",
            phase: submittedPhase(
              {
                vectorize_content_input: "The moonlit archive opens only at midnight.",
                vectorize_doc_name_input: "Moonlit Archive",
                vectorize_channel_tags_input: "#lore",
              },
              "vectorize-modal",
            ),
          };
        },
      }),
    });
    workflowDirectives.push(directive.action);
    return { outcome: "selected", persona: selectedPersona, absoluteIndex: 0 };
  },
}));

mock.module("@/utils/discord/ui/modals", () => ({
  safeSelectOptionText: (value: string) => value,
}));

mock.module("@/utils/discord/ui/embeds", () => ({
  replyInfoEmbed: async () => undefined,
}));

mock.module("@/utils/text/localizer", () => ({
  localizer: (_locale: string, key: string) => key,
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
  },
  log: {
    info: () => undefined,
    success: (message: string) => {
      chronology.push("log.success");
      successLogs.push(message);
    },
    error: async (message: string, error: unknown, context?: Payload) => {
      chronology.push("log.error");
      errorLogs.push({ message, error, context });
    },
  },
}));

mock.module("@/utils/cache/tomoriStateCache", () => ({
  getCachedTomoriState: async () => selectedPersona,
  invalidateTomoriStateCache: (serverDiscId: string) => {
    chronology.push("cache.invalidate");
    invalidations.push(serverDiscId);
  },
}));

mock.module("@/utils/db/repositories", () => ({
  userRepository: {
    isBlacklisted: async () => false,
  },
  personaRepository: {
    loadAllForServer: async () => [selectedPersona],
  },
  llmModelRepo: {
    loadEmbeddingModelById: async () => ({
      embedding_model_id: 901,
      provider: "test-provider",
      codename: "test-embedding-model",
      model_family: "test-family",
    }),
  },
  serverMemoryRepository: {
    // Eligibility source for the pre-picker filter: the selected persona's
    // lineage (700) must be present so it survives the eligibility gate.
    lineageIdsWithServerMemories: async () => new Set([700]),
    loadServerMemoriesScoped: async () => [selectedMemory],
    documentExistsByName: async () => false,
    countDocumentsScoped: async () => 0,
    countChunksScoped: async () => 0,
    remove: async (memoryId: number) => {
      chronology.push("repo.remove-memory");
      removals.push(memoryId);
      return scenario.removeResult;
    },
  },
  ragRepository: {
    normalizeText: (content: string) => content,
    chunkText: () => ["The moonlit archive opens only at midnight."],
    insertWithChunks: async (params: Payload) => {
      chronology.push("repo.insert-document");
      insertCalls.push(params);
      return 501;
    },
  },
}));

mock.module("@/utils/db/ragAvailability", () => ({
  isRagAvailable: () => true,
}));

mock.module("@/utils/misc/memoryLimits", () => ({
  getMemoryLimits: () => ({
    maxMemoryLength: 4_000,
    maxDocumentsPerServer: 20,
    maxDocumentChunksPerServer: 1_000,
    documentChunkSize: 1_000,
    documentChunkOverlap: 100,
  }),
  validateMemoryContent: () => ({ isValid: true, maxAllowed: 4_000 }),
}));

mock.module("@/utils/security/rateLimiter", () => ({
  memoryGuard: { checkMemory: () => ({ status: "normal" }) },
  reserveDocumentQuota: () => ({ allowed: true, resetAt: null }),
}));

mock.module("@/utils/embeddings/embeddingProvider", () => ({
  providerSupportsEmbeddingTaskType: async () => true,
  generateEmbeddingsBatched: async () => [[0.1, 0.2]],
}));

class PersonalProviderRequiredError extends Error {}
class CredentialUnavailableError extends Error {}

mock.module("@/utils/provider/credentialResolver", () => ({
  PersonalProviderRequiredError,
  CredentialUnavailableError,
  resolveCapabilityCredentials: async () => ({ apiKey: "test-key" }),
  getResolvedCapabilityModelId: () => 901,
}));

mock.module("@/utils/provider/personalProviderRuntime", () => ({
  applyPersonalProviderSelectionsToTomoriState: async (state: TomoriState) => ({ tomoriState: state }),
}));

function makeInteraction(): ChatInputCommandInteraction {
  const interaction = {
    deferred: false,
    replied: false,
    channel: { id: "channel-1" },
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    memberPermissions: { has: () => true },
    deferReply: async (payload: unknown) => {
      interaction.deferred = true;
      rootCalls.push({ method: "deferReply", payload });
    },
  };
  return interaction as unknown as ChatInputCommandInteraction;
}

function makeClient(): Client {
  return {
    channels: { cache: new Map<string, unknown>() },
  } as unknown as Client;
}

const userData = {
  user_id: 4,
  user_disc_id: "user-1",
  language_pref: "en-US",
} as UserRow;

function expectBefore(first: string, second: string, occurrence = 0): void {
  const firstIndex = chronology.indexOf(first);
  const matchingSecondIndexes = chronology.flatMap((entry, index) => (entry === second ? [index] : []));
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(matchingSecondIndexes[occurrence]).toBeGreaterThan(firstIndex);
}

async function runCommand(): Promise<void> {
  const { execute } = await import("@/commands/memory/server/vectorize");
  await execute(makeClient(), makeInteraction(), userData, "en-US");
}

beforeEach(() => {
  scenario = { removeResult: true };
  chronology.length = 0;
  renderedNotices.length = 0;
  invalidations.length = 0;
  removals.length = 0;
  insertCalls.length = 0;
  workflowDirectives.length = 0;
  rootCalls.length = 0;
  errorLogs.length = 0;
  successLogs.length = 0;
});

describe("/memory server vectorize commit handling", () => {
  it("keeps the committed document visible and renders an honest warning when original-memory cleanup fails", async () => {
    scenario.removeResult = false;

    await runCommand();

    expect(rootCalls).toEqual([{ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } }]);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      serverId: 7,
      personaId: 77,
      documentName: "Moonlit Archive",
      sourceType: "memory",
    });
    expect(removals).toEqual([41]);
    expect(invalidations).toEqual(["guild-1"]);
    expect(workflowDirectives).toEqual(["complete"]);
    expect(successLogs).toHaveLength(0);
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({
      message: "Failed to remove the original server memory after vectorizing it",
      error: expect.any(Error),
      context: {
        userId: 4,
        serverId: 7,
        personaId: 77,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "memory server vectorize",
          guildId: "guild-1",
          originalMemoryId: 41,
          newDocumentId: 501,
          documentName: "Moonlit Archive",
          chunkCount: 1,
        },
      },
    });
    expect(renderedNotices).toContainEqual(
      expect.objectContaining({
        titleKey: "commands.memory.server.vectorize.partial_failure_title",
        descriptionKey: "commands.memory.server.vectorize.partial_failure_description",
        descriptionVars: {
          name: "Moonlit Archive",
          chunk_count: "1",
          persona_name: "Kayra",
        },
      }),
    );
    expect(renderedNotices.some((notice) => notice.titleKey === "commands.memory.server.vectorize.success_title")).toBe(
      false,
    );
    expectBefore("repo.insert-document", "cache.invalidate");
    expectBefore("cache.invalidate", "repo.remove-memory");
    expectBefore("repo.remove-memory", "log.error");
    expectBefore("log.error", "notice:commands.memory.server.vectorize.partial_failure_title");
  });

  it("invalidates after both committed writes and reports full success only when cleanup succeeds", async () => {
    await runCommand();

    expect(removals).toEqual([41]);
    expect(invalidations).toEqual(["guild-1", "guild-1"]);
    expect(workflowDirectives).toEqual(["retry"]);
    expect(errorLogs).toHaveLength(0);
    expect(successLogs).toHaveLength(1);
    expect(renderedNotices).toContainEqual(
      expect.objectContaining({
        titleKey: "commands.memory.server.vectorize.success_title",
        descriptionKey: "commands.memory.server.vectorize.success_description",
      }),
    );
    expectBefore("repo.insert-document", "cache.invalidate", 0);
    expectBefore("cache.invalidate", "repo.remove-memory");
    expectBefore("repo.remove-memory", "cache.invalidate", 1);
    expect(chronology.lastIndexOf("cache.invalidate")).toBeLessThan(chronology.indexOf("log.success"));
  });
});
