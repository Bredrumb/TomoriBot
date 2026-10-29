import {
  ButtonStyle,
  ComponentType,
  escapeInlineCode,
  inlineCode,
  type ButtonComponentData,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReadStatus } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_KEYS_MAX,
  LOREBOOK_KEY_LENGTH_MAX,
  LOREBOOK_PLACEMENT,
  LOREBOOK_SELECTIVE_LOGIC,
  LOREBOOK_TITLE_MAX,
  normalizeLorebookKeys,
  type LorebookEntryRow,
  type ServerLorebook,
} from "@/modules/lorebooks/db/types";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { LOREBOOK_IMPORT_MAX_FILE_MB } from "@/modules/lorebooks/imports";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import {
  buildMemoriesRouteId,
  buildMemoriesRouteSegments,
  MEMORIES_ROUTE_NAMESPACE,
  MEMORIES_ROUTE_VERSION,
} from "@/utils/discord/memoriesPanelCatalog";
import { buildChannelScopeField } from "@/utils/discord/ui/channelScopeField";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildChannelScopeLine,
  buildOptionalThumbnailSection,
  buildPaginationRow,
  buildStateControlRow,
  withLinePrefix,
} from "@/utils/discord/ui/panel";
import { measureFormattedPanelTextLength, renderPanelContentBlock } from "@/utils/discord/ui/panelProse";
import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer } from "@/utils/text/localizer";
import { groupPersonasByLineage, personaRepresentativeForLineage } from "@/utils/persona/lineage";

/** Three fixed add, import, and export options leave 22 entry slots under Discord's 25-option select cap. */
export const LOREBOOK_ENTRY_PAGE_SIZE = 22;
export const LOREBOOK_COLLECTION_PAGE_SIZE = 23;

export type LorebookPanelPage =
  | {
      kind: "lorebooks";
      bookId?: number;
      bookRangeIndex?: number;
      selectedEntryId?: number;
      rangeIndex?: number;
      personaRangeIndex?: number;
    }
  | { kind: "lore-book-remove"; bookId: number }
  | { kind: "lore-remove"; entryId: number; bookId?: number };

export interface LorebookPanelRenderInput {
  locale: string;
  scopeLineageId: number;
  personas: TomoriState[];
  entries: readonly LorebookEntryRow[];
  books?: readonly ServerLorebook[];
  countsByLineage: ReadonlyMap<number | null, number> | null;
  canManage: boolean;
  channelScopeAvailable?: boolean;
  readStatus: PanelReadStatus;
  page: LorebookPanelPage;
  availableTextLength: number;
  selectedPersonaAvatarUrl?: string | null;
}

type LorebookModalField =
  | "book_name"
  | "title"
  | "keys"
  | "content"
  | "channels"
  | "secondary_keys"
  | "secondary_logic"
  | "scan_depth"
  | "trigger_chance"
  | "insertion_order"
  | "file"
  | "replace";

