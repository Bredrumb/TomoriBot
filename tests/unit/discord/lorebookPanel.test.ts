import { beforeAll, describe, expect, it } from "bun:test";
import { ButtonStyle, ComponentType } from "discord.js";
import type { LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { LOREBOOK_PLACEMENT } from "@/modules/lorebooks/db/types";
import {
  buildAddLorebookModal,
  buildEditLorebookModal,
  buildImportLorebookModal,
  buildLorebookActivationModal,
  buildLorebookCollectionModal,
  buildLorebookChannelsModal,
  parseLorebookInteger,
  parseLorebookKeys,
} from "@/modules/lorebooks/discord/panelSection";
import { buildMemoriesRouteId } from "@/utils/discord/memoriesPanelCatalog";
import { buildMemoriesPanelPayload, type MemoriesPanelRenderInput } from "@/utils/discord/ui/memoriesPanel";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { RUNTIME_LOCALES, expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";
import { assertWithinDiscordLimits } from "../../helpers/rawModalLimits";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

function makeEntry(id: number, overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return {
    entry_id: id,
    server_id: 1,
    persona_lineage_id: null,
    lorebook_name: "General",
    title: `Entry ${id}`,
    content: `The content of entry ${id} describes a place, its history, and who lives there.`,
    keys: ["manor", "estate"],
    secondary_keys: [],
    selective_logic: 0,
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

function panelInput(overrides: Partial<MemoriesPanelRenderInput> = {}): MemoriesPanelRenderInput {
  return {
    locale: "en-US",
    category: "lorebooks",
    selectedLineageId: 0,
    personas: [createPersona({ persona_id: 10, persona_lineage_id: 1770, persona_nickname: "Tomori" })],
    memories: [],
    lorebookCollections: [{ lorebook_id: 1, name: "General", enabled: true, channel_disc_ids: [] }],
    lorebookEntries: [makeEntry(1)],
    lorebookCounts: new Map<number | null, number>([[1770, 1]]),
    canManage: true,
    readStatus: "fresh",
    page: { kind: "lorebooks" },
    ...overrides,
  };
}

function collectSelects(
  value: unknown,
): Array<{ customId?: string; options?: Array<{ value?: string; label?: string; description?: string }> }> {
  if (Array.isArray(value)) return value.flatMap(collectSelects);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const self = record.type === ComponentType.StringSelect ? [record as never] : [];
  return [...self, ...Object.values(record).flatMap(collectSelects)];
}

function collectButtons(
  value: unknown,
): Array<{ customId?: string; label?: string; style?: ButtonStyle; disabled?: boolean; emoji?: { name?: string } }> {
  if (Array.isArray(value)) return value.flatMap(collectButtons);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const self = record.type === ComponentType.Button ? [record as never] : [];
  return [...self, ...Object.values(record).flatMap(collectButtons)];
}

describe("lorebook panel", () => {
  it("adds the fourth category, the scope switcher, and no persona picker at Serverwide", () => {
    const payload = buildMemoriesPanelPayload(panelInput({ lorebookEntries: [] }));
    const buttons = collectButtons(payload.components);
    const lorebooksButton = buttons.find((button) => button.customId === "memories:v1:category:en-US:lorebooks");
    expect(lorebooksButton?.style).toBe(ButtonStyle.Primary);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-scope:en-US:0")).toBe(true);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-scope:en-US:1770")).toBe(true);
    expect(collectSelects(payload.components).some((select) => select.customId?.includes("lore-persona-select"))).toBe(
      false,
    );
    expect(
      collectTextDisplays(payload.components).some((content) =>
        content.includes(localizedCopy("en-US", "commands.memories.lorebook_empty")),
      ),
    ).toBe(true);
  });

  it("groups persona choices by lineage and shows the scope's entry count", () => {
    const payload = buildMemoriesPanelPayload(
      panelInput({
        selectedLineageId: 1770,
        personas: [
          createPersona({ persona_id: 10, persona_lineage_id: 1770, persona_nickname: "Tomori" }),
          createPersona({ persona_id: 11, persona_lineage_id: 1770, persona_nickname: "Tomori Alter", is_alter: true }),
          createPersona({ persona_id: 20, persona_lineage_id: 1880, persona_nickname: "Juno" }),
        ],
        lorebookCounts: new Map<number | null, number>([
          [1770, 1],
          [1880, 3],
        ]),
      }),
    );
    const select = collectSelects(payload.components).find((candidate) =>
      candidate.customId?.includes("lore-persona-select"),
    );
    expect(select?.options?.map((option) => option.value)).toEqual(["1770", "1880"]);
    expect(select?.options?.[0]?.label).toBe("Tomori");
    expect(select?.options?.[0]?.description).toBe(
      localizedCopy("en-US", "commands.memories.lorebook_persona_count_one"),
    );
    expect(select?.options?.[1]?.description).toBe(
      localizedCopy("en-US", "commands.memories.lorebook_persona_count", { count: 3 }),
    );
  });

  it("paginates persona lineages and entries while keeping the select within Discord's option cap", () => {
    const personas = Array.from({ length: 30 }, (_, index) =>
      createPersona({
        persona_id: index + 1,
        persona_lineage_id: 2000 + index,
        persona_nickname: `Persona ${index + 1}`,
      }),
    );
    const entries = Array.from({ length: 50 }, (_, index) => makeEntry(index + 1));
    const payload = buildMemoriesPanelPayload(
      panelInput({
        selectedLineageId: 2000,
        personas,
        lorebookEntries: entries,
        lorebookCounts: new Map(personas.map((persona) => [persona.persona_lineage_id as number, 1])),
        page: { kind: "lorebooks", rangeIndex: 1 },
      }),
    );
    const selects = collectSelects(payload.components);
    const personaSelect = selects.find((select) => select.customId?.includes("lore-persona-select"));
    const entrySelect = selects.find((select) => select.customId?.includes("lore-select"));
    expect(personaSelect?.options?.length).toBe(25);
    expect(entrySelect?.options?.length).toBeLessThanOrEqual(25);
    expect(entrySelect?.options?.slice(0, 3).map((option) => option.value)).toEqual([
      "action:add-lorebook",
      "action:import-lorebook",
      "action:export-lorebook",
    ]);
    const entryValues = entrySelect?.options?.slice(3).map((option) => option.value) ?? [];
    expect(entryValues).toHaveLength(22);
    expect(entryValues[0]).toBe("23");
    expect(collectButtons(payload.components).some((button) => button.customId?.includes("lore-range"))).toBe(true);
  });

  it("selects a Serverwide collection before showing only its own entries", () => {
    const books = [
      { lorebook_id: 1, name: "Manor", enabled: true, channel_disc_ids: [] },
      { lorebook_id: 2, name: "Harbor", enabled: true, channel_disc_ids: [] },
    ];
    const entries = [makeEntry(1, { lorebook_name: "Manor" }), makeEntry(2, { lorebook_name: "Harbor" })];
    const panel = buildMemoriesPanelPayload(
      panelInput({ lorebookCollections: books, lorebookEntries: entries, page: { kind: "lorebooks", bookId: 2 } }),
    );
    const selects = collectSelects(panel.components);
    expect(selects.some((select) => select.customId?.includes("lore-book-select"))).toBe(true);
    const collectionSelect = selects.find((select) => select.customId?.includes(":lore-book-select:"));
    expect(collectionSelect?.options?.slice(0, 2).map((option) => option.value)).toEqual([
      "action:add-book",
      "action:import-book",
    ]);
    const serialized = JSON.stringify(panel.components);
    expect(serialized.indexOf(localizedCopy("en-US", "commands.memories.lorebooks_title"))).toBeLessThan(
      serialized.indexOf(":lore-book-select:"),
    );
    const entryIntro = localizedCopy("en-US", "commands.memories.lorebook_entries_description", { name: "`Harbor`" });
    expect(
      collectTextDisplays(panel.components).some((text) =>
        localizedProse("en-US", "commands.memories.lorebook_entries_description", { name: "`Harbor`" }).test(text),
      ),
    ).toBe(true);
    expect(serialized.indexOf(":lore-book-remove-prompt:")).toBeLessThan(serialized.indexOf(entryIntro));
    expect(serialized.lastIndexOf('"type":14', serialized.indexOf(entryIntro))).toBeGreaterThan(
      serialized.indexOf(":lore-book-remove-prompt:"),
    );
    expect(serialized.indexOf(entryIntro)).toBeLessThan(serialized.indexOf(":lore-select:"));
    const entrySelect = selects.find((select) => select.customId?.includes(":lore-select:"));
    expect(
      entrySelect?.options?.filter((option) => !option.value?.startsWith("action:")).map((option) => option.value),
    ).toEqual(["2"]);
    expect(entrySelect?.options?.find((option) => option.value === "action:import-lorebook")?.label).toBe(
      `+ ${localizedCopy("en-US", "commands.memories.lorebook_import_entries_option")}`,
    );
    const collectionActions = collectButtons(panel.components).filter((button) =>
      /:lore-book-(toggle-enabled|channels-open|rename-open|remove-prompt):/.test(button.customId ?? ""),
    );
    expect(collectionActions[0]?.customId).toContain(":lore-book-toggle-enabled:");
    expect(collectionActions[0]?.emoji?.name).toBe("🟢");
    expect(collectionActions[1]?.customId).toContain(":lore-book-channels-open:");
    expectSafePanelPayload(panel, "serverwide collection");
    expect(collectButtons(panel.components).some((button) => button.customId?.includes("toggle-constant"))).toBe(false);
  });

  it("fits paged Serverwide collections and maximum entry previews across locales", () => {
    expectForEveryLocale((locale) => {
      const books = Array.from({ length: 250 }, (_, index) => ({
        lorebook_id: index + 1,
        enabled: true,
        channel_disc_ids:
          index === 24
            ? Array.from({ length: 25 }, (_, channelIndex) => String(100000000000000000n + BigInt(channelIndex)))
            : [],
        name: `${index} ${"b".repeat(120)}`,
      }));
      expectSafePanelPayload(
        buildMemoriesPanelPayload(
          panelInput({
            locale,
            lorebookCollections: books,
            lorebookEntries: [
              makeEntry(1, {
                lorebook_name: books[24].name,
                title: "t".repeat(128),
                content: "x".repeat(4000),
                keys: Array.from({ length: 20 }, (_, index) => `${index}${"k".repeat(62)}`),
              }),
            ],
            page: { kind: "lorebooks", bookId: books[24].lorebook_id, bookRangeIndex: 1 },
          }),
        ),
        `collections/${locale}`,
      );
    });
  });

  it("hides add and import options from non-managers and disables every write button", () => {
    const payload = buildMemoriesPanelPayload(panelInput({ canManage: false }));
    expect(collectTextDisplays(payload.components)).toContain(
      `-# ${localizedCopy("en-US", "commands.memories.lorebook_read_only_notice")}`,
    );
    const entrySelect = collectSelects(payload.components).find((select) => select.customId?.includes("lore-select"));
    expect(entrySelect?.options?.some((option) => option.value?.startsWith("action:"))).toBe(false);
    const lorebookButtons = collectButtons(payload.components).filter((button) =>
      /lore-(edit-open|activation-open|toggle-enabled|remove-prompt|book-toggle-enabled|book-channels-open|book-rename-open|book-remove-prompt)/.test(
        button.customId ?? "",
      ),
    );
    expect(lorebookButtons.length).toBeGreaterThan(0);
    expect(lorebookButtons.every((button) => button.disabled === true)).toBe(true);
  });

  it("renders saved channel scope, activation meta, and the delete confirmation", () => {
    const entry = makeEntry(5, {
      channel_disc_ids: [],
      placement: LOREBOOK_PLACEMENT.AFTER,
      trigger_chance: 60,
      scan_depth: 9,
      insertion_order: 3,
    });
    const panel = buildMemoriesPanelPayload(
      panelInput({
        lorebookEntries: [entry],
        lorebookCollections: [
          { lorebook_id: 1, name: "General", enabled: true, channel_disc_ids: ["111111111111111111"] },
        ],
      }),
    );
    const text = collectTextDisplays(panel.components);
    expect(text.some((content) => localizedProse("en-US", "commands.memories.channel_scope_line").test(content))).toBe(
      true,
    );
    expect(
      text.some((content) =>
        localizedProse("en-US", "commands.memories.lorebook_entry_meta", {
          keys: "manor, estate",
          depth: 9,
          chance: 60,
          order: 3,
          placement: "after persona",
        }).test(content),
      ),
    ).toBe(true);

    for (const enabled of [true, false]) {
      const statePanel = buildMemoriesPanelPayload(panelInput({ lorebookEntries: [{ ...entry, enabled }] }));
      const actions = collectButtons(statePanel.components).filter((button) =>
        /:lore-(toggle-enabled|edit-open|activation-open|remove-prompt):/.test(button.customId ?? ""),
      );
      expect(actions[0]?.customId).toContain(":lore-toggle-enabled:");
      expect(actions[0]?.label).toBe(
        localizedCopy(
          "en-US",
          enabled ? "commands.memories.lorebook_status_active" : "commands.memories.lorebook_status_disabled",
        ),
      );
      expect(actions[0]?.emoji?.name).toBe(enabled ? "🟢" : "🔴");
    }

    const confirmation = buildMemoriesPanelPayload(
      panelInput({ lorebookEntries: [entry], page: { kind: "lore-remove", entryId: 5 } }),
    );
    const confirmationText = collectTextDisplays(confirmation.components);
    expect(confirmationText.some((content) => content.includes(entry.title))).toBe(true);
    const buttons = collectButtons(confirmation.components);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-remove-confirm:en-US:0:5:1")).toBe(true);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-remove-cancel:en-US:0:5:1")).toBe(true);
  });

  it("sweeps entry counts and read statuses through the Components V2 limits", () => {
    for (const locale of RUNTIME_LOCALES) {
      for (const readStatus of ["fresh", "stale", "unavailable"] as const) {
        for (const size of [0, 1, 22, 23, 45]) {
          const entries = Array.from({ length: size }, (_, index) => makeEntry(index + 1));
          expectSafePanelPayload(
            buildMemoriesPanelPayload(
              panelInput({ locale, readStatus, lorebookEntries: entries, selectedLineageId: 1770 }),
            ),
            `lorebooks/${locale}/${readStatus}/size-${size}`,
          );
        }
        const entry = makeEntry(1);
        expectSafePanelPayload(
          buildMemoriesPanelPayload(
            panelInput({
              locale,
              readStatus,
              lorebookEntries: [entry],
              page: { kind: "lore-remove", entryId: 1 },
            }),
          ),
          `lorebooks remove/${locale}/${readStatus}`,
        );
      }
    }
  });
});

