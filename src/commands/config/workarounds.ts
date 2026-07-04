import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { WORKAROUND_DEFINITIONS, buildWorkaroundConfigWritePlan } from "@/utils/discord/workaroundConfigMapping";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";

const WORKAROUNDS_CHECKBOX_ID = "config_workarounds_checkbox";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("workarounds").setDescription(localizer("en-US", "commands.config.workarounds.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const modalCustomId = `config_workarounds_modal_${interaction.id}`;

  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

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

    const checkboxOptions: CheckboxGroupOption[] = WORKAROUND_DEFINITIONS.map((def) => ({
      label: localizer(locale, def.labelKey),
      value: def.value,
      description: localizer(locale, def.descKey),
      default: def.getState(tomoriState.config),
    }));

    const checkboxGroup: ModalCheckboxGroupField = {
      kind: "checkboxGroup",
      customId: WORKAROUNDS_CHECKBOX_ID,
      labelKey: "commands.config.workarounds.checkbox_label",
      descriptionKey: "commands.config.workarounds.checkbox_description",
      minValues: 0,
      maxValues: checkboxOptions.length,
      required: false,
      options: checkboxOptions,
    };

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId,
        modalTitleKey: "commands.config.workarounds.modal_title",
        components: [checkboxGroup],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;

    if (!modalResult.interaction) {
      log.error("Workarounds modal unexpectedly missing interaction");
      return;
    }
    modalInteraction = modalResult.interaction;

    const selectedValues = modalResult.multiValues?.[WORKAROUNDS_CHECKBOX_ID] ?? [];
    const writePlan = buildWorkaroundConfigWritePlan(tomoriState.config, selectedValues);
    const changes = writePlan.changes.map((change) => ({
      ...change,
      label: localizer(locale, change.labelKey),
    }));

    if (changes.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.config.workarounds.no_changes_title",
        descriptionKey: "commands.config.workarounds.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await configRepository[writePlan.method](tomoriState.server_id, writePlan.patch);
    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config workarounds",
          guildId: interaction.guild?.id ?? interaction.user.id,
          updateColumns: Object.keys(writePlan.patch),
        },
      };
      await log.error("Failed to update workaround config", new Error("Database update returned no rows"), context);

      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(guildKey);

    const enabledLabels = changes.filter((change) => change.isEnabled).map((change) => `\`${change.label}\``);
    const disabledLabels = changes.filter((change) => !change.isEnabled).map((change) => `\`${change.label}\``);
    let resultDescription = localizer(locale, "commands.config.workarounds.success_description", {
      count: changes.length,
    });
    if (enabledLabels.length > 0) {
      resultDescription += `\n${localizer(locale, "commands.config.workarounds.enabled_label")}: ${enabledLabels.join(
        ", ",
      )}`;
    }
    if (disabledLabels.length > 0) {
      resultDescription += `\n${localizer(locale, "commands.config.workarounds.disabled_label")}: ${disabledLabels.join(
        ", ",
      )}`;
    }

    await modalInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.config.workarounds.success_title"))
          .setDescription(resultDescription)
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: interaction.guild?.id ? (await getCachedTomoriState(interaction.guild.id))?.server_id : undefined,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config workarounds",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /config workarounds for user ${userData.user_disc_id}`, error as Error, context);

    await replyInfoEmbed(modalInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