export function buildLorebookModalFieldId(field: LorebookModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function parseLorebookKeys(rawKeys: string): string[] {
  return normalizeLorebookKeys(rawKeys.split(","));
}

export function parseLorebookSelectiveLogic(raw: string | undefined): 0 | 1 | 2 | 3 | null {
  if (raw === "0") return LOREBOOK_SELECTIVE_LOGIC.AND_ANY;
  if (raw === "1") return LOREBOOK_SELECTIVE_LOGIC.NOT_ALL;
  if (raw === "2") return LOREBOOK_SELECTIVE_LOGIC.NOT_ANY;
  if (raw === "3") return LOREBOOK_SELECTIVE_LOGIC.AND_ALL;
  return null;
}

/** Returns null unless the whole submitted text is a safe integer inside the inclusive range. */
export function parseLorebookInteger(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function placementLabel(locale: string, placement: 0 | 1): string {
  return localizer(
    locale,
    placement === LOREBOOK_PLACEMENT.AFTER
      ? "commands.memories.lorebook_placement_after"
      : "commands.memories.lorebook_placement_before",
  );
}

function statusLabel(locale: string, entry: LorebookEntryRow): string {
  return localizer(
    locale,
    entry.enabled ? "commands.memories.lorebook_status_active" : "commands.memories.lorebook_status_disabled",
  );
}

function entryOption(locale: string, entry: LorebookEntryRow): SelectMenuComponentOptionData {
  const description = entry.constant
    ? localizer(locale, "commands.memories.lorebook_option_constant", { status: statusLabel(locale, entry) })
    : localizer(locale, "commands.memories.lorebook_option_keyword", {
        status: statusLabel(locale, entry),
        keys: entry.keys.join(", "),
      });
  return {
    label: safeSelectOptionText(entry.title, 100),
    value: String(entry.entry_id),
    description: safeSelectOptionText(description, 100),
  };
}

function personaCountLabel(locale: string, count: number): string {
  if (count === 0) return localizer(locale, "commands.memories.lorebook_persona_empty");
  return localizer(
    locale,
    count === 1 ? "commands.memories.lorebook_persona_count_one" : "commands.memories.lorebook_persona_count",
    { count },
  );
}

function lorebookHeading(locale: string, avatarUrl?: string | null): ComponentInContainerData {
  const heading = {
    type: ComponentType.TextDisplay,
    content: `### ${localizer(locale, "commands.memories.lorebooks_title")}\n${localizer(
      locale,
      "commands.memories.lorebooks_description",
    )}`,
  } as const;
  return buildOptionalThumbnailSection(heading, avatarUrl);
}

export function buildLorebookPanelSection(input: LorebookPanelRenderInput): ComponentInContainerData[] {
  const { locale, scopeLineageId, personas, countsByLineage, canManage, readStatus, page } = input;
  const books = input.books ?? [];
  const requestedBook = books.find((book) => book.lorebook_id === page.bookId);
  const entryBook =
    page.kind === "lorebooks"
      ? input.entries.find((entry) => entry.entry_id === page.selectedEntryId)?.lorebook_name
      : undefined;
  const selectedBook = requestedBook ?? books.find((book) => book.name === entryBook) ?? books[0];
  const bookId = scopeLineageId === 0 ? selectedBook?.lorebook_id : undefined;
  const entries =
    scopeLineageId === 0 && selectedBook
      ? input.entries.filter((entry) => entry.lorebook_name === selectedBook.name)
      : input.entries;
  const writesDisabled = readStatus !== "fresh";
  const personaScope = scopeLineageId !== 0;
  const lineageEntries = [...groupPersonasByLineage(personas).entries()];
  const components: ComponentInContainerData[] = [];

  components.push(
    buildStateControlRow(
      [
        {
          value: "serverwide" as const,
          label: localizer(locale, "commands.memories.lorebook_scope_serverwide"),
          customId: buildMemoriesRouteId({ action: "lore-scope", locale, scopeLineageId: 0 }),
        },
        {
          value: "persona" as const,
          label: localizer(locale, "commands.memories.lorebook_scope_persona"),
          customId: buildMemoriesRouteId({
            action: "lore-scope",
            locale,
            scopeLineageId: lineageEntries[0]?.[0] ?? 0,
          }),
          available: lineageEntries.length > 0,
        },
      ],
      personaScope ? "persona" : "serverwide",
      writesDisabled,
    ),
  );

  if (personaScope) {
    const selectedLineagePosition = lineageEntries.findIndex(([lineage]) => lineage === scopeLineageId);
    const requestedRangeIndex = page.kind === "lorebooks" ? page.personaRangeIndex : undefined;
    const personaRangeIndex =
      requestedRangeIndex ??
      (selectedLineagePosition >= 0 ? Math.floor(selectedLineagePosition / DISCORD_SELECT_OPTIONS_MAX) : 0);
    const personaRangeSelection = resolveRangeSelection(lineageEntries, personaRangeIndex, DISCORD_SELECT_OPTIONS_MAX);
    const personaOptions: SelectMenuComponentOptionData[] = personaRangeSelection.visibleItems.map(
      ([lineage, sharing]) => {
        const representative = personaRepresentativeForLineage(sharing, lineage);
        const count = lineage === scopeLineageId ? entries.length : (countsByLineage?.get(lineage) ?? 0);
        return {
          label: safeSelectOptionText(
            representative?.persona_nickname || localizer(locale, "commands.memories.persona_default_name"),
            100,
          ),
          value: String(lineage),
          description: safeSelectOptionText(personaCountLabel(locale, count), 100),
          default: lineage === scopeLineageId,
        };
      },
    );

    if (personaOptions.length > 0) {
      components.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: buildMemoriesRouteId({ action: "lore-persona-select", locale, scopeLineageId }),
            placeholder: localizer(locale, "commands.memories.lorebook_persona_placeholder"),
            options: personaOptions,
            disabled: writesDisabled,
          },
        ],
      });
    }

    const personaPaginationRow = buildPaginationRow({
      locale,
      rangeIndex: personaRangeSelection.rangeIndex,
      rangeCount: personaRangeSelection.rangeCount,
      namespace: MEMORIES_ROUTE_NAMESPACE,
      version: MEMORIES_ROUTE_VERSION,
      disabled: writesDisabled,
      buildSegments: {
        page: (rangeIndex) =>
          buildMemoriesRouteSegments({
            action: "lore-persona-page",
            locale,
            scopeLineageId,
            bookId,
            rangeIndex,
          }),
      },
    });
    if (personaPaginationRow) components.push(personaPaginationRow);
  }

  components.push(lorebookHeading(locale, personaScope ? input.selectedPersonaAvatarUrl : null));

  if (!personaScope) {
    const bookRange = resolveRangeSelection(
      books,
      page.kind === "lorebooks"
        ? (page.bookRangeIndex ??
            Math.max(0, Math.floor((selectedBook ? books.indexOf(selectedBook) : 0) / LOREBOOK_COLLECTION_PAGE_SIZE)))
        : 0,
      LOREBOOK_COLLECTION_PAGE_SIZE,
    );
    const options: SelectMenuComponentOptionData[] = bookRange.visibleItems.map((book) => ({
      label: safeSelectOptionText(book.name, 100),
      value: String(book.lorebook_id),
      default: book.lorebook_id === bookId,
    }));
    if (canManage)
      options.unshift(
        {
          label: `+ ${localizer(locale, "commands.memories.lorebook_collection_add")}`,
          value: "action:add-book",
        },
        {
          label: `+ ${localizer(locale, "commands.memories.lorebook_import_option")}`,
          value: "action:import-book",
        },
      );
    if (options.length)
      components.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: buildMemoriesRouteId({ action: "lore-book-select", locale }),
            placeholder: localizer(locale, "commands.memories.lorebook_collection_placeholder"),
            options,
            disabled: writesDisabled,
          },
        ],
      });
    const pagination = buildPaginationRow({
      locale,
      rangeIndex: bookRange.rangeIndex,
      rangeCount: bookRange.rangeCount,
      namespace: MEMORIES_ROUTE_NAMESPACE,
      version: MEMORIES_ROUTE_VERSION,
      disabled: writesDisabled,
      buildSegments: {
        page: (rangeIndex) => buildMemoriesRouteSegments({ action: "lore-book-select", locale, rangeIndex }),
      },
    });
    if (pagination) components.push(pagination);
  }

  if (entries.some((entry) => (entry.legacy_channel_tags?.length ?? 0) > 0)) {
    components.push({
      type: ComponentType.TextDisplay,
      content: withLinePrefix(
        "-# ",
        statusNote("warning", localizer(locale, "commands.memories.channel_scope_legacy_notice")),
      ),
    });
  }

  if (!canManage) {
    components.push({
      type: ComponentType.TextDisplay,
      content: withLinePrefix("-# ", localizer(locale, "commands.memories.lorebook_read_only_notice")),
    });
  }

  if (!personaScope && !selectedBook) return components;

  if (!personaScope && selectedBook) {
    if (page.kind === "lore-book-remove") {
      components.push(
        {
          type: ComponentType.TextDisplay,
          content: localizer(locale, "commands.memories.lorebook_collection_remove_description", {
            name: selectedBook.name,
          }),
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Danger,
              customId: buildMemoriesRouteId({
                action: "lore-book-remove-confirm",
                locale,
                bookId: selectedBook.lorebook_id,
              }),
              label: localizer(locale, "commands.memories.remove_confirm"),
              disabled: writesDisabled || !canManage,
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: buildMemoriesRouteId({
                action: "lore-book-remove-cancel",
                locale,
                bookId: selectedBook.lorebook_id,
              }),
              label: localizer(locale, "commands.memories.cancel"),
            },
          ],
        },
      );
      return components;
    }
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildMemoriesRouteId({
            action: "lore-book-toggle-enabled",
            locale,
            bookId: selectedBook.lorebook_id,
          }),
          label: localizer(
            locale,
            selectedBook.enabled
              ? "commands.memories.lorebook_status_active"
              : "commands.memories.lorebook_status_disabled",
          ),
          emoji: { name: selectedBook.enabled ? "🟢" : "🔴" },
          disabled: writesDisabled || !canManage,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildMemoriesRouteId({
            action: "lore-book-channels-open",
            locale,
            bookId: selectedBook.lorebook_id,
          }),
          label: localizer(locale, "commands.memories.lorebook_collection_channels"),
          disabled: writesDisabled || !canManage || input.channelScopeAvailable === false,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildMemoriesRouteId({ action: "lore-book-rename-open", locale, bookId: selectedBook.lorebook_id }),
          label: localizer(locale, "commands.memories.lorebook_collection_rename"),
          disabled: writesDisabled || !canManage,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          customId: buildMemoriesRouteId({
            action: "lore-book-remove-prompt",
            locale,
            bookId: selectedBook.lorebook_id,
          }),
          label: localizer(locale, "commands.memories.lorebook_collection_remove"),
          disabled: writesDisabled || !canManage,
        },
      ],
    });
    const collectionScopeLine = buildChannelScopeLine(locale, {
      channel_disc_ids: selectedBook.channel_disc_ids,
      channel_scope_pending: false,
    });
    components.push({
      type: ComponentType.TextDisplay,
      content: collectionScopeLine
        ? collectionScopeLine.replace(/^-# /gm, "> ")
        : `> ${localizer(locale, "commands.memories.lorebook_collection_all_channels")}`,
    });
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
  }

  if (page.kind === "lore-remove") {
    const target = entries.find((entry) => entry.entry_id === page.entryId);
    if (target) {
      components.push(
        {
          type: ComponentType.TextDisplay,
          content: `### ${localizer(locale, "commands.memories.lorebook_remove_title")}\n${localizer(
            locale,
            "commands.memories.lorebook_remove_description",
            { title: target.title },
          )}`,
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Danger,
              customId: buildMemoriesRouteId({
                action: "lore-remove-confirm",
                locale,
                scopeLineageId,
                bookId,
                entryId: target.entry_id,
              }),
              label: localizer(locale, "commands.memories.remove_confirm"),
              disabled: writesDisabled,
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: buildMemoriesRouteId({
                action: "lore-remove-cancel",
                locale,
                scopeLineageId,
                bookId,
                entryId: target.entry_id,
              }),
              label: localizer(locale, "commands.memories.cancel"),
            },
          ],
        },
      );
      return components;
    }
  }

  const requestedEntry =
    page.kind === "lorebooks" && page.selectedEntryId !== undefined
      ? entries.find((entry) => entry.entry_id === page.selectedEntryId)
      : undefined;
  const selectedPosition = requestedEntry ? entries.indexOf(requestedEntry) : -1;
  const requestedRangeIndex = page.kind === "lorebooks" ? page.rangeIndex : undefined;
  const rangeIndex =
    requestedRangeIndex ?? (selectedPosition >= 0 ? Math.floor(selectedPosition / LOREBOOK_ENTRY_PAGE_SIZE) : 0);
  const range = resolveRangeSelection(entries, rangeIndex, LOREBOOK_ENTRY_PAGE_SIZE);
  const selectedEntry = requestedEntry ?? range.visibleItems[0];

  const selectOptions: SelectMenuComponentOptionData[] = [];
  if (canManage) {
    selectOptions.push({
      label: safeSelectOptionText(`+ ${localizer(locale, "commands.memories.lorebook_add_option")}`, 100),
      value: "action:add-lorebook",
      description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_add_option_description"), 100),
    });
    selectOptions.push({
      label: safeSelectOptionText(
        `+ ${localizer(
          locale,
          personaScope
            ? "commands.memories.lorebook_import_option"
            : "commands.memories.lorebook_import_entries_option",
        )}`,
        100,
      ),
      value: "action:import-lorebook",
      description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_import_option_description"), 100),
    });
  }
  if (canManage) {
    selectOptions.push({
      label: safeSelectOptionText(`+ ${localizer(locale, "commands.memories.lorebook_export_option")}`, 100),
      value: "action:export-lorebook",
      description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_export_option_description"), 100),
    });
  }
  selectOptions.push(
    ...range.visibleItems.map((entry) => ({
      ...entryOption(locale, entry),
      default: entry.entry_id === selectedEntry?.entry_id,
    })),
  );

  if (selectOptions.length > 0) {
    if (!personaScope && selectedBook) {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(
          locale,
          canManage
            ? "commands.memories.lorebook_entries_description"
            : "commands.memories.lorebook_entries_read_only_description",
          {
            name: inlineCode(escapeInlineCode(selectedBook.name)),
          },
        ),
      });
    }
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildMemoriesRouteId({
            action: "lore-select",
            locale,
            scopeLineageId,
            bookId,
            rangeIndex: range.rangeIndex,
          }),
          placeholder: localizer(locale, "commands.memories.lorebook_select_placeholder"),
          options: selectOptions,
          disabled: writesDisabled,
        },
      ],
    });
  }

  const entryPaginationRow = buildPaginationRow({
    locale,
    rangeIndex: range.rangeIndex,
    rangeCount: range.rangeCount,
    namespace: MEMORIES_ROUTE_NAMESPACE,
    version: MEMORIES_ROUTE_VERSION,
    disabled: writesDisabled,
    buildSegments: {
      page: (targetRangeIndex) =>
        buildMemoriesRouteSegments({
          action: "lore-range",
          locale,
          scopeLineageId,
          bookId,
          rangeIndex: targetRangeIndex,
        }),
    },
  });
  if (entryPaginationRow) components.push(entryPaginationRow);

  if (!selectedEntry) {
    components.push({
      type: ComponentType.TextDisplay,
      content: `> ${localizer(locale, "commands.memories.lorebook_empty")}`,
    });
    return components;
  }

  const meta = selectedEntry.constant
    ? localizer(locale, "commands.memories.lorebook_entry_meta_constant", {
        depth: selectedEntry.scan_depth,
        chance: selectedEntry.trigger_chance,
        order: selectedEntry.insertion_order,
        placement: placementLabel(locale, selectedEntry.placement),
      })
    : localizer(locale, "commands.memories.lorebook_entry_meta", {
        keys: selectedEntry.keys.join(", "),
        depth: selectedEntry.scan_depth,
        chance: selectedEntry.trigger_chance,
        order: selectedEntry.insertion_order,
        placement: placementLabel(locale, selectedEntry.placement),
      });
  const metaLine = withLinePrefix("> ", meta);
  const scopeLine = personaScope
    ? buildChannelScopeLine(locale, {
        channel_disc_ids: selectedEntry.channel_disc_ids,
        channel_scope_pending: (selectedEntry.legacy_channel_tags?.length ?? 0) > 0,
      })?.replace(/^-# /gm, "> ")
    : null;
  const fixedTextLength =
    measureFormattedPanelTextLength(components) +
    measureFormattedPanelTextLength({
      type: ComponentType.TextDisplay,
      content: scopeLine ? `${metaLine}\n${scopeLine}` : metaLine,
    });
  const availableBudget = Math.max(0, input.availableTextLength - fixedTextLength);

  components.push({
    type: ComponentType.TextDisplay,
    content: renderPanelContentBlock(locale, selectedEntry.content, availableBudget),
  });
  components.push({ type: ComponentType.TextDisplay, content: metaLine });
  if (scopeLine) components.push({ type: ComponentType.TextDisplay, content: scopeLine });

  const actions: ButtonComponentData[] = [
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildMemoriesRouteId({
        action: "lore-toggle-enabled",
        locale,
        scopeLineageId,
        bookId,
        entryId: selectedEntry.entry_id,
      }),
      label: statusLabel(locale, selectedEntry),
      emoji: { name: selectedEntry.enabled ? "🟢" : "🔴" },
      disabled: writesDisabled || !canManage,
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildMemoriesRouteId({
        action: "lore-edit-open",
        locale,
        scopeLineageId,
        bookId,
        entryId: selectedEntry.entry_id,
      }),
      label: localizer(locale, "commands.memories.lorebook_edit_button"),
      disabled: writesDisabled || !canManage,
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildMemoriesRouteId({
        action: "lore-activation-open",
        locale,
        scopeLineageId,
        bookId,
        entryId: selectedEntry.entry_id,
      }),
      label: localizer(locale, "commands.memories.lorebook_activation_button"),
      disabled: writesDisabled || !canManage,
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      customId: buildMemoriesRouteId({
        action: "lore-remove-prompt",
        locale,
        scopeLineageId,
        bookId,
        entryId: selectedEntry.entry_id,
      }),
      label: localizer(locale, "commands.memories.lorebook_remove_button"),
      disabled: writesDisabled || !canManage,
    },
  ];
  components.push({ type: ComponentType.ActionRow, components: actions });

  return components;
}

