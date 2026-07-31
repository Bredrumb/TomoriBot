import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import type { UserRow, ErrorContext, StPresetNodeRow, StPresetRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";

const MODAL_CUSTOM_ID = "stpreset_node_toggle_modal";

/** Maximum checkbox options per group (Discord limit: 10) */
const MAX_OPTIONS_PER_GROUP = 10;

/** Maximum checkbox groups per modal (Discord limit: 5 action rows) */
const MAX_GROUPS_PER_MODAL = 5;

/** Maximum toggleable nodes per modal page (5 groups × 10 options) */
const NODES_PER_PAGE = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

/** Timeout for page-selection button interaction (5 minutes) */
const PAGE_SELECT_TIMEOUT_MS = 300_000;

/** Maximum characters for a checkbox option description (Discord limit) */
const DESCRIPTION_MAX_LENGTH = 100;

/**
 * Strip SillyTavern macros from node content to produce a human-readable
 * description preview. Removes comment blocks, {{trim}}, {{setvar::...}},
 * {{addvar::...}}, and {{getvar::...}} wrappers; but for setvar/addvar nodes,
 * extracts the value portion (e.g., `{{setvar::tense::past tense}}` → `past tense`).
 *
 * @param content - Raw node content with ST macros
 * @returns Cleaned text truncated to DESCRIPTION_MAX_LENGTH, or undefined if empty
 */
function buildNodeDescription(content: string): string | undefined {
  let cleaned = content
    .replace(/\{\{\/\/[^}]*\}\}/g, "")
    .replace(/\{\{trim\}\}/g, "")
    .replace(/\{\{(?:setvar|addvar)::[^:}]+::([^}]*)\}\}/g, "$1")
    .replace(/\{\{getvar::([^}]*)\}\}/g, "[$1]")
    .replace(/\{\{(\w+)\}\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return undefined;

  // Truncate to Discord's limit
  if (cleaned.length > DESCRIPTION_MAX_LENGTH) {
    cleaned = `${cleaned.slice(0, DESCRIPTION_MAX_LENGTH - 3)}...`;
  }

  return cleaned;
}

/**
/**
 * Build a description for a comment-only node.
 * Extracts the text inside all `{{// ... }}` blocks so the author's
 * intent (e.g. `{{// Do not use without permission}}`) is still visible
 * in the toggle UI.
 *
 * @param content - Raw node content (expected to contain only comment macros)
 * @returns Extracted comment text truncated to DESCRIPTION_MAX_LENGTH, or undefined if empty
 */
function buildCommentNodeDescription(content: string): string | undefined {
  const commentText = [...content.matchAll(/\{\{\/\/([^}]*)\}\}/g)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0)
    .join(" ");

  if (commentText.length === 0) return undefined;

  if (commentText.length > DESCRIPTION_MAX_LENGTH) {
    return `${commentText.slice(0, DESCRIPTION_MAX_LENGTH - 3)}...`;
  }

  return commentText;
}

/**
 * Chunks the given nodes into groups of MAX_OPTIONS_PER_GROUP and
 * creates up to MAX_GROUPS_PER_MODAL checkbox group components.
 *
 * Comment-only nodes (`is_comment: true`) are shown with a localized
 * description indicating they are never injected into the prompt.
 *
 *                     (used to compute human-readable group labels)
 * @param locale - User's preferred locale for comment node descriptions
 */
