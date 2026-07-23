import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";

type Payload = Record<string, unknown>;

interface DocumentFixture {
  document_id: number;
  document_name: string;
  first_chunk: string | null;
}

interface ChunkFixture {
  document_chunk_id: number;
  chunk_index: number;
  content: string;
}

interface ModalFixture {
  outcome: "submitted" | "timeout" | "cancelled" | "error" | "fatal";
  values?: Record<string, string>;
}

interface RecordedPayload {
  operation: string;
  messageId: string;
  payload: Payload;
}

interface Scenario {
  scope: "persona" | "serverwide";
  documents: DocumentFixture[];
  documentMeta: { document_name: string; channel_tags: string[] } | null;
  chunks: ChunkFixture[];
  buttons: Array<string | "timeout">;
  modals: ModalFixture[];
  updateChunkResult: boolean;
  updateTagsResult: boolean;
  deleteChunkResult: boolean;
  removeDocumentResult: boolean;
  embeddingResult: number[][] | Error;
  throwAt: "documents" | "meta" | "chunks" | "rebuild" | null;
}

const CANONICAL_MESSAGE_ID = "canonical-document-view";
const chronology: string[] = [];
const payloads: RecordedPayload[] = [];
const rootCalls: string[] = [];
const modalOptions: Payload[] = [];
const repositoryCalls: Array<{ method: string; args: unknown[] }> = [];
const invalidations: string[] = [];

let scenario: Scenario;

function makeScenario(): Scenario {
  return {
    scope: "persona",
    documents: [{ document_id: 11, document_name: "Guide", first_chunk: "alpha" }],
    documentMeta: { document_name: "Guide", channel_tags: ["#general"] },
    chunks: [
      { document_chunk_id: 101, chunk_index: 0, content: "alpha" },
      { document_chunk_id: 102, chunk_index: 1, content: "beta" },
    ],
    buttons: [],
    modals: [],
    updateChunkResult: true,
    updateTagsResult: true,
    deleteChunkResult: true,
    removeDocumentResult: true,
    embeddingResult: [[0.1, 0.2]],
    throwAt: null,
  };
}