export function buildAddLorebookModal(
  locale: string,
  scopeLineageId: number,
  nonce: string,
  channelScope: readonly string[] | null,
  bookId?: number,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId({ action: "lore-add-submit", locale, scopeLineageId, nonce, bookId }),
    title: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_add_modal_title"), 45),
    components: [
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_title_label"), 45),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("title", nonce),
          style: 1,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_title_placeholder"), 100),
          max_length: LOREBOOK_TITLE_MAX,
          required: true,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_description"), 100),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("keys", nonce),
          style: 1,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_placeholder"), 100),
          max_length: LOREBOOK_KEYS_MAX * (LOREBOOK_KEY_LENGTH_MAX + 2),
          required: false,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_content_label"), 45),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("content", nonce),
          style: 2,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_content_placeholder"), 100),
          max_length: LOREBOOK_CONTENT_MAX,
          required: true,
        },
      },
      ...buildChannelScopeField(
        locale,
        buildLorebookModalFieldId("channels", nonce),
        "commands.memories.lorebook_channels_label",
        "commands.memories.lorebook_channels_description",
        scopeLineageId === 0 ? null : channelScope,
      ),
    ],
  };
}

export function buildEditLorebookModal(
  locale: string,
  scopeLineageId: number,
  entry: LorebookEntryRow,
  nonce: string,
  channelScope: readonly string[] | null,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId({
      action: "lore-edit-submit",
      locale,
      scopeLineageId,
      entryId: entry.entry_id,
      nonce,
    }),
    title: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_edit_modal_title"), 45),
    components: [
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_title_label"), 45),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("title", nonce),
          style: 1,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_title_placeholder"), 100),
          value: entry.title,
          max_length: LOREBOOK_TITLE_MAX,
          required: true,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_description"), 100),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("keys", nonce),
          style: 1,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_keys_placeholder"), 100),
          value: entry.constant ? "" : entry.keys.join(", "),
          max_length: LOREBOOK_KEYS_MAX * (LOREBOOK_KEY_LENGTH_MAX + 2),
          required: false,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_content_label"), 45),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("content", nonce),
          style: 2,
          placeholder: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_content_placeholder"), 100),
          value: entry.content,
          max_length: LOREBOOK_CONTENT_MAX,
          required: true,
        },
      },
      ...buildChannelScopeField(
        locale,
        buildLorebookModalFieldId("channels", nonce),
        "commands.memories.lorebook_channels_label",
        "commands.memories.lorebook_channels_description",
        scopeLineageId === 0 ? null : channelScope,
      ),
    ],
  };
}

