import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import * as realPersonaSprites from "@/utils/text/context/personaSprites";
import * as realRag from "@/utils/text/context/rag";
import * as realTemplates from "@/utils/text/context/templates";
import * as realToolDefinitions from "@/utils/text/context/toolDefinitions";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryRowSchema, type LorebookEntryInput, type LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { PreparedParticipantContext } from "@/utils/text/participants/preparation";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import { createPersona } from "../../helpers/fixtures";

const SERVER_ID = 1;
const LINEAGE_ID = 100;
const SERVER_DISC_ID = "111111111111111111";
const CHANNEL_ID = "444444444444444444";

const events: string[] = [];
let documentDeferred: ReturnType<typeof deferred<StructuredContextItem | null>>;
let verbatimGate: ReturnType<typeof deferred<void>>;
let verbatimStarted: ReturnType<typeof deferred<void>>;
let verbatimBehavior: "slow" | "throw";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/text/context/rag": realRag,
  "@/utils/text/context/personaSprites": realPersonaSprites,
  "@/utils/text/context/templates": realTemplates,
  "@/utils/text/context/toolDefinitions": realToolDefinitions,
});

const documentItem: StructuredContextItem = {
  role: "user",
  parts: [{ type: "text", text: "## Retrieved documents\nOld records." }],
  metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
};

const toolDefinitionsItem: StructuredContextItem = {
  role: "user",
  parts: [{ type: "text", text: "Available tools (JSON): []" }],
  metadataTag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
};

scopedMock.module("@/utils/text/context/rag", () => ({
  ...realRag,
  buildServerDocumentContextItem: () => {
    events.push("rag");
    return documentDeferred.promise;
  },
}));

scopedMock.module("@/utils/text/context/templates", () => ({
  ...realTemplates,
  buildPromptContextItems: async () => {
    events.push("prompt-items");
    return [];
  },
}));

scopedMock.module("@/utils/text/context/toolDefinitions", () => ({
  ...realToolDefinitions,
  buildVerbatimToolDefinitionsContextItem: async () => {
    events.push("verbatim-tools");
    verbatimStarted.resolve(undefined);
    if (verbatimBehavior === "throw") throw new Error("fixture tool definitions failure");
    await verbatimGate.promise;
    return toolDefinitionsItem;
  },
}));

scopedMock.module("@/utils/text/context/personaSprites", () => ({
  ...realPersonaSprites,
  buildPersonaSpriteContextItem: async () => null,
}));

const { buildContextNative } = await import("@/utils/text/context/nativeBuilder");

let nextEntryId = 1;
let loadSpy: { mockRestore(): void; mockResolvedValue(rows: LorebookEntryRow[]): void } | undefined;

beforeEach(() => {
  events.length = 0;
  documentDeferred = deferred<StructuredContextItem | null>();
  verbatimGate = deferred<void>();
  verbatimStarted = deferred<void>();
  verbatimBehavior = "slow";
  loadSpy = spyOn(lorebookRepository, "loadEnabledForScope").mockResolvedValue([]);
});

afterEach(() => {
  loadSpy?.mockRestore();
});

function lorebookInput(overrides: Partial<LorebookEntryInput> = {}): LorebookEntryInput {
  return {
    title: "Entry",
    content: "Entry content.",
    keys: ["entry"],
    secondary_keys: [],
    selective_logic: 0,
    scan_depth: 5,
    trigger_chance: 100,
    insertion_order: 100,
    placement: 0,
    constant: false,
    enabled: true,
    channel_disc_ids: [],
    ...overrides,
  };
}

function toLorebookRow(entry: LorebookEntryInput): LorebookEntryRow {
  return lorebookEntryRowSchema.parse({
    ...entry,
    entry_id: nextEntryId++,
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
  });
}

const fakeClient = {
  guilds: { cache: new Map() },
  users: { cache: new Map() },
} as unknown as Client;

const preparedParticipantContext = {
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
  diagnostics: {},
} as unknown as PreparedParticipantContext;

const messageHistory: SimplifiedMessageForContext[] = [
  {
    id: "222222222222222222",
    authorId: "333333333333333333",
    authorName: "Alice",
    authorType: "user",
    content: "We light the lantern.",
    imageAttachments: [],
    videoAttachments: [],
  },
];

function params() {
  const persona = createPersona({
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    persona_prompt: "Persona prompt.",
    reward_conditioning_enabled: false,
    punish_conditioning_enabled: false,
    config: { channel_memory_enabled: true, tool_use_enabled: false },
  });
  return {
    guildId: SERVER_DISC_ID,
    serverName: "Test Server",
    serverDescription: null,
    simplifiedMessageHistory: messageHistory,
    preparedParticipantContext,
    channelDesc: null,
    channelName: "general",
    channelId: CHANNEL_ID,
    client: fakeClient,
    triggererName: "Alice",
    triggererFormattedName: "Alice",
    triggererAddressTerm: "",
    tomoriNickname: "Mirri",
    tomoriAttributes: [],
    tomoriConfig: persona.config,
    personaLineageId: LINEAGE_ID,
    snapshot: { tomoriState: persona },
  };
}

describe("native RAG document start", () => {
  it("starts retrieval before the first contributor and appends the item at its existing position", async () => {
    loadSpy?.mockResolvedValue([toLorebookRow(lorebookInput({ title: "Lantern", keys: ["lantern"] }))]);

    const buildPromise = buildContextNative(params());
    await verbatimStarted.promise;

    expect(events).toContain("rag");
    expect(events.indexOf("rag")).toBeLessThan(events.indexOf("prompt-items"));
    expect(events).toContain("verbatim-tools");

    verbatimGate.resolve(undefined);
    documentDeferred.resolve(documentItem);
    const result = await buildPromise;

    const tags = result.contextItems.map((item) => item.metadataTag);
    const documentsIndex = tags.indexOf(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const verbatimIndex = tags.indexOf(ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS);
    expect(verbatimIndex).toBeGreaterThanOrEqual(0);
    expect(documentsIndex).toBe(verbatimIndex + 1);
    expect(tags.indexOf(ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE)).toBe(documentsIndex + 1);
    expect(tags.indexOf(ContextItemTag.DIALOGUE_HISTORY)).toBeGreaterThan(documentsIndex);
  });

  it("does not leak an unhandled rejection when assembly throws after retrieval starts", async () => {
    verbatimBehavior = "throw";
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const buildOutcome = buildContextNative(params()).then(
        () => null,
        (error: unknown) => error,
      );
      await verbatimStarted.promise;
      documentDeferred.reject(new Error("fixture retrieval failure"));

      const error = await buildOutcome;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("fixture tool definitions failure");

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
