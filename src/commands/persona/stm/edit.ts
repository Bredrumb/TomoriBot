/**
 * Command: /persona stm edit
 * Lets an admin hand-edit a persona's live short-term memory for the CURRENT channel.
 *
 * Flow (README decision 3): persona picker → ONE prefilled modal with one input per
 * configured STM category (≤5, fits Discord's 5-component modal limit). There is no
 * "select which field" step — the fixed category set is shown all at once.
 *   - input label       = the category label (e.g. "Goals")
 *   - input placeholder  = the category description
 *   - input value        = the persona's current stored value for that category in this scope
 *   - a non-empty field adds/edits that category's value; an empty field clears it.
 *
 * Scope (README decision 6): in a guild the live injected row is the server-shared one;
 * in a DM it is the user-scoped row. The write fns dual-write both scopes in guilds, so
 * the editor's per-user recall mirrors the shared edit — consistent with the STM tool.
 *
 * Storage mode mirrors the STM tool exactly:
 *   - Summary mode (only the default `summary` category) → edits the `summary` string field
 *     via updateShortTermMemorySummary (byte-identical to the pre-category era).
 *   - Category mode (any custom config) → edits the `categories` slug→value map via
 *     updateShortTermMemoryCategories.
 * Both write fns are write-through (cache + durable DB), so no extra invalidation is needed.
 */
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { ModalInputField } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { acknowledgeModalSubmitForRefresh, promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { personaRepository, shortTermMemoryRepository } from "@/utils/db/repositories";
import {
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
  invalidateShortTermMemory,
  updateShortTermMemoryCategories,
  updateShortTermMemorySummary,
  type ShortTermMemoryEntry,
} from "@/utils/cache/shortTermMemoryCache";
import { buildSlugMap } from "@/utils/text/slugifyLabel";

const MODAL_CUSTOM_ID = "persona_stm_edit_modal";
const CATEGORY_INPUT_PREFIX = "stm_cat_";
const VALUE_MAX_LENGTH = 1500; // mirrors MAX_SUMMARY_LENGTH ceiling used by the STM tool
const DISCORD_LABEL_MAX = 45; // Discord modal text-input label limit
const DISCORD_PLACEHOLDER_MAX = 100; // Discord modal placeholder limit

/** One modal input descriptor paired with the category slug it edits. */
type CategoryInput = { slug: string; field: ModalInputField };

/**
 * Configure the slash command subcommand metadata.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("edit").setDescription(localizer("en-US", "commands.persona.stm.edit.description"));

/**
 * Execute the /persona stm edit command.
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param userData - Invoking user's row
 * @param locale - Resolved locale for the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Channel-only — STM is per-channel, so we need a concrete channel to scope to.
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. In guilds, editing a persona's working memory requires Manage Server.
  if (interaction.guild) {
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.stm.edit.no_permission_title",
        descriptionKey: "commands.persona.stm.edit.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Load the server's ordered category definitions ONCE — shared by every picker pass.
    //    getStmCategories always returns at least the default `summary` category.
    const categoryRows = await shortTermMemoryRepository.getStmCategories(tomoriState.server_id);
    const isCategoryMode = !(categoryRows.length === 1 && categoryRows[0].label.toLowerCase() === "summary");
    const slugMap = buildSlugMap(categoryRows);

    // buildSlugMap iterates categoryRows in order, so the i-th slug pairs with the i-th row —
    // zip them into a slug→description map for the modal input placeholders.
    const slugDescriptions = new Map<string, string>();
    const slugList = [...slugMap.keys()];
    categoryRows.forEach((row, index) => {
      const slug = slugList[index];
      if (slug) slugDescriptions.set(slug, row.description);
    });

    const channelId = interaction.channelId;
    const channelName = "name" in interaction.channel ? (interaction.channel.name ?? undefined) : undefined;
    const parentChannelId =
      "isThread" in interaction.channel &&
      typeof interaction.channel.isThread === "function" &&
      interaction.channel.isThread() &&
      "parentId" in interaction.channel
        ? (interaction.channel.parentId ?? null)
        : null;

    // 4. Persona picker loop (Pattern 4A) — refreshes in place after each edit.
    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) return;
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.persona_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const personaId = selectedPersona.persona_id;
      const personaLineageId = selectedPersona.persona_lineage_id ?? null;

      // 5. Resolve the LIVE durable STM row for this channel + persona in the injected scope.
      const liveEntry: ShortTermMemoryEntry | undefined = interaction.guild
        ? getShortTermMemoryForServerChannel(interaction.guild.id, channelId, personaId)
        : getShortTermMemoryForUserChannel(interaction.user.id, channelId, personaId);

      // 6. Build one prefilled input per category (or a single `summary` input in summary mode).
      const inputs = buildCategoryInputs(slugMap, slugDescriptions, liveEntry, isCategoryMode);

      const modalResult = await promptWithRawModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.stm.edit.modal_title",
        components: inputs.map((entry) => entry.field),
      });

      if (modalResult.outcome !== "submit") {
        log.info(`Persona STM edit modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      modalSubmitInteraction = modalResult.interaction;
      if (!modalSubmitInteraction) {
        log.error("Persona STM edit modal unexpectedly missing interaction");
        return;
      }

      // 7. Persist the edit through the same path the STM tool uses for this mode.
      await persistStmEdit({
        inputs,
        values: modalResult.values,
        isCategoryMode,
        guildId: interaction.guild?.id,
        userId: interaction.user.id,
        channelId,
        channelName,
        parentChannelId,
        personaId,
        personaLineageId,
        serverName: interaction.guild?.name,
      });

      log.success(
        `Edited STM for persona ${personaId} in channel ${channelId} (${isCategoryMode ? "category" : "summary"} mode) by ${userData.user_disc_id}`,
      );

      // 8. Refresh the picker in place so the admin can edit another persona.
      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.persona.stm.edit.success_title",
        "commands.persona.stm.edit.success_description",
        ColorCode.SUCCESS,
        { persona_name: selectedPersona.persona_nickname },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona stm edit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /persona stm edit for user ${userData.user_disc_id}`, error as Error, context);

    const errorReplyTarget =
      modalSubmitInteraction ??
      (personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction);
    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Builds the modal inputs — one per category slug, prefilled from the live STM entry.
 * In summary mode the single input is prefilled from the `summary` string field; in
 * category mode each input is prefilled from the `categories` slug→value map.
 *
 * @param slugMap - Ordered slug→label map from the server's category definitions
 * @param slugDescriptions - slug→description map used for the input placeholders
 * @param liveEntry - The current STM entry for this scope (or undefined when none cached)
 * @param isCategoryMode - Whether the server is in category mode vs. summary fallback
 */
function buildCategoryInputs(
  slugMap: Map<string, string>,
  slugDescriptions: Map<string, string>,
  liveEntry: ShortTermMemoryEntry | undefined,
  isCategoryMode: boolean,
): CategoryInput[] {
  const inputs: CategoryInput[] = [];
  const currentCategories = liveEntry?.categories ?? {};

  for (const [slug, label] of slugMap) {
    // Summary mode has exactly one slug; its value lives in the `summary` string field.
    const currentValue = isCategoryMode ? currentCategories[slug] : liveEntry?.summary;
    const description = slugDescriptions.get(slug);
    inputs.push({
      slug,
      field: {
        customId: `${CATEGORY_INPUT_PREFIX}${slug}`,
        // Category labels are user-defined runtime data, not locale keys; localizer()
        // returns the string unchanged on a miss, so the raw label renders as the input label.
        labelKey: label.slice(0, DISCORD_LABEL_MAX),
        // The description is shown as the placeholder. promptWithRawModal only localizes
        // placeholders that start with "commands."; a plain description renders verbatim.
        placeholder: description ? description.slice(0, DISCORD_PLACEHOLDER_MAX) : undefined,
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: VALUE_MAX_LENGTH,
        value: currentValue || undefined,
      },
    });
  }

  return inputs;
}

/**
 * Persists the submitted edit using the storage path that matches the server's mode.
 * Category mode replaces the slug→value map (empty fields are omitted = cleared).
 * Summary mode writes the single string, or clears the scope when left empty.
 */
async function persistStmEdit(args: {
  inputs: CategoryInput[];
  values: Record<string, string> | undefined;
  isCategoryMode: boolean;
  guildId: string | undefined;
  userId: string;
  channelId: string;
  channelName: string | undefined;
  parentChannelId: string | null;
  personaId: number;
  personaLineageId: number | null;
  serverName: string | undefined;
}): Promise<void> {
  const { inputs, values, isCategoryMode, guildId, userId, channelId } = args;
  const serverId = guildId ?? "DM";

  if (isCategoryMode) {
    // 1. Build the slug→value map from non-empty fields; omitted slugs are cleared.
    const categories: Record<string, string> = {};
    for (const { slug } of inputs) {
      const value = values?.[`${CATEGORY_INPUT_PREFIX}${slug}`]?.trim();
      if (value) categories[slug] = value.slice(0, VALUE_MAX_LENGTH);
    }

    // 2. Write-through (cache + durable DB) for both scopes the way the STM tool does.
    await updateShortTermMemoryCategories(
      userId,
      channelId,
      categories,
      serverId,
      args.serverName,
      args.channelName,
      args.personaId,
      args.personaLineageId,
      args.parentChannelId,
    );
    return;
  }

  // Summary mode: the single input maps to the `summary` string field.
  const summaryInput = inputs[0];
  const summaryValue = summaryInput ? values?.[`${CATEGORY_INPUT_PREFIX}${summaryInput.slug}`]?.trim() : undefined;

  if (summaryValue) {
    updateShortTermMemorySummary(
      userId,
      channelId,
      summaryValue.slice(0, VALUE_MAX_LENGTH),
      serverId,
      args.serverName,
      args.channelName,
      args.personaId,
      args.personaLineageId,
      args.parentChannelId,
    );
    return;
  }

  // Empty summary submit → clear the live scope entry from cache so it stops rendering
  // immediately. The durable row is left to be overwritten by the next STM update or the
  // janitor; there is no dedicated "clear summary only" write path.
  invalidateShortTermMemory(userId, channelId, args.personaId, guildId);
}