function buildCheckboxGroups(pageNodes: StPresetNodeRow[], pageOffset: number): ModalCheckboxGroupField[] {
  const groups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < pageNodes.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = pageNodes.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);

    const options: CheckboxGroupOption[] = chunk.map((node, chunkIdx) => {
      const rawName = node.name.trim();
      // Discord requires 1-100 chars; fall back to positional label for blank names
      const nodeNumber = pageOffset + i + chunkIdx + 1;
      const label =
        rawName.length === 0 ? `Node ${nodeNumber}` : rawName.length > 100 ? `${rawName.slice(0, 97)}...` : rawName;
      return {
        label,
        value: node.identifier,
        description: node.is_comment ? buildCommentNodeDescription(node.content) : buildNodeDescription(node.content),
        default: node.is_enabled,
      };
    });

    // Build a dynamic label like "Nodes 1-10" or "Nodes 51-60"
    // (pageOffset converts page-relative indices to overall node numbers)
    const rangeStart = pageOffset + i + 1;
    const rangeEnd = pageOffset + i + chunk.length;
    const dynamicLabel = `Nodes ${rangeStart}–${rangeEnd}`;

    groups.push({
      kind: "checkboxGroup" as const,
      customId: `stpreset_nodes_${groupIndex}`,
      // Pass raw label: localizer returns the key itself when no match is found
      labelKey: dynamicLabel,
      descriptionKey: "commands.st-preset.node.toggle.group_description",
      minValues: 0,
      maxValues: chunk.length,
      required: false,
      options,
    });
  }

  return groups;
}

/**
 * Collect selected node identifiers from modal submission checkbox groups.
 *
 * @returns Set of selected node identifiers
 */
function collectSelectedIds(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const selectedIds = new Set<string>();
  for (let g = 0; g < groupCount; g++) {
    const groupValues = multiValues?.[`stpreset_nodes_${g}`] ?? [];
    for (const id of groupValues) {
      selectedIds.add(id);
    }
  }
  return selectedIds;
}

/**
 * Configure the /st-preset node toggle subcommand.
 * No options: node selection happens via checkbox groups in a modal.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("toggle").setDescription(localizer("en-US", "commands.st-preset.node.toggle.description"));

/**
 * Execute /st-preset node toggle.
 * Loads the active (or first available) ST preset for this server from the
 * database, then shows a modal with checkbox groups representing the
 * toggleable prompt nodes. Nodes render top-to-bottom in the preset's
 * prompt_order sequence.
 *
 * If the preset has more than 50 toggleable nodes (exceeding a single
 * modal's capacity), a page-selection embed with numbered buttons is shown
 * first, allowing the user to pick which page of nodes to view/toggle.
 *
 * On submit, changed enabled states are persisted back to the database.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    let preset = await presetRepository.loadActivePreset(tomoriState.server_id);
    if (!preset) {
      const allPresets = await presetRepository.loadPresetsForServer(tomoriState.server_id);
      preset = allPresets[0] ?? null;
    }

    if (!preset?.preset_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.node.toggle.no_preset_title",
        descriptionKey: "commands.st-preset.node.toggle.no_preset_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dbNodes = await presetRepository.loadToggleableNodes(preset.preset_id);
    if (dbNodes.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.node.toggle.no_nodes_title",
        descriptionKey: "commands.st-preset.node.toggle.no_nodes_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const totalPages = Math.ceil(dbNodes.length / NODES_PER_PAGE);

    // preset_id is guaranteed non-null by the guard above
    const presetId = preset.preset_id as number;

    if (totalPages > 1) {
      await executeMultiPageToggle(interaction, locale, preset, presetId, dbNodes, totalPages);
    } else {
      await executeSinglePageToggle(interaction, locale, preset, presetId, dbNodes);
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      personaId: null,
      errorType: "CommandExecutionError",
      metadata: { command: "st-preset node toggle" },
    };
    await log.error("Error executing /st-preset node toggle", error as Error, context);

    await interaction.followUp({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Custom ID for the "Done" button in the page-selection loop */
const DONE_BUTTON_ID = "stpreset_toggle_done";

/**
 * Build the page-selection action rows (page buttons + "Done" button).
 *
 */
