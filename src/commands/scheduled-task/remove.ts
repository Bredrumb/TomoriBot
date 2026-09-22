import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { serverScheduleRepository } from "@/utils/db/repositories";
import type { ReminderSelectionRow } from "@/utils/db/repositories";
import { buildReminderOptionParts } from "@/commands/scheduled-task/reminderSelectOptions";

const MODAL_CUSTOM_ID = "scheduled_task_remove_modal";
const REMINDER_SELECT_ID = "reminder_select";

async function performReminderRemoval(
  reminderToRemove: { reminder_id: number; reminder_purpose: string },
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  const deleted = await serverScheduleRepository.deleteReminderById(reminderToRemove.reminder_id);

  if (!deleted) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.operation_failed_title",
      descriptionKey: "general.errors.operation_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  log.success(
    `Deleted reminder ${reminderToRemove.reminder_id} (${reminderToRemove.reminder_purpose.slice(0, 60)}...)`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.scheduled-task.remove.success_title",
      descriptionKey: "commands.scheduled-task.remove.success_description",
      descriptionVars: {
        reminder_purpose:
          reminderToRemove.reminder_purpose.length > 80
            ? `${reminderToRemove.reminder_purpose.slice(0, 77)}...`
            : reminderToRemove.reminder_purpose,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.scheduled-task.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let tomoriState: TomoriState | null = null;

  try {
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
    const state = tomoriState;

    const reminders = await serverScheduleRepository.loadReminderSelections(
      tomoriState.server_id,
      hasManagePermission ? undefined : userData.user_id,
    );

    if (!reminders || reminders.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.scheduled-task.remove.no_entries_title",
        descriptionKey: "commands.scheduled-task.remove.no_entries",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reminderSelectOptions: SelectOption[] = reminders.map((reminder: ReminderSelectionRow, index: number) => {
      const parts = buildReminderOptionParts({
        reminder,
        state,
        locale,
        timezoneOffset,
        hasManagePermission,
        viewerUserId: userData.user_id,
        repeatTextKey: "commands.scheduled-task.remove.select_repeat_text",
        managerCreatedByKey: "commands.scheduled-task.remove.select_manager_created_by_text",
      });
      const channelName =
        interaction.guild?.channels.cache.get(reminder.channel_disc_id)?.name ?? reminder.channel_disc_id;
      const description = localizer(locale, "commands.scheduled-task.remove.select_option_description", {
        ...parts,
        target_channel: channelName,
      });

      return {
        label: safeSelectOptionText(reminder.reminder_purpose, 40),
        value: index.toString(),
        description: safeSelectOptionText(description),
      };
    });

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.scheduled-task.remove.modal_title",
      components: [
        {
          customId: REMINDER_SELECT_ID,
          labelKey: "commands.scheduled-task.remove.select_label",
          descriptionKey: "commands.scheduled-task.remove.select_description",
          placeholder: "commands.scheduled-task.remove.select_placeholder",
          required: true,
          options: reminderSelectOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Reminder deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.scheduled-task.remove.modal_title",
        "commands.scheduled-task.remove.select_description",
        ColorCode.INFO,
      );
      return;
    }

    const modalSubmitInteraction = modalResult.interaction;
    const selectedIndex = modalResult.values?.[REMINDER_SELECT_ID];

    if (!modalSubmitInteraction || !selectedIndex) {
      log.error("Modal result unexpectedly missing interaction or values");
      return;
    }

    const selectedReminder = reminders[Number.parseInt(selectedIndex, 10)];
    if (!selectedReminder) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "general.errors.operation_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const removalSucceeded = await performReminderRemoval(selectedReminder, modalSubmitInteraction, locale, true);
    if (!removalSucceeded) {
      return;
    }
    await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
    await replyComponentsV2Status(
      interaction,
      locale,
      "commands.scheduled-task.remove.success_title",
      "commands.scheduled-task.remove.success_description",
      ColorCode.SUCCESS,
      {
        reminder_purpose:
          selectedReminder.reminder_purpose.length > 80
            ? `${selectedReminder.reminder_purpose.slice(0, 77)}...`
            : selectedReminder.reminder_purpose,
      },
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "scheduled-task remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /scheduled-task remove for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
