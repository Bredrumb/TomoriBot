import { beforeAll, describe, expect, it } from "bun:test";
import { ButtonStyle, ComponentType } from "discord.js";
import type { LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { LOREBOOK_PLACEMENT } from "@/modules/lorebooks/db/types";
import {
  buildAddLorebookModal,
  buildEditLorebookModal,
  buildImportLorebookModal,
  buildLorebookActivationModal,
  parseLorebookInteger,
  parseLorebookKeys,
  parseLorebookPlacement,
} from "@/modules/lorebooks/discord/panelSection";
import { buildMemoriesRouteId } from "@/utils/discord/memoriesPanelCatalog";
import { buildMemoriesPanelPayload, type MemoriesPanelRenderInput } from "@/utils/discord/ui/memoriesPanel";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { RUNTIME_LOCALES, localizedCopy, localizedProse } from "../../helpers/localeCases";
import { assertWithinDiscordLimits } from "../../helpers/rawModalLimits";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

function makeEntry(id: number, overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return {
    entry_id: id,
    server_id: 1,
    persona_lineage_id: 1770,
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
): Array<{ customId?: string; label?: string; style?: ButtonStyle; disabled?: boolean }> {
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
    expect(entrySelect?.options?.slice(0, 2).map((option) => option.value)).toEqual([
      "action:add-lorebook",
      "action:import-lorebook",
    ]);
    const entryValues = entrySelect?.options?.slice(2).map((option) => option.value) ?? [];
    expect(entryValues).toHaveLength(23);
    expect(entryValues[0]).toBe("24");
    expect(collectButtons(payload.components).some((button) => button.customId?.includes("lore-range"))).toBe(true);
  });

  it("hides add and import options from non-managers and disables every write button", () => {
    const payload = buildMemoriesPanelPayload(panelInput({ canManage: false }));
    expect(collectTextDisplays(payload.components)).toContain(
      `-# ${localizedCopy("en-US", "commands.memories.lorebook_read_only_notice")}`,
    );
    const entrySelect = collectSelects(payload.components).find((select) => select.customId?.includes("lore-select"));
    expect(entrySelect?.options?.some((option) => option.value?.startsWith("action:"))).toBe(false);
    const lorebookButtons = collectButtons(payload.components).filter((button) =>
      /lore-(edit-open|activation-open|toggle-enabled|toggle-constant|remove-prompt)/.test(button.customId ?? ""),
    );
    expect(lorebookButtons.length).toBeGreaterThan(0);
    expect(lorebookButtons.every((button) => button.disabled === true)).toBe(true);
  });

  it("renders saved channel scope, activation meta, and the delete confirmation", () => {
    const entry = makeEntry(5, {
      channel_disc_ids: ["111111111111111111"],
      placement: LOREBOOK_PLACEMENT.AFTER,
      trigger_chance: 60,
      scan_depth: 9,
      insertion_order: 3,
    });
    const panel = buildMemoriesPanelPayload(panelInput({ lorebookEntries: [entry] }));
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

    const confirmation = buildMemoriesPanelPayload(
      panelInput({ lorebookEntries: [entry], page: { kind: "lore-remove", entryId: 5 } }),
    );
    const confirmationText = collectTextDisplays(confirmation.components);
    expect(confirmationText.some((content) => content.includes(entry.title))).toBe(true);
    const buttons = collectButtons(confirmation.components);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-remove-confirm:en-US:0:5")).toBe(true);
    expect(buttons.some((button) => button.customId === "memories:v1:lore-remove-cancel:en-US:0:5")).toBe(true);
  });

  it("sweeps entry counts and read statuses through the Components V2 limits", () => {
    for (const locale of RUNTIME_LOCALES) {
      for (const readStatus of ["fresh", "stale", "unavailable"] as const) {
        for (const size of [0, 1, 23, 24, 47]) {
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
      assertWithinDiscordLimits(buildAddLorebookModal(locale, 1770, "nonce123", []), `add/${locale}`);
      assertWithinDiscordLimits(buildAddLorebookModal(locale, 0, "nonce123", null), `add-null/${locale}`);
      assertWithinDiscordLimits(buildEditLorebookModal(locale, 1770, entry, "nonce123", []), `edit/${locale}`);
      assertWithinDiscordLimits(buildLorebookActivationModal(locale, 1770, entry, "nonce123"), `activation/${locale}`);
      assertWithinDiscordLimits(buildImportLorebookModal(locale, 0, "nonce123"), `import/${locale}`);
    }
    const importModal = buildImportLorebookModal("en-US", 0, "nonce123");
    expect(importModal.components).toHaveLength(2);
    expect(importModal.components[0]?.component?.type).toBe(ComponentType.FileUpload);
    expect(importModal.components[1]?.component?.type).toBe(ComponentType.CheckboxGroup);
    expect(importModal.components[1]?.component?.options?.map((option) => option.value)).toEqual(["replace"]);
  });

  it("preselects the saved channel scope, placement, and secondary logic", () => {
    const entry = makeEntry(1, {
      channel_disc_ids: ["111111111111111111"],
      placement: LOREBOOK_PLACEMENT.AFTER,
    });
    const edit = buildEditLorebookModal("en-US", 1770, entry, "nonce123", entry.channel_disc_ids);
    const channels = edit.components.find((component) => component.component?.custom_id?.startsWith("channels_"));
    expect(channels?.component?.default_values).toEqual([{ id: "111111111111111111", type: "channel" }]);
    const placement = edit.components.find((component) => component.component?.custom_id?.startsWith("placement_"));
    expect(placement?.component?.options?.find((option) => option.value === "1")?.default).toBe(true);
    const activation = buildLorebookActivationModal("en-US", 1770, entry, "nonce123");
    const logic = activation.components.find((component) =>
      component.component?.custom_id?.startsWith("secondary_logic_"),
    );
    expect(logic?.component?.options?.find((option) => option.value === "0")?.default).toBe(true);
  });

  it("parses keys, placements, and bounded integers at the trust boundary", () => {
    expect(parseLorebookKeys(' "manor" , estate, manor, , ')).toEqual(["manor", "estate"]);
    expect(parseLorebookKeys("a".repeat(65))).toEqual([]);
    expect(parseLorebookPlacement("0")).toBe(0);
    expect(parseLorebookPlacement("1")).toBe(1);
    expect(parseLorebookPlacement("2")).toBeNull();
    expect(parseLorebookPlacement(undefined)).toBeNull();
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
