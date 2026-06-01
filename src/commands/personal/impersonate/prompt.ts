import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { userRepository } from "@/utils/db/repositories";

const MODAL_CUSTOM_ID = "personal_impersonate_prompt_modal";
const PROMPT_INPUT_ID = "personal_impersonate_prompt_input";
const MAX_PROMPT_LENGTH = 4000;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("prompt").setDescription(localizer("en-US", "commands.personal.impersonate.prompt.description"));

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

  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;

  try {
    const currentPrompt = userData.impersonation_prompt?.trim() ?? "";
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.personal.impersonate.prompt.modal_title",
        components: [
          {
            customId: PROMPT_INPUT_ID,
            labelKey: "commands.personal.impersonate.prompt.prompt_label",
            descriptionKey: "commands.personal.impersonate.prompt.prompt_description",
            placeholder: "commands.personal.impersonate.prompt.prompt_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: MAX_PROMPT_LENGTH,
            value: currentPrompt,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Personal impersonation prompt modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    if (!modalSubmitInteraction) {
      return;
    }

    const nextPromptRaw = modalResult.values?.[PROMPT_INPUT_ID] ?? "";
    const nextPrompt = nextPromptRaw.trim();
    const normalizedCurrentPrompt = currentPrompt || null;
    const normalizedNextPrompt = nextPrompt || null;

    if (!normalizedCurrentPrompt && !normalizedNextPrompt) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.impersonate.prompt.already_cleared_title",
        descriptionKey: "commands.personal.impersonate.prompt.already_cleared_description",
        color: ColorCode.WARN,
      });
      return;
    }

    if (normalizedCurrentPrompt === normalizedNextPrompt) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.impersonate.prompt.already_set_title",
        descriptionKey: "commands.personal.impersonate.prompt.already_set_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: userData.user_id is always provided by command framework
    const ok = await userRepository.setImpersonatePrompt(userData.user_id!, normalizedNextPrompt);
    if (!ok) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateUserCache(interaction.user.id);

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: normalizedNextPrompt
        ? "commands.personal.impersonate.prompt.success_title"
        : "commands.personal.impersonate.prompt.cleared_title",
      descriptionKey: normalizedNextPrompt
        ? "commands.personal.impersonate.prompt.success_description"
        : "commands.personal.impersonate.prompt.cleared_description",
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal impersonate prompt",
        guildId: interaction.guild?.id,
        userDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /personal impersonate prompt for user ${interaction.user.id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(modalSubmitInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