describe("lorebook modals", () => {
  it("keeps add, edit, activation, and import modals within Discord limits across locales", () => {
    const entry = makeEntry(1, {
      content: "x".repeat(4000),
      keys: Array.from({ length: 20 }, (_, index) => `key-${index}`),
    });
    for (const locale of RUNTIME_LOCALES) {
      assertWithinDiscordLimits(
        buildLorebookChannelsModal(
          locale,
          { lorebook_id: 1, name: "General", enabled: true, channel_disc_ids: [] },
          "nonce123",
          [],
        ),
        `collection-channels/${locale}`,
      );
      assertWithinDiscordLimits(buildLorebookCollectionModal(locale, "nonce123"), `collection/${locale}`);
      assertWithinDiscordLimits(buildAddLorebookModal(locale, 1770, "nonce123", []), `add/${locale}`);
      assertWithinDiscordLimits(buildAddLorebookModal(locale, 0, "nonce123", null), `add-null/${locale}`);
      assertWithinDiscordLimits(buildEditLorebookModal(locale, 1770, entry, "nonce123", []), `edit/${locale}`);
      assertWithinDiscordLimits(buildLorebookActivationModal(locale, 1770, entry, "nonce123"), `activation/${locale}`);
      assertWithinDiscordLimits(buildImportLorebookModal(locale, null, "nonce123"), `import-collection/${locale}`);
      assertWithinDiscordLimits(buildImportLorebookModal(locale, 0, "nonce123"), `import/${locale}`);
    }
    const newBookModal = buildImportLorebookModal("en-US", null, "nonce123");
    expect(newBookModal.custom_id).toContain("lore-book-import-submit");
    expect(newBookModal.components.some((component) => component.component?.type === ComponentType.CheckboxGroup)).toBe(
      false,
    );
    expect(
      newBookModal.components.find((component) => component.component?.type === ComponentType.TextInput)?.component
        ?.required,
    ).toBe(false);
    for (const modal of [
      buildAddLorebookModal("en-US", 0, "nonce123", []),
      buildEditLorebookModal("en-US", 0, entry, "nonce123", []),
    ]) {
      expect(modal.components.some((component) => component.component?.type === ComponentType.ChannelSelect)).toBe(
        false,
      );
    }
    const importModal = buildImportLorebookModal("en-US", 0, "nonce123");
    expect(importModal.components).toHaveLength(2);
    expect(importModal.components[0]?.component?.type).toBe(ComponentType.FileUpload);
    expect(importModal.components[1]?.component?.type).toBe(ComponentType.CheckboxGroup);
    expect(importModal.components[1]?.component?.options?.map((option) => option.value)).toEqual(["replace"]);
  });

  it("preselects saved channels and secondary logic without exposing placement", () => {
    const entry = makeEntry(1, {
      channel_disc_ids: ["111111111111111111"],
      placement: LOREBOOK_PLACEMENT.AFTER,
    });
    const edit = buildEditLorebookModal("en-US", 1770, entry, "nonce123", entry.channel_disc_ids);
    const channels = edit.components.find((component) => component.component?.custom_id?.startsWith("channels_"));
    expect(channels?.component?.default_values).toEqual([{ id: "111111111111111111", type: "channel" }]);
    const placement = edit.components.find((component) => component.component?.custom_id?.startsWith("placement_"));
    expect(placement).toBeUndefined();
    const activation = buildLorebookActivationModal("en-US", 1770, entry, "nonce123");
    const logic = activation.components.find((component) =>
      component.component?.custom_id?.startsWith("secondary_logic_"),
    );
    expect(logic?.component?.options?.find((option) => option.value === "0")?.default).toBe(true);
  });

  it("parses keys, placements, and bounded integers at the trust boundary", () => {
    expect(parseLorebookKeys(' "manor" , estate, manor, , ')).toEqual(["manor", "estate"]);
    expect(parseLorebookKeys("a".repeat(65))).toEqual([]);
    expect(parseLorebookInteger("100", 1, 100)).toBe(100);
    expect(parseLorebookInteger("-5", -2147483648, 2147483647)).toBe(-5);
    expect(parseLorebookInteger("1.5", 1, 100)).toBeNull();
    expect(parseLorebookInteger("0", 1, 100)).toBeNull();
    expect(parseLorebookInteger("2147483648", -2147483648, 2147483647)).toBeNull();
  });

  it("keeps the longest lorebook route within Discord's custom ID limit", () => {
    const customId = buildMemoriesRouteId({
      action: "lore-activation-submit",
      locale: "en-US",
      scopeLineageId: 9007199254740991,
      entryId: 2147483647,
      nonce: "abcdefghijkl",
    });
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it("builds localized modal labels by key rather than quoting English", () => {
    for (const locale of RUNTIME_LOCALES) {
      const modal = buildAddLorebookModal(locale, 0, "nonce123", []);
      expect(modal.title).toBe(localizer(locale, "commands.memories.lorebook_add_modal_title"));
      const titleLabel = modal.components[0];
      expect(titleLabel?.label).toBe(localizer(locale, "commands.memories.lorebook_title_label"));
    }
  });
});
