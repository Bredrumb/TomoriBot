import { AttachmentBuilder } from "discord.js";
import * as modalModule from "@/utils/discord/ui/modals";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { APIAttachment, Client, ModalSubmitInteraction } from "discord.js";
import type { LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { LOREBOOK_PLACEMENT, LOREBOOK_SELECTIVE_LOGIC } from "@/modules/lorebooks/db/types";
import type { LorebookConversion } from "@/modules/lorebooks/imports";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import {
  createMemoriesInteractionRoute,
  type MemoriesRouteDependencies,
} from "@/utils/discord/interactions/memoriesRoutes";
import { parseInteractionRoute, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import type { TomoriState } from "@/types/db/schema";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import * as safeDownloadModule from "@/utils/security/safeDownload";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

const WORKSPACE_ID = "guild-123";
const VALID_CHANNEL = "111111111111111111";
const FORGED_CHANNEL = "999999999999999999";

function requireRoute(customId: string): ParsedInteractionRoute {
  const parsed = parseInteractionRoute(customId);
  if (!parsed) throw new Error(`Failed to parse route: ${customId}`);
  return parsed;
}

function makePersona(id: number, lineageId: number, name: string): TomoriState {
  return createPersona({ persona_id: id, persona_lineage_id: lineageId, persona_nickname: name });
}

function makeEntry(id: number, overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return {
    entry_id: id,
    server_id: 1,
    persona_lineage_id: 1770,
    title: `Entry ${id}`,
    content: `Content for entry ${id}.`,
    keys: ["manor"],
    secondary_keys: [],
    selective_logic: LOREBOOK_SELECTIVE_LOGIC.AND_ANY,
    scan_depth: 5,
    trigger_chance: 100,
    insertion_order: 100,
    placement: LOREBOOK_PLACEMENT.BEFORE,
    constant: false,
    enabled: true,
    channel_disc_ids: [],
    legacy_channel_tags: [],
    ...overrides,
  };
}

const MODAL_ATTACHMENT = {
  id: "attachment-1",
  url: "https://cdn.example.invalid/lorebook.json",
  filename: "lorebook.json",
  content_type: "application/json",
  size: 128,
} as APIAttachment;

const MODAL_BUFFER = Buffer.from(JSON.stringify({ entries: [] }));

interface InteractionOptions {
  values?: string[];
  fields?: Record<string, string>;
  manage?: boolean;
  kind?: "button" | "select" | "modal";
}

function makeInteraction(customId: string, options: InteractionOptions = {}) {
  const state = {
    deferred: false,
    replied: false,
    payload: null as unknown,
    followUps: [] as Array<{ content?: string; files?: AttachmentBuilder[] }>,
  };
  const kind = options.kind ?? "button";
  const manage = options.manage ?? true;
  const guild = {
    channels: {
      cache: new Map([[VALID_CHANNEL, { id: VALID_CHANNEL }]]),
      fetch: async (channelId: string) => {
        if (channelId === VALID_CHANNEL) return { id: VALID_CHANNEL };
        throw new Error("Unknown channel");
      },
    },
  };
  const interaction = {
    id: `int-${customId}`,
    customId,
    user: { id: "user-42", username: "user42" },
    guildId: WORKSPACE_ID,
    guild,
    memberPermissions: { has: (permission: string) => manage && permission === "ManageGuild" },
    get deferred() {
      return state.deferred;
    },
    get replied() {
      return state.replied;
    },
    get payload() {
      return state.payload;
    },
    get followUps() {
      return state.followUps;
    },
    followUp: async (payload: { content?: string; files?: AttachmentBuilder[] }) => {
      expect(state.deferred).toBe(true);
      state.followUps.push(payload);
    },
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isModalSubmit: () => kind === "modal",
    values: options.values ?? [],
    fields: {
      getTextInputValue: (fieldId: string) => {
        if (!(fieldId in (options.fields ?? {}))) throw new Error(`Missing field ${fieldId}`);
        return options.fields?.[fieldId] ?? "";
      },
    },
    deferUpdate: async () => {
      state.deferred = true;
    },
    editReply: async (payload: unknown) => {
      state.replied = true;
      state.payload = payload;
    },
  };
  return interaction;
}

interface LorebookDependencies {
  dependencies: MemoriesRouteDependencies;
  calls: string[];
  entries: LorebookEntryRow[];
  setEntries(entries: LorebookEntryRow[]): void;
}

function createDependencies(
  overrides: Partial<MemoriesRouteDependencies> = {},
  initialEntries: LorebookEntryRow[] = [makeEntry(1), makeEntry(2, { persona_lineage_id: 1880 })],
): LorebookDependencies {
  const calls: string[] = [];
  let entries = initialEntries;
  const dependencies: MemoriesRouteDependencies = {
    resolveScope: async (interaction) => {
      calls.push("resolveScope");
      return {
        serverId: 1,
        workspaceId: WORKSPACE_ID,
        guildId: WORKSPACE_ID,
        userDiscId: interaction.user.id,
        userId: 42,
        canManage: interaction.memberPermissions?.has("ManageGuild") ?? false,
        isBlacklisted: false,
        memteachingEnabled: true,
        configuredEmbeddingModelId: null,
        personas: [makePersona(10, 1770, "Tomori"), makePersona(20, 1880, "Juno")],
        readStatus: "fresh",
      };
    },
    loadMemories: async () => [],
    getMemoryCountsByLineage: async () => new Map(),
    getPersonaAvatarData: async (_interaction, persona) => ({
      url: `https://cdn.example.invalid/${persona.persona_id}.png`,
      files: [],
    }),
    loadDocuments: async () => [],
    loadDocumentMeta: async () => null,
    loadDocumentChunks: async () => [],
    getDocumentCounts: async () => ({ documents: 0, chunks: 0 }),
    getDocumentCountsByPersona: async () => ({ byPersona: new Map(), serverwide: 0 }),
    getEligibleHistoryPersonaIds: async () => new Set(),
    loadLorebooks: async (serverId, lineageId) => {
      calls.push(`loadLorebooks:${serverId}:${lineageId ?? "serverwide"}`);
      return {
        status: "fresh",
        entries: entries.filter((entry) => entry.persona_lineage_id === lineageId),
      };
    },
    getLorebookCollections: async () => [{ lorebook_id: 1, name: "General", enabled: true, channel_disc_ids: [] }],
    getLorebookCounts: async () =>
      new Map<number | null, number>([
        [null, 1],
        [1770, 1],
        [1880, 1],
      ]),
    lorebookOperations: {
      add: async (input) => {
        calls.push("op:add");
        return { status: "success", entryId: 99, title: input.title };
      },
      editEntry: async (input) => {
        calls.push("op:editEntry");
        return { status: "success", title: input.title };
      },
      editActivation: async () => {
        calls.push("op:editActivation");
        return { status: "success", title: "Entry 1" };
      },
      setFlags: async (input) => {
        calls.push(`op:setFlags:${JSON.stringify(input.flags)}`);
        return { status: "success" };
      },
      remove: async () => {
        calls.push("op:remove");
        return { status: "success", title: "Entry 1" };
      },
    },
    getStmEntries: async () => [],
    preWarmServerStm: async () => {},
    operations: {
      add: async () => ({ status: "write-failed" }),
      addBatch: async () => ({ status: "write-failed" }),
      edit: async () => ({ status: "write-failed" }),
      remove: async () => ({ status: "write-failed" }),
    },
    documentOperations: {
      add: async () => ({ status: "write-failed" }),
      remove: async () => ({ status: "write-failed" }),
      editChunk: async () => ({ status: "write-failed" }),
      removeChunk: async () => ({ status: "write-failed" }),
      vectorize: async () => ({ status: "write-failed" }),
    },
    recordAction: (input) => {
      calls.push(`record:${input.action}`);
    },
    createNonce: () => "nonce123",
    showAddModal: async () => {},
    takeFileUpload: () => undefined,
    takeDocumentFileUpload: () => undefined,
    readUploadedText: async () => ({ isValid: true, text: "" }),
    showEditModal: async () => {},
    showAddDocumentModal: async () => {},
    showEditChunkModal: async () => {},
    showVectorizeModal: async () => {},
    showStmModal: async () => {},
    showAddLorebookModal: async (_interaction, _locale, scopeLineageId) => {
      calls.push(`showAddLorebookModal:${scopeLineageId}`);
    },
    showImportLorebookModal: async (_interaction, _locale, scopeLineageId) => {
      calls.push(`showImportLorebookModal:${scopeLineageId}`);
    },
    showEditLorebookModal: async (_interaction, _locale, scopeLineageId, entry) => {
      calls.push(`showEditLorebookModal:${scopeLineageId}:${entry.entry_id}`);
    },
    showLorebookActivationModal: async (_interaction, _locale, scopeLineageId, entry) => {
      calls.push(`showLorebookActivationModal:${scopeLineageId}:${entry.entry_id}`);
    },
    takeLorebookFileUpload: () => MODAL_ATTACHMENT,
    parseLorebookUpload: () => ({
      ok: true,
      conversion: { entries: [makeEntry(50)], report: emptyReport() },
    }),
    filterChannelScope: async (_interaction, channelIds) =>
      channelIds.filter((channelId) => channelId === VALID_CHANNEL),
    takeCheckboxValues: () => [],
    takeStringSelectValues: () => undefined,
    takeChannelSelectValues: () => [],
    clearStm: () => {},
    ...overrides,
  };

  return {
    dependencies,
    calls,
    get entries() {
      return entries;
    },
    setEntries(next: LorebookEntryRow[]) {
      entries = next;
    },
  };
}

function emptyReport() {
  return { skippedEntries: 0, unsupportedKeys: 0, ignoredEntries: 0, collapsedPlacement: 0 };
}

async function runRoute(
  dependencies: Partial<MemoriesRouteDependencies>,
  interaction: ReturnType<typeof makeInteraction>,
): Promise<void> {
  const route = createMemoriesInteractionRoute(dependencies);
  await route.execute(
    {} as Client,
    interaction as unknown as ModalSubmitInteraction,
    requireRoute(interaction.customId),
  );
}

function payloadText(interaction: ReturnType<typeof makeInteraction>): string[] {
  return collectTextDisplays(interaction.payload);
}

describe("lorebook panel routes", () => {
  it("opens add and import modals for the scope on screen without deferring", async () => {
    const { dependencies, calls } = createDependencies();
    const add = makeInteraction("memories:v1:lore-select:en-US:1770", {
      kind: "select",
      values: ["action:add-lorebook"],
    });
    await runRoute(dependencies, add);
    expect(calls).toContain("showAddLorebookModal:1770");
    expect(add.deferred).toBe(false);

    const importInteraction = makeInteraction("memories:v1:lore-select:en-US:0", {
      kind: "select",
      values: ["action:import-lorebook"],
    });
    await runRoute(dependencies, importInteraction);
    expect(calls).toContain("showImportLorebookModal:0");
    expect(importInteraction.deferred).toBe(false);
    const collectionImport = makeInteraction("memories:v1:lore-book-select:en-US", {
      kind: "select",
      values: ["action:import-book"],
    });
    await runRoute(dependencies, collectionImport);
    expect(calls).toContain("showImportLorebookModal:null");
    expect(collectionImport.deferred).toBe(false);
  });

  it("refuses modal opening for non-managers and stale scopes by repainting in place", async () => {
    const { dependencies, calls } = createDependencies();
    const nonManager = makeInteraction("memories:v1:lore-select:en-US:0", {
      kind: "select",
      values: ["action:add-lorebook"],
      manage: false,
    });
    await runRoute(dependencies, nonManager);
    expect(calls.some((call) => call.startsWith("show"))).toBe(false);
    expect(nonManager.deferred).toBe(true);
    expect(
      payloadText(nonManager).some((text) =>
        text.includes(localizer("en-US", "commands.memories.manager_only_heading")),
      ),
    ).toBe(true);

    const stale = makeInteraction("memories:v1:lore-select:en-US:9999", {
      kind: "select",
      values: ["action:import-lorebook"],
    });
    await runRoute(dependencies, stale);
    expect(calls.some((call) => call.startsWith("show"))).toBe(false);
    expect(
      payloadText(stale).some((text) =>
        text.includes(localizer("en-US", "commands.memories.lorebook_changed_state_heading")),
      ),
    ).toBe(true);
  });

  it("prefills Edit from cached channels without fetching deleted channels before the modal", async () => {
    const { dependencies } = createDependencies({}, [
      makeEntry(1, { channel_disc_ids: [VALID_CHANNEL, FORGED_CHANNEL] }),
    ]);
    const overrides: Partial<MemoriesRouteDependencies> = { ...dependencies };
    delete overrides.showEditLorebookModal;
    const interaction = makeInteraction("memories:v1:lore-edit-open:en-US:1770:1");
    const fetch = spyOn(interaction.guild.channels, "fetch");
    const modal = spyOn(modalModule, "showRoutedRawModal").mockResolvedValue();
    try {
      await runRoute(overrides, interaction);
      expect(fetch).not.toHaveBeenCalled();
      expect(modal).toHaveBeenCalled();
      expect(interaction.deferred).toBe(false);
      const payload = JSON.stringify(modal.mock.calls[0]?.[1]);
      expect(payload).toContain(VALID_CHANNEL);
      expect(payload).not.toContain(FORGED_CHANNEL);
    } finally {
      fetch.mockRestore();
      modal.mockRestore();
    }
  });

  it("exports only the selected collection after acknowledgement and guards empty or unauthorized scopes", async () => {
    const entry = makeEntry(1, { persona_lineage_id: null, lorebook_name: "General" });
    const { dependencies } = createDependencies({}, [
      entry,
      makeEntry(2, { persona_lineage_id: null, lorebook_name: "Other" }),
    ]);
    const interaction = makeInteraction("memories:v1:lore-select:en-US:0:0:1", {
      kind: "select",
      values: ["action:export-lorebook"],
    });
    await runRoute(dependencies, interaction);
    const attachment = interaction.followUps[0]?.files?.[0];
    expect(attachment).toBeInstanceOf(AttachmentBuilder);
    if (!attachment || !Buffer.isBuffer(attachment.attachment)) throw new Error("Missing export buffer");
    const exported = JSON.parse(attachment.attachment.toString());
    expect(Object.values(exported.entries)).toHaveLength(1);
    expect(exported.entries["0"].content).toBe(entry.content);
    expect(interaction.followUps[0]?.content).toBe(
      localizedCopy("en-US", "commands.memories.lorebook_export_detail", { count: 1 }),
    );
    for (const [scope, manage, entries, key] of [
      [1770, false, [makeEntry(1)], "manager_only_heading"],
      [9999, true, [makeEntry(1)], "lorebook_changed_state_heading"],
      [1770, true, [], "lorebook_export_empty_heading"],
    ] as const) {
      const blocked = createDependencies({}, [...entries]);
      const target = makeInteraction(`memories:v1:lore-select:en-US:${scope}`, {
        kind: "select",
        manage,
        values: ["action:export-lorebook"],
      });
      await runRoute(blocked.dependencies, target);
      expect(target.followUps).toHaveLength(0);
      expect(
        payloadText(target).some((text) => text.includes(localizedCopy("en-US", `commands.memories.${key}`))),
      ).toBe(true);
    }
  });

  it("keeps Serverwide and Persona reads distinct and falls back for an unknown lineage", async () => {
    const { dependencies, calls } = createDependencies();
    const category = makeInteraction("memories:v1:category:en-US:lorebooks", { kind: "button" });
    await runRoute(dependencies, category);
    expect(calls).toContain("loadLorebooks:1:serverwide");

    calls.length = 0;
    const personaScope = makeInteraction("memories:v1:lore-scope:en-US:1770", { kind: "button" });
    await runRoute(dependencies, personaScope);
    expect(calls).toContain("loadLorebooks:1:1770");

    calls.length = 0;
    const staleScope = makeInteraction("memories:v1:lore-scope:en-US:9999", { kind: "button" });
    await runRoute(dependencies, staleScope);
    expect(calls).toContain("loadLorebooks:1:serverwide");
    expect(
      payloadText(staleScope).some((text) =>
        text.includes(localizer("en-US", "commands.memories.lorebook_changed_state_heading")),
      ),
    ).toBe(true);

    calls.length = 0;
    const personaSelect = makeInteraction("memories:v1:lore-persona-select:en-US:1770", {
      kind: "select",
      values: ["1880"],
    });
    await runRoute(dependencies, personaSelect);
    expect(calls).toContain("loadLorebooks:1:1880");
  });

  it("passes the selected entry and page range back to the panel", async () => {
    const entries = Array.from({ length: 30 }, (_, index) => makeEntry(index + 1));
    const { dependencies } = createDependencies({}, entries);
    const selected = makeInteraction("memories:v1:lore-select:en-US:1770:1", {
      kind: "select",
      values: ["25"],
    });
    await runRoute(dependencies, selected);
    const meta = localizedCopy("en-US", "commands.memories.lorebook_entry_meta", {
      keys: "manor",
      depth: 5,
      chance: 100,
      order: 100,
      placement: localizedCopy("en-US", "commands.memories.lorebook_placement_before"),
    });
    expect(payloadText(selected).some((text) => text.replace(/^> /gm, "").includes(meta))).toBe(true);

    const page = makeInteraction("memories:v1:lore-range:en-US:1770:1", { kind: "button" });
    await runRoute(dependencies, page);
    const rendered = JSON.stringify(page.payload);
    expect(rendered).toContain("memories:v1:lore-select:en-US:1770:1");
  });

  it("keeps book mutations authorized and acknowledged and makes deletion wait for confirmation", async () => {
    const create = spyOn(lorebookRepository, "createBook").mockResolvedValue(1);
    const rename = spyOn(lorebookRepository, "renameBook").mockResolvedValue(true);
    const remove = spyOn(lorebookRepository, "deleteBook").mockResolvedValue(true);
    try {
      const { dependencies } = createDependencies();
      for (const customId of [
        "memories:v1:lore-book-create-submit:en-US:nonce123",
        "memories:v1:lore-book-rename-submit:en-US:1:nonce123",
        "memories:v1:lore-book-remove-confirm:en-US:1",
      ]) {
        await runRoute(
          dependencies,
          makeInteraction(customId, { kind: customId.includes("submit") ? "modal" : "button", manage: false }),
        );
      }
      expect(create).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      const prompt = makeInteraction("memories:v1:lore-book-remove-prompt:en-US:1");
      await runRoute(dependencies, prompt);
      expect(JSON.stringify(prompt.payload)).toContain("lore-book-remove-confirm");
      expect(remove).not.toHaveBeenCalled();
      const submit = makeInteraction("memories:v1:lore-book-create-submit:en-US:nonce123", {
        kind: "modal",
        fields: { book_name_nonce123: "Manor" },
      });
      create.mockImplementation(async () => {
        expect(submit.deferred).toBe(true);
        return 1;
      });
      await runRoute(dependencies, submit);
      expect(create).toHaveBeenCalledWith(1, "Manor");
      await runRoute(
        dependencies,
        makeInteraction("memories:v1:lore-book-rename-submit:en-US:1:nonce123", {
          kind: "modal",
          fields: { book_name_nonce123: "Estate" },
        }),
      );
      expect(rename).toHaveBeenCalledWith(1, 1, "Estate");
      await runRoute(dependencies, makeInteraction("memories:v1:lore-book-remove-confirm:en-US:1"));
      expect(remove).toHaveBeenCalledWith(1, 1);
    } finally {
      create.mockRestore();
      rename.mockRestore();
      remove.mockRestore();
    }
  });

  it("rechecks permission and scope on every write before calling the operation", async () => {
    const { dependencies, calls } = createDependencies();
    const routes = [
      "memories:v1:lore-add-submit:en-US:0:nonce123:1",
      "memories:v1:lore-import-submit:en-US:0:nonce123:1",
      "memories:v1:lore-edit-submit:en-US:0:1:nonce123",
      "memories:v1:lore-activation-submit:en-US:0:1:nonce123",
      "memories:v1:lore-toggle-enabled:en-US:0:1",
      "memories:v1:lore-remove-prompt:en-US:0:1",
      "memories:v1:lore-remove-confirm:en-US:0:1",
      "memories:v1:lore-remove-cancel:en-US:0:1",
    ];
    for (const customId of routes) {
      const kind = customId.includes("submit") ? "modal" : "button";
      const interaction = makeInteraction(customId, { kind, manage: false });
      await runRoute(dependencies, interaction);
    }
    expect(calls.some((call) => call.startsWith("op:"))).toBe(false);
    expect(calls.some((call) => call.startsWith("record:"))).toBe(false);
  });

  it("adds an entry with parsed keys in its collection and a verified channel scope", async () => {
    let written: Parameters<MemoriesRouteDependencies["lorebookOperations"]["add"]>[0] | undefined;
    let acknowledgedDuringWrite = false;
    let interaction: ReturnType<typeof makeInteraction>;
    const { dependencies, calls } = createDependencies({
      takeStringSelectValues: () => ["1"],
      takeChannelSelectValues: () => [VALID_CHANNEL],
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        add: async (input) => {
          written = input;
          acknowledgedDuringWrite = interaction.deferred;
          return { status: "success", entryId: 77, title: input.title };
        },
      },
    });
    interaction = makeInteraction("memories:v1:lore-add-submit:en-US:1770:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "  The Manor  ",
        keys_nonce123: " manor, estate, manor ",
        content_nonce123: "It overlooks the sea.",
      },
    });
    await runRoute(dependencies, interaction);

    expect(acknowledgedDuringWrite).toBe(true);
    expect(written).toMatchObject({
      serverId: 1,
      lineageId: 1770,
      canManage: true,
      title: "  The Manor  ",
      content: "It overlooks the sea.",
      keys: ["manor", "estate"],
      channelDiscIds: [VALID_CHANNEL],
    });
    expect(calls).toContain("record:memories.workspace.lorebook.add");
    expect(
      payloadText(interaction).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_added_heading")),
      ),
    ).toBe(true);
  });

  it("refuses a forged or missing channel scope without writing", async () => {
    const { dependencies, calls } = createDependencies({
      takeStringSelectValues: () => ["0"],
      takeChannelSelectValues: () => [FORGED_CHANNEL],
    });
    const forged = makeInteraction("memories:v1:lore-add-submit:en-US:1770:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "Title",
        keys_nonce123: "key",
        content_nonce123: "Content",
      },
    });
    await runRoute(dependencies, forged);
    expect(calls).not.toContain("op:add");
    expect(
      payloadText(forged).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_channels_invalid_heading")),
      ),
    ).toBe(true);

    const missing = createDependencies({
      takeStringSelectValues: () => ["0"],
      takeChannelSelectValues: () => undefined,
    });
    const noChannelField = makeInteraction("memories:v1:lore-add-submit:en-US:1770:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "Title",
        keys_nonce123: "key",
        content_nonce123: "Content",
      },
    });
    await runRoute(missing.dependencies, noChannelField);
    expect(missing.calls).not.toContain("op:add");
  });

  it("authorizes collection state and channels, rejects foreign channels, and repaints the new state", async () => {
    let book = { lorebook_id: 1, name: "General", enabled: true, channel_disc_ids: [] as string[] };
    const state = spyOn(lorebookRepository, "setBookEnabled");
    const channels = spyOn(lorebookRepository, "setBookChannels").mockResolvedValue(true);
    try {
      const { dependencies } = createDependencies({
        getLorebookCollections: async () => [book],
        takeChannelSelectValues: () => [FORGED_CHANNEL],
      });
      for (const customId of [
        "memories:v1:lore-book-toggle-enabled:en-US:1",
        "memories:v1:lore-book-channels-submit:en-US:1:nonce123",
      ]) {
        await runRoute(
          dependencies,
          makeInteraction(customId, { kind: customId.includes("submit") ? "modal" : "button", manage: false }),
        );
      }
      expect(state).not.toHaveBeenCalled();
      expect(channels).not.toHaveBeenCalled();
      await runRoute(
        dependencies,
        makeInteraction("memories:v1:lore-book-channels-submit:en-US:1:nonce123", { kind: "modal" }),
      );
      expect(channels).not.toHaveBeenCalled();
      const toggle = makeInteraction("memories:v1:lore-book-toggle-enabled:en-US:1");
      state.mockImplementation(async (_serverId, _bookId, enabled) => {
        expect(toggle.deferred).toBe(true);
        book = { ...book, enabled };
        return true;
      });
      await runRoute(dependencies, toggle);
      expect(state).toHaveBeenCalledWith(1, 1, false);
      expect(JSON.stringify(toggle.payload)).toContain(
        localizedCopy("en-US", "commands.memories.lorebook_status_disabled"),
      );
      const valid = createDependencies({ takeChannelSelectValues: () => [VALID_CHANNEL] });
      await runRoute(
        valid.dependencies,
        makeInteraction("memories:v1:lore-book-channels-submit:en-US:1:nonce123", { kind: "modal" }),
      );
      expect(channels).toHaveBeenCalledWith(1, 1, [VALID_CHANNEL]);
      const missing = createDependencies({ getLorebookCollections: async () => [] });
      state.mockClear();
      await runRoute(missing.dependencies, makeInteraction("memories:v1:lore-book-toggle-enabled:en-US:1"));
      expect(state).not.toHaveBeenCalled();
    } finally {
      state.mockRestore();
      channels.mockRestore();
    }
  });

  it("edits an entry only when the submitted modal fields are complete", async () => {
    let written: Parameters<MemoriesRouteDependencies["lorebookOperations"]["editEntry"]>[0] | undefined;
    const valid = createDependencies({
      takeStringSelectValues: () => ["0"],
      takeChannelSelectValues: () => [],
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        editEntry: async (input) => {
          written = input;
          return { status: "success", title: input.title };
        },
      },
    });
    const edit = makeInteraction("memories:v1:lore-edit-submit:en-US:1770:1:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "Renamed",
        keys_nonce123: "renamed",
        content_nonce123: "New content",
      },
    });
    await runRoute(valid.dependencies, edit);
    expect(written).toMatchObject({
      entryId: 1,
      title: "Renamed",
      keys: ["renamed"],
      channelDiscIds: [],
    });

    const invalid = createDependencies({
      takeStringSelectValues: () => ["0"],
      takeChannelSelectValues: () => undefined,
    });
    const missingChannels = makeInteraction("memories:v1:lore-edit-submit:en-US:1770:1:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "Renamed",
        keys_nonce123: "renamed",
        content_nonce123: "New content",
      },
    });
    await runRoute(invalid.dependencies, missingChannels);
    expect(invalid.calls).not.toContain("op:editEntry");
  });

  it("validates activation numbers and logic at the trust boundary", async () => {
    const { dependencies, calls } = createDependencies({
      takeStringSelectValues: (_interactionId, fieldId) => (fieldId.startsWith("secondary_logic_") ? ["0"] : undefined),
    });
    const invalidNumber = makeInteraction("memories:v1:lore-activation-submit:en-US:1770:1:nonce123", {
      kind: "modal",
      fields: {
        secondary_keys_nonce123: "storm",
        scan_depth_nonce123: "0",
        trigger_chance_nonce123: "100",
        insertion_order_nonce123: "100",
      },
    });
    await runRoute(dependencies, invalidNumber);
    expect(calls).not.toContain("op:editActivation");
    expect(
      payloadText(invalidNumber).some((text) =>
        localizedProse("en-US", "commands.memories.lorebook_invalid_number_detail", {
          field: localizedCopy("en-US", "commands.memories.lorebook_scan_depth_label"),
          min: 1,
          max: 100,
        }).test(text),
      ),
    ).toBe(true);

    let written: Parameters<MemoriesRouteDependencies["lorebookOperations"]["editActivation"]>[0] | undefined;
    const valid = createDependencies({
      takeStringSelectValues: (_interactionId, fieldId) => (fieldId.startsWith("secondary_logic_") ? ["3"] : undefined),
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        editActivation: async (input) => {
          written = input;
          return { status: "success", title: "Entry 1" };
        },
      },
    });
    const activation = makeInteraction("memories:v1:lore-activation-submit:en-US:1770:1:nonce123", {
      kind: "modal",
      fields: {
        secondary_keys_nonce123: "fog, storm",
        scan_depth_nonce123: "9",
        trigger_chance_nonce123: "40",
        insertion_order_nonce123: "-5",
      },
    });
    await runRoute(valid.dependencies, activation);
    expect(written).toMatchObject({
      secondaryKeys: ["fog", "storm"],
      selectiveLogic: LOREBOOK_SELECTIVE_LOGIC.AND_ALL,
      scanDepth: 9,
      triggerChance: 40,
      insertionOrder: -5,
    });
  });

  it("acknowledges a toggle before writing and repaints stale ids as changed state", async () => {
    let acknowledged = false;
    let interaction: ReturnType<typeof makeInteraction>;
    const { dependencies } = createDependencies({
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        setFlags: async () => {
          acknowledged = interaction.deferred;
          return { status: "success" };
        },
      },
    });
    interaction = makeInteraction("memories:v1:lore-toggle-enabled:en-US:1770:1", { kind: "button" });
    await runRoute(dependencies, interaction);
    expect(acknowledged).toBe(true);
    expect(
      payloadText(interaction).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_disabled_heading")),
      ),
    ).toBe(true);

    const stale = createDependencies({}, []);
    const missing = makeInteraction("memories:v1:lore-toggle-enabled:en-US:1770:1", { kind: "button" });
    await runRoute(stale.dependencies, missing);
    expect(stale.calls.some((call) => call.startsWith("op:setFlags"))).toBe(false);
    expect(
      payloadText(missing).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_changed_state_heading")),
      ),
    ).toBe(true);
  });

  it("maps write failures and stale edits to their own receipts", async () => {
    const failedAdd = createDependencies({
      takeStringSelectValues: () => ["0"],
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        add: async () => ({ status: "failed" }),
      },
    });
    const add = makeInteraction("memories:v1:lore-add-submit:en-US:0:nonce123:1", {
      kind: "modal",
      fields: {
        title_nonce123: "Title",
        keys_nonce123: "key",
        content_nonce123: "Content",
      },
    });
    await runRoute(failedAdd.dependencies, add);
    expect(
      payloadText(add).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_write_failed_heading")),
      ),
    ).toBe(true);

    const staleEdit = createDependencies({
      takeStringSelectValues: () => ["0"],
      lorebookOperations: {
        ...createDependencies().dependencies.lorebookOperations,
        editEntry: async () => ({ status: "missing" }),
      },
    });
    const edit = makeInteraction("memories:v1:lore-edit-submit:en-US:1770:1:nonce123", {
      kind: "modal",
      fields: {
        title_nonce123: "Title",
        keys_nonce123: "key",
        content_nonce123: "Content",
      },
    });
    await runRoute(staleEdit.dependencies, edit);
    expect(
      payloadText(edit).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_changed_state_heading")),
      ),
    ).toBe(true);
  });

  it("confirms deletion after a prompt and reports removed titles", async () => {
    const { dependencies, calls } = createDependencies();
    const prompt = makeInteraction("memories:v1:lore-remove-prompt:en-US:1770:1", { kind: "button" });
    await runRoute(dependencies, prompt);
    expect(JSON.stringify(prompt.payload)).toContain("memories:v1:lore-remove-confirm:en-US:1770:1");

    calls.length = 0;
    const confirm = makeInteraction("memories:v1:lore-remove-confirm:en-US:1770:1", { kind: "button" });
    await runRoute(dependencies, confirm);
    expect(calls).toContain("op:remove");
    expect(calls).toContain("record:memories.workspace.lorebook.remove");
    expect(
      payloadText(confirm).some((text) =>
        text.includes(localizedCopy("en-US", "commands.memories.lorebook_removed_heading")),
      ),
    ).toBe(true);
  });
});