export function buildLorebookActivationModal(
  locale: string,
  scopeLineageId: number,
  entry: LorebookEntryRow,
  nonce: string,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId({
      action: "lore-activation-submit",
      locale,
      scopeLineageId,
      entryId: entry.entry_id,
      nonce,
    }),
    title: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_activation_modal_title"), 45),
    components: [
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_secondary_keys_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.memories.lorebook_secondary_keys_description"),
          100,
        ),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("secondary_keys", nonce),
          style: 1,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.memories.lorebook_secondary_keys_placeholder"),
            100,
          ),
          value: entry.secondary_keys.join(", "),
          max_length: LOREBOOK_KEYS_MAX * (LOREBOOK_KEY_LENGTH_MAX + 2),
          required: false,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_secondary_logic_label"), 45),
        component: {
          type: ComponentType.StringSelect,
          custom_id: buildLorebookModalFieldId("secondary_logic", nonce),
          options: [
            {
              label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_logic_any"), 100),
              value: "0",
              default: entry.selective_logic === LOREBOOK_SELECTIVE_LOGIC.AND_ANY,
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_logic_not_all"), 100),
              value: "1",
              default: entry.selective_logic === LOREBOOK_SELECTIVE_LOGIC.NOT_ALL,
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_logic_none"), 100),
              value: "2",
              default: entry.selective_logic === LOREBOOK_SELECTIVE_LOGIC.NOT_ANY,
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_logic_all"), 100),
              value: "3",
              default: entry.selective_logic === LOREBOOK_SELECTIVE_LOGIC.AND_ALL,
            },
          ],
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_scan_depth_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_scan_depth_description"), 100),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("scan_depth", nonce),
          style: 1,
          value: String(entry.scan_depth),
          max_length: 3,
          required: true,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_trigger_chance_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.memories.lorebook_trigger_chance_description"),
          100,
        ),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("trigger_chance", nonce),
          style: 1,
          value: String(entry.trigger_chance),
          max_length: 3,
          required: true,
        },
      },
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_insertion_order_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.memories.lorebook_insertion_order_description"),
          100,
        ),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("insertion_order", nonce),
          style: 1,
          value: String(entry.insertion_order),
          max_length: 11,
          required: true,
        },
      },
    ],
  };
}

