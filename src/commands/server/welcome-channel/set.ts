import {
  ChannelType,
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { getCachedAllPersonas, getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "server_welcome_channel_set_modal";
const PERSONA_SELECT_ID = "welcome_persona_select";
const PROMPT_INPUT_ID = "welcome_additional_prompt";
const RANDOM_PERSONA_VALUE = "random";
const MAX_ADDITIONAL_PROMPT_LENGTH = 2000;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("set")
    .setDescription(localizer("en-US", "commands.server.welcome-channel.set.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.welcome-channel.set.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedChannel = interaction.options.getChannel("channel", true);
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await getCachedAllPersonas(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaOptions: SelectOption[] = [
      {
        label: safeSelectOptionText(localizer(locale, "commands.server.welcome-channel.shared.persona_random_label")),
        value: RANDOM_PERSONA_VALUE,
      },
      ...allPersonas
        .filter((persona) => persona.tomori_id !== undefined)
        .map((persona) => ({
          label: safeSelectOptionText(persona.tomori_nickname),
          value: persona.tomori_id?.toString() ?? "",
          description: persona.is_alter
            ? localizer(locale, "commands.server.welcome-channel.shared.alter_persona_description")
            : localizer(locale, "commands.server.welcome-channel.shared.main_persona_description"),
        }))
        .filter((option) => option.value !== ""),
    ];

    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.welcome-channel.shared.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.server.welcome-channel.shared.persona_select_label",
          descriptionKey: "commands.server.welcome-channel.shared.persona_select_description",
          placeholder: "commands.server.welcome-channel.shared.persona_select_placeholder",
          required: true,
          options: personaOptions,
        },
        {
          customId: PROMPT_INPUT_ID,
          labelKey: "commands.server.welcome-channel.shared.prompt_label",
          descriptionKey: "commands.server.welcome-channel.shared.prompt_description",
          placeholder: "commands.server.welcome-channel.shared.prompt_placeholder",
          style: TextInputStyle.Paragraph,
          required: true,
          maxLength: MAX_ADDITIONAL_PROMPT_LENGTH,
          value: tomoriState.config.welcome_prompt ?? undefined,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Welcome channel set modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    modalSubmitInteraction = modalResult.interaction ?? null;
    const selectedPersonaValue = modalResult.values?.[PERSONA_SELECT_ID];
    const additionalPrompt = modalResult.values?.[PROMPT_INPUT_ID]?.trim() ?? "";

    if (!modalSubmitInteraction || !selectedPersonaValue) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!additionalPrompt) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.server.welcome-channel.shared.empty_prompt_title",
        descriptionKey: "commands.server.welcome-channel.shared.empty_prompt_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let welcomePersonaId: number | null = null;
    let personaDisplayName = localizer(locale, "commands.server.welcome-channel.shared.persona_random_label");

    if (selectedPersonaValue !== RANDOM_PERSONA_VALUE) {
      welcomePersonaId = Number.parseInt(selectedPersonaValue, 10);
      const selectedPersona = allPersonas.find((persona) => persona.tomori_id === welcomePersonaId);
      if (!selectedPersona || Number.isNaN(welcomePersonaId)) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      personaDisplayName = selectedPersona.tomori_nickname;
    }

    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const updatedConfig = await configRepository.update(tomoriState.server_id, {
      welcome_channel_disc_id: selectedChannel.id,
      welcome_prompt: additionalPrompt,
      welcome_persona_id: welcomePersonaId,
    });

    if (!updatedConfig) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild.id);
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.server.welcome-channel.set.success_title",
      descriptionKey: "commands.server.welcome-channel.set.success_description",
      descriptionVars: {
        channel: `<#${selectedChannel.id}>`,
        persona: personaDisplayName,
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server welcome-channel set",
        guildId: interaction.guild?.id,
        channelId: selectedChannel.id,
      },
    };
    await log.error("Error in /server welcome-channel set command", error, context);

    const errorTarget = modalSubmitInteraction ?? (interaction.replied || interaction.deferred ? interaction : null);
    if (errorTarget) {
      await replyInfoEmbed(errorTarget, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