describe("lorebook import route", () => {
  function conversion(entries = [makeEntry(50)], report = emptyReport()): LorebookConversion {
    return { entries, report };
  }

  it("creates and selects an imported collection using an override, the file's name, or its filename", async () => {
    const download = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const importer = spyOn(lorebookRepository, "importNewBook");
    try {
      for (const [override, sourceName, expected] of [
        ["Renamed", "Source", "Renamed"],
        ["", "Source", "Source"],
        ["", undefined, MODAL_ATTACHMENT.filename.replace(/\.[^.]+$/u, "")],
      ] as const) {
        const { dependencies } = createDependencies({
          parseLorebookUpload: () => ({ ok: true, name: sourceName, conversion: conversion() }),
          getLorebookCollections: async () => [{ lorebook_id: 7, name: expected, enabled: true, channel_disc_ids: [] }],
        });
        const interaction = makeInteraction("memories:v1:lore-book-import-submit:en-US:nonce123", {
          kind: "modal",
          fields: { book_name_nonce123: override },
        });
        importer.mockImplementation(async () => {
          expect(interaction.deferred).toBe(true);
          return { status: "appended", bookId: 7, added: 1, skipped: 0 };
        });
        await runRoute(dependencies, interaction);
        expect(importer).toHaveBeenLastCalledWith(1, expected, expect.any(Array));
        expect(JSON.stringify(interaction.payload)).toContain("lore-select:en-US:0:0:7");
      }
      const { dependencies } = createDependencies();
      importer.mockClear();
      await runRoute(
        dependencies,
        makeInteraction("memories:v1:lore-book-import-submit:en-US:nonce123", { kind: "modal", manage: false }),
      );
      expect(importer).not.toHaveBeenCalled();
      importer.mockResolvedValue({ status: "exists" });
      const collision = makeInteraction("memories:v1:lore-book-import-submit:en-US:nonce123", { kind: "modal" });
      await runRoute(dependencies, collision);
      expect(
        payloadText(collision).some((text) =>
          text.includes(localizedCopy("en-US", "commands.memories.lorebook_import_exists_heading")),
        ),
      ).toBe(true);
    } finally {
      download.mockRestore();
      importer.mockRestore();
    }
  });

  it("appends converted entries and reports duplicates plus skipped entries", async () => {
    const downloadSpy = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const appendSpy = spyOn(lorebookRepository, "appendScopeEntries").mockResolvedValue({
      status: "appended",
      added: 1,
      skipped: 1,
    });
    try {
      const { dependencies, calls } = createDependencies({
        parseLorebookUpload: () => ({
          ok: true,
          conversion: conversion([makeEntry(50), makeEntry(51)], { ...emptyReport(), skippedEntries: 1 }),
        }),
      });
      const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:1770:nonce123", {
        kind: "modal",
      });
      await runRoute(dependencies, interaction);
      expect(appendSpy).toHaveBeenCalledWith(1, 1770, expect.any(Array), undefined, undefined);
      expect(calls).toContain("record:memories.workspace.lorebook.import");
      expect(
        payloadText(interaction).some((text) =>
          localizedProse("en-US", "commands.memories.lorebook_imported_detail", { added: 1, skipped: 2 }).test(text),
        ),
      ).toBe(true);
    } finally {
      downloadSpy.mockRestore();
      appendSpy.mockRestore();
    }
  });

  it("replaces the scope when the replace box is checked", async () => {
    const downloadSpy = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const replaceSpy = spyOn(lorebookRepository, "replaceScopeEntries").mockResolvedValue("replaced");
    try {
      const { dependencies } = createDependencies({
        takeCheckboxValues: () => ["replace"],
        parseLorebookUpload: () => ({ ok: true, conversion: conversion([makeEntry(50)]) }),
      });
      const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:0:nonce123:1", {
        kind: "modal",
      });
      await runRoute(dependencies, interaction);
      expect(replaceSpy).toHaveBeenCalledWith(1, null, expect.any(Array), undefined, "General", 1);
      expect(
        payloadText(interaction).some((text) =>
          localizedProse("en-US", "commands.memories.lorebook_import_replaced_detail", { count: 1 }).test(text),
        ),
      ).toBe(true);
    } finally {
      downloadSpy.mockRestore();
      replaceSpy.mockRestore();
    }
  });

  it("reports conversion losses for both append and replacement", async () => {
    const download = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const append = spyOn(lorebookRepository, "appendScopeEntries").mockResolvedValue({
      status: "appended",
      added: 1,
      skipped: 0,
    });
    const replace = spyOn(lorebookRepository, "replaceScopeEntries").mockResolvedValue("replaced");
    try {
      for (const replacing of [false, true]) {
        const report = { skippedEntries: 2, unsupportedKeys: 3, ignoredEntries: 4, collapsedPlacement: 5 };
        const { dependencies } = createDependencies({
          takeCheckboxValues: () => (replacing ? ["replace"] : []),
          parseLorebookUpload: () => ({ ok: true, conversion: conversion([makeEntry(50)], report) }),
        });
        const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:1770:nonce123", { kind: "modal" });
        await runRoute(dependencies, interaction);
        expect(
          payloadText(interaction).some((text) =>
            localizedProse("en-US", "commands.memories.lorebook_conversion_note", {
              skipped: 2,
              keys: 3,
              ignored: 4,
              placements: 5,
            }).test(text),
          ),
        ).toBe(true);
      }
    } finally {
      download.mockRestore();
      append.mockRestore();
      replace.mockRestore();
    }
  });

  it("refuses oversized PNG cards before downloading", async () => {
    const download = spyOn(safeDownloadModule, "safeDownload");
    try {
      const { dependencies } = createDependencies({
        takeLorebookFileUpload: () => ({
          ...MODAL_ATTACHMENT,
          filename: "card.json",
          content_type: "image/png",
          size: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024 + 1,
        }),
      });
      const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:1770:nonce123", { kind: "modal" });
      await runRoute(dependencies, interaction);
      expect(download).not.toHaveBeenCalled();
      expect(
        payloadText(interaction).some((text) =>
          text.includes(localizedCopy("en-US", "commands.memories.lorebook_import_too_large_heading")),
        ),
      ).toBe(true);
    } finally {
      download.mockRestore();
    }
  });

  it("maps limit, invalid JSON, unsupported, empty, oversized, and missing uploads to receipts", async () => {
    const downloadSpy = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const appendSpy = spyOn(lorebookRepository, "appendScopeEntries").mockResolvedValue({ status: "limit" });
    try {
      const cases: Array<{
        label: string;
        overrides: Partial<MemoriesRouteDependencies>;
        attachment?: APIAttachment;
        size?: number;
      }> = [
        {
          label: "limit",
          overrides: { parseLorebookUpload: () => ({ ok: true, conversion: conversion([makeEntry(50)]) }) },
        },
        {
          label: "invalid-json",
          overrides: { parseLorebookUpload: () => ({ ok: false, reason: "invalid_json" }) },
        },
        {
          label: "no-book",
          overrides: { parseLorebookUpload: () => ({ ok: false, reason: "no_book" }) },
        },
        {
          label: "unsupported",
          overrides: { parseLorebookUpload: () => ({ ok: false, reason: "unsupported" }) },
        },
        {
          label: "empty",
          overrides: { parseLorebookUpload: () => ({ ok: true, conversion: conversion([]) }) },
        },
        {
          label: "missing",
          overrides: { takeLorebookFileUpload: () => undefined },
        },
        {
          label: "oversized",
          overrides: {},
          size: 3 * 1024 * 1024,
        },
      ];
      const expectedKey: Record<string, string> = {
        limit: "lorebook_import_limit_heading",
        "invalid-json": "lorebook_invalid_json_heading",
        unsupported: "lorebook_import_unsupported_heading",
        "no-book": "lorebook_import_no_book_heading",
        empty: "lorebook_import_empty_heading",
        missing: "lorebook_import_failed_heading",
        oversized: "lorebook_import_too_large_heading",
      };
      for (const testCase of cases) {
        const attachment = testCase.size
          ? ({ ...MODAL_ATTACHMENT, size: testCase.size } as APIAttachment)
          : MODAL_ATTACHMENT;
        const { dependencies } = createDependencies({
          takeLorebookFileUpload: () => attachment,
          ...testCase.overrides,
        });
        const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:0:nonce123:1", {
          kind: "modal",
        });
        await runRoute(dependencies, interaction);
        const heading = localizedCopy("en-US", `commands.memories.${expectedKey[testCase.label]}`);
        expect(
          payloadText(interaction).some((text) => text.includes(heading)),
          testCase.label,
        ).toBe(true);
      }
      expect(downloadSpy).toHaveBeenCalledTimes(5);
      expect(appendSpy).toHaveBeenCalledTimes(1);
    } finally {
      downloadSpy.mockRestore();
      appendSpy.mockRestore();
    }
  });

  it("reports an invalid import write separately from a failure", async () => {
    const downloadSpy = spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({
      success: true,
      buffer: MODAL_BUFFER,
    });
    const appendSpy = spyOn(lorebookRepository, "appendScopeEntries").mockResolvedValue({ status: "invalid" });
    try {
      const { dependencies } = createDependencies({
        parseLorebookUpload: () => ({ ok: true, conversion: conversion([makeEntry(50)]) }),
      });
      const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:0:nonce123:1", {
        kind: "modal",
      });
      await runRoute(dependencies, interaction);
      expect(
        payloadText(interaction).some((text) =>
          text.includes(localizedCopy("en-US", "commands.memories.lorebook_import_invalid_heading")),
        ),
      ).toBe(true);
    } finally {
      downloadSpy.mockRestore();
      appendSpy.mockRestore();
    }
  });

  it("refuses an import from a member without write permission before reading the file", async () => {
    const downloadSpy = spyOn(safeDownloadModule, "safeDownload");
    try {
      const { dependencies, calls } = createDependencies();
      const interaction = makeInteraction("memories:v1:lore-import-submit:en-US:0:nonce123:1", {
        kind: "modal",
        manage: false,
      });
      await runRoute(dependencies, interaction);
      expect(calls.some((call) => call.startsWith("record:"))).toBe(false);
      expect(downloadSpy).not.toHaveBeenCalled();
    } finally {
      downloadSpy.mockRestore();
    }
  });
});