export function buildImportLorebookModal(
  locale: string,
  scopeLineageId: number | null,
  nonce: string,
  bookId?: number,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId(
      scopeLineageId === null
        ? { action: "lore-book-import-submit", locale, nonce }
        : { action: "lore-import-submit", locale, scopeLineageId, nonce, bookId },
    ),
    title: safeSelectOptionText(
      localizer(
        locale,
        scopeLineageId === 0
          ? "commands.memories.lorebook_import_entries_option"
          : "commands.memories.lorebook_import_modal_title",
      ),
      45,
    ),
    components: [
      {
        type: ComponentType.Label,
        label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_import_file_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.memories.lorebook_import_file_description", {
            max: LOREBOOK_IMPORT_MAX_FILE_MB,
            cardMax: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB,
            charxMax: IMPORT_LIMITS.MAX_CHARX_IMPORT_SIZE_MB,
          }),
          100,
        ),
        component: {
          type: ComponentType.FileUpload,
          custom_id: buildLorebookModalFieldId("file", nonce),
          min_values: 1,
          max_values: 1,
          required: true,
        },
      },
      ...(scopeLineageId === null
        ? [
            {
              type: ComponentType.Label,
              label: localizer(locale, "commands.memories.lorebook_collection_name"),
              description: localizer(locale, "commands.memories.lorebook_import_name_description"),
              component: {
                type: ComponentType.TextInput,
                custom_id: buildLorebookModalFieldId("book_name", nonce),
                style: 1,
                required: false,
                max_length: LOREBOOK_TITLE_MAX,
              },
            },
          ]
        : [
            {
              type: ComponentType.Label,
              label: safeSelectOptionText(localizer(locale, "commands.memories.lorebook_import_replace_label"), 45),
              description: safeSelectOptionText(
                localizer(locale, "commands.memories.lorebook_import_replace_description"),
                100,
              ),
              component: {
                type: ComponentType.CheckboxGroup,
                custom_id: buildLorebookModalFieldId("replace", nonce),
                options: [
                  {
                    label: safeSelectOptionText(
                      localizer(locale, "commands.memories.lorebook_import_replace_label"),
                      100,
                    ),
                    value: "replace",
                  },
                ],
                min_values: 0,
                max_values: 1,
                required: false,
              },
            },
          ]),
    ],
  };
}

