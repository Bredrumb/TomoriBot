import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { hasOptApiKey } from "@/utils/security/crypto";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import {
  buildCapabilitiesManageConfigWritePlan,
  getCapabilitiesManagePermissionDefinitions,
} from "@/utils/discord/manageConfigMapping";

const PERMISSIONS_MAX_OPTIONS_PER_GROUP = 10;

// Note: MODAL_CUSTOM_ID is generated per-invocation (see execute()) to prevent stale
// awaitModalSubmit listeners from a previous run resolving on the same submission.
const PERMISSIONS_CHECKBOX_ID = "config_permissions_checkbox";

// Configure the subcommand: no options needed, UI is a checkbox modal
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.capabilities.manage.description"));

/**
 * Configures various permissions for Tomori's behavior on the server using
 * a checkbox modal. Checked items = enabled.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Scope modal custom ID to this invocation: prevents stale awaitModalSubmit
  //    listeners from a prior (un-submitted) run resolving on this submission.
  const MODAL_CUSTOM_ID = `config_permissions_modal_${interaction.id}`;

  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // NOTE: No deferReply here: promptWithRawModal must be the first
  // acknowledgment. Pre-modal checks are cache-backed and complete within 3 seconds.

  // Declared outside try/catch so the catch block can use the modal interaction
  // (which is auto-deferred) for error reporting instead of the consumed original interaction.
  let modalInteraction: ModalSubmitInteraction | null = null;

  try {
    const guildKey = interaction.guild?.id ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(guildKey);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Determine which permissions to show (voicemessage requires ElevenLabs key)
    let includeElevenLabs = true;
    if (tomoriState.server_id) {
      includeElevenLabs = await hasOptApiKey(tomoriState.server_id, ELEVENLABS_SERVICE_NAME);
    }
    const activeDefinitions = getCapabilitiesManagePermissionDefinitions({ includeElevenLabs });

    const checkboxOptions: CheckboxGroupOption[] = activeDefinitions.map((def) => ({
      label: localizer(locale, def.labelKey),
      value: def.value,
      description: localizer(locale, def.descKey),
      default: def.getState(tomoriState.config),
    }));

    const checkboxGroups: ModalCheckboxGroupField[] = [];
    for (let index = 0; index < checkboxOptions.length; index += PERMISSIONS_MAX_OPTIONS_PER_GROUP) {
      const optionsChunk = checkboxOptions.slice(index, index + PERMISSIONS_MAX_OPTIONS_PER_GROUP);
      const groupIndex = Math.floor(index / PERMISSIONS_MAX_OPTIONS_PER_GROUP);

      checkboxGroups.push({
        kind: "checkboxGroup" as const,
        customId: `${PERMISSIONS_CHECKBOX_ID}_${groupIndex}`,
        labelKey:
          groupIndex === 0
            ? "commands.capabilities.manage.select_placeholder"
            : "commands.capabilities.manage.checkbox_label_continued",
        descriptionKey: groupIndex === 0 ? "commands.capabilities.manage.select_embed_description" : undefined,
        minValues: 0,
        maxValues: optionsChunk.length,
        required: false,
        options: optionsChunk,
      });
    }

    // Show the checkbox modal: first interaction acknowledgment
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.capabilities.manage.select_embed_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;

    if (!modalResult.interaction) {
      log.error("Permissions modal unexpectedly missing interaction");
      return;
    }
    modalInteraction = modalResult.interaction;

    const newlyEnabled = new Set<string>();
    for (let groupIndex = 0; groupIndex < checkboxGroups.length; groupIndex++) {
      const selectedValues = modalResult.multiValues?.[`${PERMISSIONS_CHECKBOX_ID}_${groupIndex}`] ?? [];
      for (const selectedValue of selectedValues) {
        newlyEnabled.add(selectedValue);
      }
    }
    const writePlan = buildCapabilitiesManageConfigWritePlan(tomoriState.config, newlyEnabled, { includeElevenLabs });
    const changes = writePlan.changes.map((change) => ({
      ...change,
      label: localizer(locale, change.labelKey),
    }));

    if (changes.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.capabilities.manage.no_changes_title",
        descriptionKey: "commands.capabilities.manage.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const updateTargets: Array<{
      tableName: "server_member_permissions_configs" | "server_capabilities_configs";
      columns: string[];
    }> = [];

    const memberPermissionColumns = Object.keys(writePlan.patch.memberPermissions);
    if (memberPermissionColumns.length > 0) {
      updateTargets.push({
        tableName: "server_member_permissions_configs",
        columns: memberPermissionColumns,
      });
    }

    const capabilityColumns = Object.keys(writePlan.patch.capabilities);
    if (capabilityColumns.length > 0) {
      updateTargets.push({
        tableName: "server_capabilities_configs",
        columns: capabilityColumns,
      });
    }

    const updated = await configRepository[writePlan.method](tomoriState.server_id, writePlan.patch);

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "capabilities manage",
          guildId: interaction.guild?.id ?? interaction.user.id,
          updateTargets,
        },
      };
      await log.error(
        `Failed to update capability config columns: ${updateTargets
          .map((target) => `${target.tableName}.${target.columns.join(",")}`)
          .join("; ")}`,
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // Invalidate cache so next message picks up the fresh config
    invalidateTomoriStateCache(guildKey);

    const enabledLabels = changes.filter((c) => c.isEnabled).map((c) => `\`${c.label}\``);
    const disabledLabels = changes.filter((c) => !c.isEnabled).map((c) => `\`${c.label}\``);

    let resultDescription = localizer(locale, "commands.capabilities.manage.success_description", {
      count: changes.length,
    });
    if (enabledLabels.length > 0) {
      resultDescription += `\n✅ **Enabled:** ${enabledLabels.join(", ")}`;
    }
    if (disabledLabels.length > 0) {
      resultDescription += `\n🔴 **Disabled:** ${disabledLabels.join(", ")}`;
    }

    await modalInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.capabilities.manage.success_title"))
          .setDescription(resultDescription)
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    let serverIdForError: number | null = null;
    let personaIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      personaIdForError = state?.persona_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      personaId: personaIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "capabilities manage",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /capabilities manage for user ${userData.user_disc_id}`, error as Error, context);

    // Inform user of unknown error
    // Use modalInteraction (auto-deferred) if available since the original
    // interaction is consumed by promptWithRawModal's raw REST acknowledgment.
    const activeInteraction = modalInteraction ?? interaction;
    await replyInfoEmbed(activeInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