function v2Notice(titleKey: string, descriptionKey: string, button?: Payload): Payload {
  const components: Payload[] = [
    { type: ComponentType.TextDisplay, content: titleKey },
    { type: ComponentType.TextDisplay, content: descriptionKey },
  ];
  if (button) {
    components.push({ type: ComponentType.ActionRow, components: [button] });
  }
  return {
    components: [{ type: ComponentType.Container, components }],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function recordPayload(operation: string, payload: unknown): void {
  payloads.push({ operation, messageId: CANONICAL_MESSAGE_ID, payload: payload as Payload });
}

function takeButton(): {
  id: string;
  customId: string;
  user: { id: string };
  message: { id: string };
} {
  const next = scenario.buttons.shift();
  if (!next || next === "timeout") {
    throw new Error("component timeout");
  }
  return {
    id: `button-${next}`,
    customId: next,
    user: { id: "user-1" },
    message: { id: CANONICAL_MESSAGE_ID },
  };
}

const controller = {
  replace: async (payload: unknown) => {
    chronology.push("message.replace");
    recordPayload("replace", payload);
  },
  edit: async (payload: unknown) => {
    chronology.push("message.edit");
    recordPayload("edit", payload);
  },
  fetchMessage: async () => ({
    id: CANONICAL_MESSAGE_ID,
    awaitMessageComponent: async () => {
      chronology.push("message.await-component");
      return takeButton();
    },
  }),
  delete: async () => {
    chronology.push("message.delete");
  },
  disableControls: async () => {
    chronology.push("message.disable-controls");
  },
};

function submittedModalPhase(values: Record<string, string>) {
  return {
    phaseId: "document-modal",
    message: controller,
    values,
    multiValues: {},
    attachments: {},
    optionOffset: 0,
    beginInPlaceWork: async () => {
      chronology.push("ack:modal.deferUpdate");
      return { phaseId: "document-modal-work", message: controller };
    },
  };
}

function useButton(button: { customId: string; message: { id: string } }) {
  return {
    replace: async (payload: unknown) => {
      chronology.push(`ack:button.update:${button.customId}`);
      recordPayload("button.replace", payload);
    },
    edit: async (payload: unknown) => {
      chronology.push(`ack:button.deferUpdate:${button.customId}`);
      recordPayload("button.edit", payload);
    },
    beginInPlaceWork: async () => {
      chronology.push(`ack:button.deferUpdate:${button.customId}`);
      return { phaseId: `work-${button.customId}`, message: controller };
    },
    openModal: async (options: unknown) => {
      chronology.push(`ack:button.showModal:${button.customId}`);
      modalOptions.push(options as Payload);
      const modal = scenario.modals.shift() ?? { outcome: "timeout" as const };
      return modal.outcome === "submitted"
        ? { outcome: "submitted" as const, phase: submittedModalPhase(modal.values ?? {}) }
        : { outcome: modal.outcome };
    },
    delete: async () => {
      chronology.push(`ack:button.deleteReply:${button.customId}`);
    },
  };
}

function makePhase() {
  return {
    phaseId: "document-phase",
    message: controller,
    useButton,
  };
}

mock.module("@/utils/discord/ui/personaWorkflow", () => ({
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS: 120_000,
  buildPersonaWorkflowNotice: (options: {
    titleKey: string;
    descriptionKey: string;
    button?: { customId: string; labelKey: string; style: number };
  }) =>
    v2Notice(
      options.titleKey,
      options.descriptionKey,
      options.button
        ? {
            type: ComponentType.Button,
            customId: options.button.customId,
            label: options.button.labelKey,
            style: options.button.style,
          }
        : undefined,
    ),
  completePersonaWorkflow: (value?: unknown) => ({ action: "complete", value }),
  beginCanonicalPrivateWorkflow: async (
    interaction: { reply: (payload: unknown) => Promise<unknown> },
    _locale: string,
    payload: unknown,
  ) => {
    chronology.push("ack:root.reply");
    await interaction.reply(payload);
    return makePhase();
  },
  runPersonaPickerWorkflow: async (
    interaction: {
      deferred?: boolean;
      reply: (payload: unknown) => Promise<unknown>;
      editReply: (payload: unknown) => Promise<unknown>;
    },
    _locale: string,
    options: {
      personas: TomoriState[];
      onSelected: (phase: unknown) => Promise<unknown>;
    },
  ) => {
    chronology.push(interaction.deferred ? "ack:root.editReply-picker" : "ack:root.reply-picker");
    const pickerPayload = v2Notice("persona-picker", "persona-picker-description");
    if (interaction.deferred) await interaction.editReply(pickerPayload);
    else await interaction.reply(pickerPayload);
    const phase = makePhase();
    const selection = {
      ...phase,
      persona: options.personas[0],
      absoluteIndex: 0,
      beginInPlaceWork: async () => {
        chronology.push("ack:persona-button.deferUpdate");
        return { phaseId: "persona-work", message: controller };
      },
    };
    await options.onSelected(selection);
    return { outcome: "selected", persona: options.personas[0], absoluteIndex: 0 };
  },
}));

mock.module("@/utils/discord/ui/modals", () => ({
  safeSelectOptionText: (value: string) => value,
}));

mock.module("@/utils/discord/ui/embeds", () => ({
  replyInfoEmbed: async (
    interaction: {
      replied?: boolean;
      deferred?: boolean;
      reply: (payload: unknown) => Promise<unknown>;
      editReply?: (payload: unknown) => Promise<unknown>;
    },
    _locale: string,
    options: { titleKey: string; descriptionKey: string },
  ) => {
    const payload = { titleKey: options.titleKey, descriptionKey: options.descriptionKey };
    if ((interaction.replied || interaction.deferred) && interaction.editReply) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  },
}));

mock.module("@/utils/text/localizer", () => ({
  localizer: (_locale: string, key: string, variables?: Record<string, unknown>) =>
    variables ? `${key}:${JSON.stringify(variables)}` : key,
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
  },
  log: {
    error: async () => undefined,
    info: () => undefined,
    warn: () => undefined,
  },
}));

mock.module("@/utils/db/ragAvailability", () => ({
  isRagAvailable: () => true,
}));

const tomoriState = {
  server_id: 7,
  persona_id: 77,
  persona_nickname: "Tomori",
  config: {
    server_memteaching_enabled: true,
    embedding_model_id: 901,
  },
  llm: { llm_codename: "model", llm_provider: "provider" },
} as unknown as TomoriState;

mock.module("@/utils/cache/tomoriStateCache", () => ({
  getCachedTomoriState: async () => {
    chronology.push("cache.state");
    return tomoriState;
  },
  invalidateTomoriStateCache: (key: string) => {
    chronology.push("cache.invalidate");
    invalidations.push(key);
  },
}));

mock.module("@/utils/db/repositories", () => ({
  personaRepository: {
    loadAllForServer: async () => {
      chronology.push("repo.personas");
      return [tomoriState];
    },
  },
  llmModelRepo: {
    loadEmbeddingModelById: async (...args: unknown[]) => {
      chronology.push("repo.embedding-model");
      repositoryCalls.push({ method: "loadEmbeddingModelById", args });
      return {
        embedding_model_id: 901,
        provider: "provider",
        codename: "embed-model",
        model_family: "family",
      };
    },
  },
  serverMemoryRepository: {
    // Pre-picker eligibility source. Kept unconditionally eligible so existing
    // scenarios still flow through the picker and exercise the post-selection
    // `loadDocuments` backstop (which is what renders the in-place none state).
    personaIdsWithDocuments: async () => new Set([77]),
    loadDocuments: async (...args: unknown[]) => {
      chronology.push("repo.documents");
      repositoryCalls.push({ method: "loadDocuments", args });
      if (scenario.throwAt === "documents") throw new Error("documents failed");
      return scenario.documents;
    },
    loadDocumentMeta: async (...args: unknown[]) => {
      chronology.push("repo.meta");
      repositoryCalls.push({ method: "loadDocumentMeta", args });
      if (scenario.throwAt === "meta") throw new Error("metadata failed");
      return scenario.documentMeta;
    },
    loadDocumentChunks: async (...args: unknown[]) => {
      chronology.push("repo.chunks");
      repositoryCalls.push({ method: "loadDocumentChunks", args });
      if (scenario.throwAt === "chunks") throw new Error("chunks failed");
      return scenario.chunks.map((chunk) => ({ ...chunk }));
    },
    updateChunk: async (...args: unknown[]) => {
      chronology.push("repo.update-chunk");
      repositoryCalls.push({ method: "updateChunk", args });
      return scenario.updateChunkResult;
    },
    updateDocumentChannelTags: async (...args: unknown[]) => {
      chronology.push("repo.update-tags");
      repositoryCalls.push({ method: "updateDocumentChannelTags", args });
      return scenario.updateTagsResult;
    },
    deleteChunk: async (...args: unknown[]) => {
      chronology.push("repo.delete-chunk");
      repositoryCalls.push({ method: "deleteChunk", args });
      return scenario.deleteChunkResult;
    },
    removeDocument: async (...args: unknown[]) => {
      chronology.push("repo.remove-document");
      repositoryCalls.push({ method: "removeDocument", args });
      return scenario.removeDocumentResult;
    },
  },
}));

mock.module("@/utils/documents/documentService", () => ({
  formatVector: (embedding: number[]) => `[${embedding.join(",")}]`,
  rebuildDocumentTextContent: async (documentId: number) => {
    chronology.push("repo.rebuild-document");
    repositoryCalls.push({ method: "rebuildDocumentTextContent", args: [documentId] });
    if (scenario.throwAt === "rebuild") throw new Error("rebuild failed");
  },
}));

mock.module("@/utils/embeddings/embeddingProvider", () => ({
  providerSupportsEmbeddingTaskType: async () => true,
  generateEmbeddingsBatched: async () => {
    chronology.push("embedding.generate");
    if (scenario.embeddingResult instanceof Error) throw scenario.embeddingResult;
    return scenario.embeddingResult;
  },
}));

class PersonalProviderRequiredError extends Error {}
class CredentialUnavailableError extends Error {}

mock.module("@/utils/provider/credentialResolver", () => ({
  PersonalProviderRequiredError,
  CredentialUnavailableError,
  resolveCapabilityCredentials: async () => {
    chronology.push("embedding.credentials");
    return { apiKey: "test-key", modelIds: { embedding: 901 } };
  },
  getResolvedCapabilityModelId: () => 901,
}));

mock.module("@/utils/provider/personalProviderRuntime", () => ({
  applyPersonalProviderSelectionsToTomoriState: async (state: TomoriState) => {
    chronology.push("provider.overlay");
    return { tomoriState: state };
  },
}));

function makeInteraction(): ChatInputCommandInteraction {
  const interaction = {
    replied: false,
    deferred: false,
    channel: { id: "channel-1" },
    channelId: "channel-1",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    user: { id: "user-1" },
    memberPermissions: { has: () => true },
    options: {
      getString: (name: string) => (name === "scope" ? scenario.scope : null),
    },
    deferReply: async () => {
      rootCalls.push("deferReply");
      chronology.push("ack:root.deferReply");
      interaction.deferred = true;
    },
    reply: async (payload: unknown) => {
      rootCalls.push("reply");
      interaction.replied = true;
      recordPayload("root.reply", payload);
      return { resource: { message: { id: CANONICAL_MESSAGE_ID } } };
    },
    editReply: async (payload: unknown) => {
      rootCalls.push("editReply");
      recordPayload("root.editReply", payload);
    },
    followUp: async (payload: unknown) => {
      rootCalls.push("followUp");
      recordPayload("root.followUp", payload);
    },
  };
  return interaction as unknown as ChatInputCommandInteraction;
}

function makeClient(): Client {
  return {
    channels: {
      cache: new Map([["123", { name: "Resolved-Channel" }]]),
    },
  } as unknown as Client;
}

const userData = {
  user_id: 4,
  user_disc_id: "user-1",
  language_pref: "en-US",
} as unknown as UserRow;

function openDocument(documentId = 11): void {
  scenario.buttons.push("document_view_document-phase_open");
  scenario.modals.push({
    outcome: "submitted",
    values: { document_view_select: String(documentId) },
  });
}

function payloadText(payload: unknown): string {
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "content" && typeof nested === "string") texts.push(nested);
      else visit(nested);
    }
  };
  visit(payload);
  return texts.join("\n");
}