export function buildLorebookCollectionModal(
  locale: string,
  nonce: string,
  book?: ServerLorebook,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId(
      book
        ? { action: "lore-book-rename-submit", locale, nonce, bookId: book.lorebook_id }
        : { action: "lore-book-create-submit", locale, nonce },
    ),
    title: localizer(
      locale,
      book ? "commands.memories.lorebook_collection_rename" : "commands.memories.lorebook_collection_add",
    ),
    components: [
      {
        type: ComponentType.Label,
        label: localizer(locale, "commands.memories.lorebook_collection_name"),
        component: {
          type: ComponentType.TextInput,
          custom_id: buildLorebookModalFieldId("book_name", nonce),
          style: 1,
          required: true,
          max_length: 128,
          ...(book ? { value: book.name } : {}),
        },
      },
    ],
  };
}

export function buildLorebookChannelsModal(
  locale: string,
  book: ServerLorebook,
  nonce: string,
  channels: readonly string[],
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildMemoriesRouteId({ action: "lore-book-channels-submit", locale, bookId: book.lorebook_id, nonce }),
    title: localizer(locale, "commands.memories.lorebook_collection_channels_title"),
    components: buildChannelScopeField(
      locale,
      buildLorebookModalFieldId("channels", nonce),
      "commands.memories.lorebook_channels_label",
      "commands.memories.lorebook_collection_channels_description",
      channels,
    ),
  };
}
