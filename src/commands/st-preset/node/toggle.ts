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
import { replyInfoEmbed, promptWithRawModal } from "@/utils/discord/interactionHelper";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import type { UserRow, ErrorContext, StPresetNodeRow, StPresetRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import {
  loadActivePreset,
  loadPresetsForServer,
  loadToggleableNodes,
  updateNodeEnabledStates,
} from "@/utils/db/stPresetDb";

// ─── Constants ───────────────────────────────────────────────────────

const MODAL_CUSTOM_ID = "stpreset_node_toggle_modal";

/** Maximum checkbox options per group (Discord limit: 10) */
const MAX_OPTIONS_PER_GROUP = 10;

/** Maximum checkbox groups per modal (Discord limit: 5 action rows) */
const MAX_GROUPS_PER_MODAL = 5;

/** Maximum toggleable nodes per modal page (5 groups × 10 options) */
const NODES_PER_PAGE = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

/** Timeout for page-selection button interaction (5 minutes) */
const PAGE_SELECT_TIMEOUT_MS = 300_000;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Maximum characters for a checkbox option description (Discord limit) */
const DESCRIPTION_MAX_LENGTH = 100;

/**
 * Strip SillyTavern macros from node content to produce a human-readable
 * description preview. Removes comment blocks, {{trim}}, {{setvar::...}},
 * {{addvar::...}}, and {{getvar::...}} wrappers — but for setvar/addvar nodes,
 * extracts the value portion (e.g., `{{setvar::tense::past tense}}` → `past tense`).
 *
 * @param content - Raw node content with ST macros
 * @returns Cleaned text truncated to DESCRIPTION_MAX_LENGTH, or undefined if empty
 */
function buildNodeDescription(content: string): string | undefined {
  let cleaned = content
    // 1. Strip comment blocks: {{// ... }}
    .replace(/\{\{\/\/[^}]*\}\}/g, "")
    // 2. Strip {{trim}} macros
    .replace(/\{\{trim\}\}/g, "")
    // 3. Extract value from setvar/addvar: {{setvar::key::value}} → value
    .replace(/\{\{(?:setvar|addvar)::[^:}]+::([^}]*)\}\}/g, "$1")
    // 4. Resolve getvar to placeholder: {{getvar::key}} → [key]
    .replace(/\{\{getvar::([^}]*)\}\}/g, "[$1]")
    // 5. Simplify remaining template vars: {{user}} → user, {{char}} → char
    .replace(/\{\{(\w+)\}\}/g, "$1")
    // 6. Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return undefined;

  // 7. Truncate to Discord's limit
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
  // Extract inner text from all {{// ... }} blocks and join with spaces
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
 * Build checkbox groups for a page of nodes.
 * Chunks the given nodes into groups of MAX_OPTIONS_PER_GROUP and
 * creates up to MAX_GROUPS_PER_MODAL checkbox group components.
 *
 * Comment-only nodes (`is_comment: true`) are shown with a localized
 * description indicating they are never injected into the prompt.
 *
 * @param pageNodes - The nodes for this page
 * @param pageOffset - The 0-based index of the first node on this page
 *                     (used to compute human-readable group labels)
 * @param locale - User's preferred locale for comment node descriptions
 * @returns Array of checkbox group modal components
 */
