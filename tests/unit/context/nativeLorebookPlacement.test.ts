import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import * as realPersonaSprites from "@/utils/text/context/personaSprites";
import * as realRag from "@/utils/text/context/rag";
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

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/text/context/rag": realRag,
  "@/utils/text/context/personaSprites": realPersonaSprites,
});

const documentItem: StructuredContextItem = {
  role: "user",
  parts: [{ type: "text", text: "## Retrieved documents\nOld records." }],
  metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
};

scopedMock.module("@/utils/text/context/rag", () => ({
  ...realRag,
  buildServerDocumentContextItem: async () => documentItem,
}));

scopedMock.module("@/utils/text/context/personaSprites", () => ({
  ...realPersonaSprites,
  buildPersonaSpriteContextItem: async () => null,
}));

const { buildContextNative } = await import("@/utils/text/context/nativeBuilder");

let nextEntryId = 1;
let loadSpy: { mockRestore(): void; mockResolvedValue(rows: LorebookEntryRow[]): void } | undefined;

beforeEach(() => {
  nextEntryId = 1;
  loadSpy = spyOn(lorebookRepository, "loadEnabledForScope").mockResolvedValue([]);
});

afterEach(() => {
  loadSpy?.mockRestore();
});

function input(overrides: Partial<LorebookEntryInput> = {}): LorebookEntryInput {
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

function toRow(entry: LorebookEntryInput, overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return lorebookEntryRowSchema.parse({
    ...entry,
    entry_id: nextEntryId++,
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    ...overrides,
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

describe("native lorebook placement", () => {
  it("places activated lore after documents and before dialogue history", async () => {
    loadSpy?.mockResolvedValue([
      toRow(
        input({
          title: "Lantern",
          content: "The lantern never goes out.",
          keys: ["lantern"],
          insertion_order: 10,
        }),
      ),
      toRow(
        input({
          title: "Curfew",
          content: "The town keeps a curfew.",
          constant: true,
          keys: [],
          placement: 1,
          insertion_order: 20,
        }),
      ),
    ]);
    const persona = createPersona({
      server_id: SERVER_ID,
      persona_lineage_id: LINEAGE_ID,
      persona_prompt: "Persona prompt.",
      reward_conditioning_enabled: false,
      punish_conditioning_enabled: false,
      config: { channel_memory_enabled: true },
    });

    const result = await buildContextNative({
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
    });

    expect(loadSpy).toHaveBeenCalledWith(SERVER_ID, LINEAGE_ID);
    const tags = result.contextItems.map((item) => item.metadataTag);
    const documentsIndex = tags.indexOf(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const beforeIndex = tags.indexOf(ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);
    const afterIndex = tags.indexOf(ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER);
    const historyIndex = tags.indexOf(ContextItemTag.DIALOGUE_HISTORY);

    expect(documentsIndex).toBeGreaterThanOrEqual(0);
    expect(beforeIndex).toBe(documentsIndex + 1);
    expect(afterIndex).toBe(beforeIndex + 1);
    expect(historyIndex).toBeGreaterThan(afterIndex);
    expect(documentsIndex).toBeGreaterThan(tags.indexOf(ContextItemTag.SYSTEM_PERSONA_PROMPT));
  });
});