function allRenderedText(): string {
  return payloads.map((entry) => payloadText(entry.payload)).join("\n");
}

function expectCanonicalV2Only(): void {
  expect(new Set(payloads.map((entry) => entry.messageId))).toEqual(new Set([CANONICAL_MESSAGE_ID]));
  for (const entry of payloads) {
    expect(entry.payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(entry.payload).not.toHaveProperty("content");
    expect(entry.payload).not.toHaveProperty("embeds");
  }
  expect(rootCalls).toEqual(scenario.scope === "persona" ? ["deferReply", "editReply"] : ["reply"]);
  expect(rootCalls).not.toContain("followUp");
}

function expectBefore(first: string, second: string): void {
  const firstIndex = chronology.indexOf(first);
  const secondIndex = chronology.indexOf(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

function chronologyIndexes(value: string): number[] {
  return chronology.flatMap((entry, index) => (entry === value ? [index] : []));
}

async function runCommand(): Promise<void> {
  const { execute } = await import("@/commands/memory/document/view");
  await execute(makeClient(), makeInteraction(), userData, "en-US");
}

beforeEach(() => {
  scenario = makeScenario();
  chronology.length = 0;
  payloads.length = 0;
  rootCalls.length = 0;
  modalOptions.length = 0;
  repositoryCalls.length = 0;
  invalidations.length = 0;
});

describe("/memory document view canonical workflow", () => {
  it("keeps no-document state on the persona picker message after acknowledging selection", async () => {
    scenario.documents = [];

    await runCommand();

    expectBefore("ack:root.deferReply", "cache.state");
    expectBefore("ack:root.deferReply", "repo.personas");
    expectBefore("ack:persona-button.deferUpdate", "repo.documents");
    expect(allRenderedText()).toContain("commands.memory.document.view.none_title");
    expectCanonicalV2Only();
  });

  it("rejects an invalid selected document before metadata or chunk reads", async () => {
    openDocument(999);

    await runCommand();

    expect(chronology.lastIndexOf("message.replace")).toBeGreaterThan(chronology.indexOf("ack:modal.deferUpdate"));
    expect(repositoryCalls.some((call) => call.method === "loadDocumentMeta")).toBe(false);
    expect(repositoryCalls.some((call) => call.method === "loadDocumentChunks")).toBe(false);
    expect(allRenderedText()).toContain("general.errors.invalid_option_title");
    expectCanonicalV2Only();
  });

  it("renders missing metadata and no-chunk states in place after document acknowledgement", async () => {
    for (const variant of ["metadata", "chunks"] as const) {
      openDocument();
      if (variant === "metadata") scenario.documentMeta = null;
      else scenario.chunks = [];

      await runCommand();

      expectBefore("ack:modal.deferUpdate", "repo.meta");
      if (variant === "metadata") {
        expect(allRenderedText()).toContain("general.errors.invalid_option_title");
      } else {
        expectBefore("ack:modal.deferUpdate", "repo.chunks");
        expect(allRenderedText()).toContain("commands.memory.document.view.no_chunks_title");
      }
      expectCanonicalV2Only();

      scenario = makeScenario();
      chronology.length = 0;
      payloads.length = 0;
      rootCalls.length = 0;
      modalOptions.length = 0;
      repositoryCalls.length = 0;
    }
  });

  it("navigates next and previous while retaining the same V2 message", async () => {
    openDocument();
    scenario.buttons.push("doc_view_next", "doc_view_prev", "doc_view_close");

    await runCommand();

    const viewTexts = payloads.map((entry) => payloadText(entry.payload));
    expect(viewTexts.filter((text) => text.includes("beta")).length).toBeGreaterThanOrEqual(1);
    expect(viewTexts.filter((text) => text.includes("alpha")).length).toBeGreaterThanOrEqual(2);
    expect(chronology).toContain("ack:button.update:doc_view_next");
    expect(chronology).toContain("ack:button.update:doc_view_prev");
    expect(chronology.at(-1)).toBe("ack:button.deleteReply:doc_view_close");
    expectCanonicalV2Only();
  });

  it("edits content and tags only after acknowledging the edit modal, then invalidates after writes", async () => {
    openDocument();
    scenario.buttons.push("doc_view_edit", "doc_view_close");
    scenario.modals.push({
      outcome: "submitted",
      values: {
        edit_chunk_content: "updated alpha",
        edit_chunk_channel_tags: "<#123>, Support",
      },
    });

    await runCommand();

    expectBefore("ack:modal.deferUpdate", "embedding.credentials");
    expectBefore("ack:modal.deferUpdate", "repo.update-chunk");
    expectBefore("ack:modal.deferUpdate", "repo.update-tags");
    expectBefore("repo.update-chunk", "cache.invalidate");
    expectBefore("cache.invalidate", "repo.rebuild-document");
    const invalidationIndexes = chronologyIndexes("cache.invalidate");
    expect(invalidationIndexes).toHaveLength(3);
    expect(invalidationIndexes[1]).toBeGreaterThan(chronology.indexOf("repo.rebuild-document"));
    expect(invalidationIndexes[1]).toBeLessThan(chronology.indexOf("repo.update-tags"));
    expect(invalidationIndexes[2]).toBeGreaterThan(chronology.indexOf("repo.update-tags"));
    expect(repositoryCalls.find((call) => call.method === "updateChunk")?.args[0]).toMatchObject({
      chunkId: 101,
      personaId: 77,
      content: "updated alpha",
    });
    expect(repositoryCalls.find((call) => call.method === "updateDocumentChannelTags")?.args).toEqual([
      11,
      7,
      ["#resolved-channel", "#support"],
      77,
    ]);
    expect(allRenderedText()).toContain("commands.memory.document.view.edit_success_both");
    expect(invalidations).toEqual(["guild-1", "guild-1", "guild-1"]);
    expectCanonicalV2Only();
  });

  it("retains the immediate chunk invalidation when rebuilding document text fails", async () => {
    openDocument();
    scenario.buttons.push("doc_view_edit");
    scenario.modals.push({
      outcome: "submitted",
      values: { edit_chunk_content: "updated alpha", edit_chunk_channel_tags: "#general" },
    });
    scenario.throwAt = "rebuild";

    await runCommand();

    expectBefore("repo.update-chunk", "cache.invalidate");
    expectBefore("cache.invalidate", "repo.rebuild-document");
    expect(invalidations).toEqual(["guild-1"]);
    expect(allRenderedText()).toContain("general.errors.unknown_error_title");
    expectCanonicalV2Only();
  });

  it("handles empty and unchanged edits without embedding or persistence", async () => {
    for (const variant of ["empty", "unchanged"] as const) {
      openDocument();
      scenario.buttons.push("doc_view_edit", "doc_view_close");
      scenario.modals.push({
        outcome: "submitted",
        values: {
          edit_chunk_content: variant === "empty" ? "   " : "alpha",
          edit_chunk_channel_tags: "#general",
        },
      });

      await runCommand();

      expect(chronology).not.toContain("embedding.generate");
      expect(chronology).not.toContain("repo.update-chunk");
      expect(allRenderedText()).toContain(
        variant === "empty"
          ? "commands.memory.document.view.edit_empty_content_title"
          : "commands.memory.document.view.edit_no_changes_title",
      );
      expectCanonicalV2Only();

      scenario = makeScenario();
      chronology.length = 0;
      payloads.length = 0;
      rootCalls.length = 0;
      modalOptions.length = 0;
      repositoryCalls.length = 0;
    }
  });

  it("keeps embedding and chunk-persistence failures in the current view", async () => {
    for (const variant of ["embedding", "database"] as const) {
      openDocument();
      scenario.buttons.push("doc_view_edit", "doc_view_close");
      scenario.modals.push({
        outcome: "submitted",
        values: { edit_chunk_content: "updated", edit_chunk_channel_tags: "#general" },
      });
      if (variant === "embedding") scenario.embeddingResult = new Error("embedding unavailable");
      else scenario.updateChunkResult = false;

      await runCommand();

      expect(allRenderedText()).toContain("commands.memory.document.view.embedding_error_title");
      expect(invalidations).toHaveLength(0);
      if (variant === "embedding") expect(chronology).not.toContain("repo.update-chunk");
      else expect(chronology).toContain("repo.update-chunk");
      expectCanonicalV2Only();

      scenario = makeScenario();
      chronology.length = 0;
      payloads.length = 0;
      rootCalls.length = 0;
      modalOptions.length = 0;
      repositoryCalls.length = 0;
      invalidations.length = 0;
    }
  });

  it("cancels delete confirmation without writing", async () => {
    openDocument();
    scenario.buttons.push("doc_view_delete", "doc_view_cancel_delete", "doc_view_close");

    await runCommand();

    expect(allRenderedText()).toContain("commands.memory.document.view.delete_confirm_title");
    expect(chronology).not.toContain("repo.delete-chunk");
    expect(chronology).toContain("ack:button.update:doc_view_cancel_delete");
    expectCanonicalV2Only();
  });

  it("deletes one chunk, rebuilds the document, and keeps browsing", async () => {
    openDocument();
    scenario.buttons.push("doc_view_delete", "doc_view_confirm_delete", "doc_view_close");

    await runCommand();

    expectBefore("ack:button.deferUpdate:doc_view_confirm_delete", "repo.delete-chunk");
    expect(chronology).toContain("repo.rebuild-document");
    expect(chronology).not.toContain("repo.remove-document");
    const invalidationIndexes = chronologyIndexes("cache.invalidate");
    expect(invalidationIndexes).toHaveLength(2);
    expect(invalidationIndexes[0]).toBeGreaterThan(chronology.indexOf("repo.delete-chunk"));
    expect(invalidationIndexes[0]).toBeLessThan(chronology.indexOf("repo.rebuild-document"));
    expect(invalidationIndexes[1]).toBeGreaterThan(chronology.indexOf("repo.rebuild-document"));
    expect(allRenderedText()).toContain("commands.memory.document.view.delete_success_title");
    expect(invalidations).toEqual(["guild-1", "guild-1"]);
    expectCanonicalV2Only();
  });

  it("deletes the parent document after deleting its final chunk", async () => {
    scenario.chunks = [scenario.chunks[0]];
    openDocument();
    scenario.buttons.push("doc_view_delete", "doc_view_confirm_delete");

    await runCommand();

    expectBefore("ack:button.deferUpdate:doc_view_confirm_delete", "repo.delete-chunk");
    expectBefore("repo.delete-chunk", "repo.remove-document");
    expect(allRenderedText()).toContain("commands.memory.document.view.delete_document_title");
    expect(invalidations).toEqual(["guild-1", "guild-1"]);
    expectCanonicalV2Only();
  });

  it("closes by deleting the workflow-owned canonical response", async () => {
    openDocument();
    scenario.buttons.push("doc_view_close");

    await runCommand();

    expect(chronology.at(-1)).toBe("ack:button.deleteReply:doc_view_close");
    expectCanonicalV2Only();
  });

  it("removes controls on timeout while preserving the current chunk", async () => {
    openDocument();
    scenario.buttons.push("timeout");

    await runCommand();

    const terminalText = payloadText(payloads.at(-1)?.payload);
    expect(terminalText).toContain("alpha");
    expect(terminalText).toContain("general.interaction.timeout_title");
    expect(terminalText).not.toContain("commands.memory.document.view.btn_close");
    expectCanonicalV2Only();
  });

  it("reports unexpected selected-persona errors on the canonical message", async () => {
    scenario.throwAt = "meta";
    openDocument();

    await runCommand();

    expect(allRenderedText()).toContain("general.errors.unknown_error_title");
    expect(rootCalls).toEqual(["deferReply", "editReply"]);
    expectCanonicalV2Only();
  });

  it("routes serverwide documents with a null persona after acknowledging the root", async () => {
    scenario.scope = "serverwide";
    openDocument();
    scenario.buttons.push("doc_view_close");

    await runCommand();

    expectBefore("ack:root.reply", "cache.state");
    expectBefore("ack:root.reply", "provider.overlay");
    expectBefore("ack:root.reply", "repo.documents");
    expect(repositoryCalls.find((call) => call.method === "loadDocuments")?.args).toEqual([7, null]);
    expect(repositoryCalls.find((call) => call.method === "loadDocumentMeta")?.args).toEqual([11, 7, null]);
    expect(repositoryCalls.find((call) => call.method === "loadDocumentChunks")?.args).toEqual([11, 7, null]);
    expect(chronology).not.toContain("repo.personas");
    expectCanonicalV2Only();
  });

  it("passes exactly 25 and 26 documents to the modal bridge without losing absolute IDs", async () => {
    for (const count of [25, 26] as const) {
      scenario.documents = Array.from({ length: count }, (_, index) => ({
        document_id: 1000 + index,
        document_name: `Document ${index + 1}`,
        first_chunk: `Chunk ${index + 1}`,
      }));
      scenario.documentMeta = { document_name: `Document ${count}`, channel_tags: [] };
      scenario.chunks = [{ document_chunk_id: 5000, chunk_index: 0, content: "selected chunk" }];
      openDocument(1000 + count - 1);
      scenario.buttons.push("doc_view_close");

      await runCommand();

      const documentModal = modalOptions[0];
      const components = documentModal?.components as Array<{ options?: Array<{ value: string }> }>;
      const options = components[0]?.options ?? [];
      expect(options).toHaveLength(count);
      expect(options[0]?.value).toBe("1000");
      expect(options.at(-1)?.value).toBe(String(1000 + count - 1));
      expect(repositoryCalls.find((call) => call.method === "loadDocumentMeta")?.args[0]).toBe(1000 + count - 1);
      expectCanonicalV2Only();

      scenario = makeScenario();
      chronology.length = 0;
      payloads.length = 0;
      rootCalls.length = 0;
      modalOptions.length = 0;
      repositoryCalls.length = 0;
    }
  });
});