function buildCheckboxGroups(pageNodes: StPresetNodeRow[], pageOffset: number): ModalCheckboxGroupField[] {
  const groups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < pageNodes.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = pageNodes.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);

    const options: CheckboxGroupOption[] = chunk.map((node, chunkIdx) => {
      const rawName = node.name.trim();
      // Discord requires 1–100 chars; fall back to positional label for blank names
      const nodeNumber = pageOffset + i + chunkIdx + 1;
      const label =
        rawName.length === 0 ? `Node ${nodeNumber}` : rawName.length > 100 ? `${rawName.slice(0, 97)}...` : rawName;
      return {
        label,
        value: node.identifier,
        // Comment-only nodes show extracted comment text from inside {{// ... }} blocks
        description: node.is_comment ? buildCommentNodeDescription(node.content) : buildNodeDescription(node.content),
        default: node.is_enabled,
      };
    });

    // Build a dynamic label like "Nodes 1–10" or "Nodes 51–60"
    // (pageOffset converts page-relative indices to overall node numbers)
    const rangeStart = pageOffset + i + 1;
    const rangeEnd = pageOffset + i + chunk.length;
    const dynamicLabel = `Nodes ${rangeStart}–${rangeEnd}`;

    groups.push({
      kind: "checkboxGroup" as const,
      customId: `stpreset_nodes_${groupIndex}`,
      // Pass raw label — localizer returns the key itself when no match is found
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
 * @param multiValues - The multiValues map from the modal result
 * @param groupCount - Number of checkbox groups in this modal
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

// ─── Subcommand Configuration ────────────────────────────────────────

/**
 * Configure the /st-preset node toggle subcommand.
 * No options — node selection happens via checkbox groups in a modal.
 * @param subcommand - The subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("toggle").setDescription(localizer("en-US", "commands.st-preset.node.toggle.description"));

// ─── Execution ───────────────────────────────────────────────────────

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
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Verify server setup
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
    // 2. Find the active preset, or fall back to the first available preset
    let preset = await loadActivePreset(tomoriState.server_id);
    if (!preset) {
      const allPresets = await loadPresetsForServer(tomoriState.server_id);
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

    // 3. Load toggleable nodes from DB (non-marker, ordered by node_order)
    const dbNodes = await loadToggleableNodes(preset.preset_id);
    if (dbNodes.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.st-preset.node.toggle.no_nodes_title",
        descriptionKey: "commands.st-preset.node.toggle.no_nodes_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 4. Determine if pagination is needed
    const totalPages = Math.ceil(dbNodes.length / NODES_PER_PAGE);

    // preset_id is guaranteed non-null by the guard above
    const presetId = preset.preset_id as number;

    if (totalPages > 1) {
      // 4a. Multi-page: page-selection loop
      //     Users can pick pages, toggle nodes, and return to pick another page.
      await executeMultiPageToggle(interaction, locale, preset, presetId, dbNodes, totalPages);
    } else {
      // 4b. Single page: show modal directly
      await executeSinglePageToggle(interaction, locale, preset, presetId, dbNodes);
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      tomoriId: null,
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

// ─── Page Flow Helpers ──────────────────────────────────────────────

/** Custom ID for the "Done" button in the page-selection loop */
const DONE_BUTTON_ID = "stpreset_toggle_done";

/**
 * Build the page-selection action rows (page buttons + "Done" button).
 *
 * @param totalPages - Total number of pages
 * @param totalNodes - Total number of toggleable nodes
 * @returns Array of action rows with page buttons and a trailing "Done" button
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

  // Add "Done" button at the end
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
 * @param interaction - The command interaction (used as modal source)
 * @param locale - User's preferred locale
 * @param preset - The active preset
 * @param presetId - The validated preset_id (guaranteed non-null by caller)
 * @param dbNodes - All toggleable nodes for this preset
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

  // Persist changes
  if (summary.changes.length > 0) {
    await updateNodeEnabledStates(presetId, summary.enabledMap, preset.server_id);
  }

  // Reply with summary
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
 * another page — no need to re-run the command.
 *
 * @param interaction - The command interaction
 * @param locale - User's preferred locale
 * @param preset - The active preset
 * @param presetId - The validated preset_id (guaranteed non-null by caller)
 * @param dbNodes - All toggleable nodes (will be reloaded after each toggle)
 * @param totalPages - Total number of pages
 */
async function executeMultiPageToggle(
  interaction: ChatInputCommandInteraction,
  locale: string,
  preset: StPresetRow,
  presetId: number,
  dbNodes: StPresetNodeRow[],
  totalPages: number,
): Promise<void> {
  // 1. Build and send the page-selection embed with buttons
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

  // 2. Loop: await page button → show modal → process → repeat
  let currentNodes = dbNodes;

  while (true) {
    // Wait for a button click (page or "Done")
    let buttonInteraction: ButtonInteraction;
    try {
      buttonInteraction = (await pageSelectMessage.awaitMessageComponent({
        filter: (i) =>
          i.user.id === interaction.user.id &&
          (i.customId.startsWith("stpreset_page_") || i.customId === DONE_BUTTON_ID),
        time: PAGE_SELECT_TIMEOUT_MS,
      })) as ButtonInteraction;
    } catch {
      // Timeout — silently end the loop
      log.info("[ST Preset Node Toggle] Page selection timed out");
      break;
    }

    // "Done" button pressed — exit the loop
    if (buttonInteraction.customId === DONE_BUTTON_ID) {
      await buttonInteraction.deferUpdate();
      break;
    }

    // Extract selected page and slice nodes
    const selectedPage = Number.parseInt(buttonInteraction.customId.replace("stpreset_page_", ""), 10);
    const startIndex = (selectedPage - 1) * NODES_PER_PAGE;
    const pageNodes = currentNodes.slice(startIndex, startIndex + NODES_PER_PAGE);

    // Show modal for this page
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
      // Process the toggle results
      const { summary, selectedCount, totalCount } = processToggleResults(
        modalResult,
        pageNodes,
        checkboxGroups.length,
      );

      // Persist changes
      if (summary.changes.length > 0) {
        await updateNodeEnabledStates(presetId, summary.enabledMap, preset.server_id);

        // Reload nodes from DB so the next modal shows updated defaults
        currentNodes = await loadToggleableNodes(presetId);
      }

      // Reply with summary on the modal interaction
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

  // 3. Clean up — remove buttons from the page selection message
  try {
    await interaction.editReply({
      embeds: [pageSelectEmbed],
      components: [],
    });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Process modal toggle results: build the enabled state map and detect changes.
 *
 * @param modalResult - The modal submission result
 * @param pageNodes - The nodes that were shown in this modal
 * @param groupCount - Number of checkbox groups in the modal
 * @returns Object with the summary, selected count, and total count
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