function buildPageActionRows(
  totalPages: number,
  totalNodes: number,
  locale: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const maxButtons = Math.min(totalPages, 24); // Reserve 1 slot for "Done"
  const pageButtons: ButtonBuilder[] = [];

  for (let i = 1; i <= maxButtons; i++) {
    const startNode = (i - 1) * NODES_PER_PAGE + 1;
    const endNode = Math.min(i * NODES_PER_PAGE, totalNodes);
    pageButtons.push(
      new ButtonBuilder()
        .setCustomId(`stpreset_page_${i}`)
        .setLabel(`${startNode}–${endNode}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  pageButtons.push(
    new ButtonBuilder()
      .setCustomId(DONE_BUTTON_ID)
      .setLabel(localizer(locale, "commands.st-preset.node.toggle.done_button"))
      .setStyle(ButtonStyle.Secondary),
  );

  // Split buttons into action rows of 5 (Discord's per-row limit)
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < pageButtons.length; i += 5) {
    actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons.slice(i, i + 5)));
  }

  return actionRows;
}

/**
 * Handle the single-page flow: show modal directly, process results.
 *
 * @param presetId - The validated preset_id (guaranteed non-null by caller)
 */
async function executeSinglePageToggle(
  interaction: ChatInputCommandInteraction,
  locale: string,
  preset: StPresetRow,
  presetId: number,
  dbNodes: StPresetNodeRow[],
): Promise<void> {
  const checkboxGroups = buildCheckboxGroups(dbNodes, 0);

  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: preset.preset_name,
      components: checkboxGroups,
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) {
    log.info(`[ST Preset Node Toggle] Modal ${modalResult.outcome}`);
    return;
  }

  const { summary, selectedCount, totalCount } = processToggleResults(modalResult, dbNodes, checkboxGroups.length);

  if (summary.changes.length > 0) {
    await presetRepository.updateNodeEnabledStates(presetId, summary.enabledMap, preset.server_id);
  }

  const changesText =
    summary.changes.length > 0
      ? summary.changes.join("\n")
      : localizer(locale, "commands.st-preset.node.toggle.no_changes");

  await replyInfoEmbed(modalResult.interaction, locale, {
    titleKey: "commands.st-preset.node.toggle.result_title",
    descriptionKey: "commands.st-preset.node.toggle.result_description",
    descriptionVars: {
      total: totalCount.toString(),
      enabled: selectedCount.toString(),
      changes: changesText,
    },
    color: summary.changes.length > 0 ? ColorCode.SUCCESS : ColorCode.INFO,
    flags: MessageFlags.Ephemeral,
  });

  log.info(
    `[ST Preset Node Toggle] ${selectedCount}/${totalCount} nodes enabled, ${summary.changes.length} changed for preset "${preset.preset_name}"`,
  );
}

/**
 * Handle the multi-page flow: page-selection loop with "Done" button.
 * Users can pick a page, toggle nodes in a modal, and return to pick
 * another page, so no need to re-run the command.
 *
 * @param presetId - The validated preset_id (guaranteed non-null by caller)
 * @param dbNodes - All toggleable nodes (will be reloaded after each toggle)
 */
async function executeMultiPageToggle(
  interaction: ChatInputCommandInteraction,
  locale: string,
  preset: StPresetRow,
  presetId: number,
  dbNodes: StPresetNodeRow[],
  totalPages: number,
): Promise<void> {
  const pageSelectEmbed = createStandardEmbed(locale, {
    titleKey: "commands.st-preset.node.toggle.select_page_title",
    descriptionKey: "commands.st-preset.node.toggle.select_page_description",
    descriptionVars: {
      preset_name: preset.preset_name,
      total_nodes: dbNodes.length.toString(),
      total_pages: totalPages.toString(),
    },
    color: ColorCode.INFO,
  });

  const actionRows = buildPageActionRows(totalPages, dbNodes.length, locale);

  const pageSelectMessage = await interaction.reply({
    embeds: [pageSelectEmbed],
    components: actionRows,
    flags: MessageFlags.Ephemeral,
  });

  let currentNodes = dbNodes;

  while (true) {
    let buttonInteraction: ButtonInteraction;
    try {
      buttonInteraction = (await pageSelectMessage.awaitMessageComponent({
        filter: (i) =>
          i.user.id === interaction.user.id &&
          (i.customId.startsWith("stpreset_page_") || i.customId === DONE_BUTTON_ID),
        time: PAGE_SELECT_TIMEOUT_MS,
      })) as ButtonInteraction;
    } catch {
      log.info("[ST Preset Node Toggle] Page selection timed out");
      break;
    }

    if (buttonInteraction.customId === DONE_BUTTON_ID) {
      await buttonInteraction.deferUpdate();
      break;
    }

    const selectedPage = Number.parseInt(buttonInteraction.customId.replace("stpreset_page_", ""), 10);
    const startIndex = (selectedPage - 1) * NODES_PER_PAGE;
    const pageNodes = currentNodes.slice(startIndex, startIndex + NODES_PER_PAGE);

    const checkboxGroups = buildCheckboxGroups(pageNodes, startIndex);

    const modalResult = await promptWithRawModal(
      buttonInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: preset.preset_name,
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome === "submit" && modalResult.interaction) {
      const { summary, selectedCount, totalCount } = processToggleResults(
        modalResult,
        pageNodes,
        checkboxGroups.length,
      );

      if (summary.changes.length > 0) {
        await presetRepository.updateNodeEnabledStates(presetId, summary.enabledMap, preset.server_id);

        // Reload nodes from DB so the next modal shows updated defaults
        currentNodes = await presetRepository.loadToggleableNodes(presetId);
      }

      const changesText =
        summary.changes.length > 0
          ? summary.changes.join("\n")
          : localizer(locale, "commands.st-preset.node.toggle.no_changes");

      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.st-preset.node.toggle.result_title",
        descriptionKey: "commands.st-preset.node.toggle.result_description",
        descriptionVars: {
          total: totalCount.toString(),
          enabled: selectedCount.toString(),
          changes: changesText,
        },
        color: summary.changes.length > 0 ? ColorCode.SUCCESS : ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });

      log.info(
        `[ST Preset Node Toggle] ${selectedCount}/${totalCount} nodes enabled, ${summary.changes.length} changed for preset "${preset.preset_name}"`,
      );
    } else {
      log.info(`[ST Preset Node Toggle] Modal ${modalResult.outcome}, returning to page selection`);
    }

    // Edit the page selection message to refresh buttons for the next loop iteration.
    // awaitMessageComponent only resolves once per call, so we need to keep the message
    // alive with active components for the next iteration's await to work.
    try {
      await interaction.editReply({
        embeds: [pageSelectEmbed],
        components: buildPageActionRows(totalPages, currentNodes.length, locale),
      });
    } catch {
      // If editing fails (e.g. interaction expired), break the loop
      log.info("[ST Preset Node Toggle] Could not refresh page buttons, ending loop");
      break;
    }
  }

  try {
    await interaction.editReply({
      embeds: [pageSelectEmbed],
      components: [],
    });
  } catch {}
}

/**
 * Process modal toggle results: build the enabled state map and detect changes.
 *
 */
function processToggleResults(
  modalResult: { multiValues?: Record<string, string[]> },
  pageNodes: StPresetNodeRow[],
  groupCount: number,
): {
  summary: { enabledMap: Map<string, boolean>; changes: string[] };
  selectedCount: number;
  totalCount: number;
} {
  const selectedIds = collectSelectedIds(modalResult.multiValues, groupCount);
  const enabledMap = new Map<string, boolean>();
  const changes: string[] = [];

  for (const node of pageNodes) {
    const isNowEnabled = selectedIds.has(node.identifier);
    enabledMap.set(node.identifier, isNowEnabled);

    if (isNowEnabled !== node.is_enabled) {
      const state = isNowEnabled ? "ON" : "OFF";
      changes.push(`${state} ${node.name}`);
    }
  }

  return {
    summary: { enabledMap, changes },
    selectedCount: selectedIds.size,
    totalCount: pageNodes.length,
  };
}
