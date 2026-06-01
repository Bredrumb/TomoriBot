import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { DEFAULT_IMAGE_NEGATIVE_TAGS } from "@/utils/image/tagDefaults";
import {
  formatImageTagsForModalValue,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseAndValidateImageTags,
  TAGS_MODAL_MAX_LENGTH,
} from "@/utils/image/tagHelpers";

const MODAL_CUSTOM_ID = "config_image_tags_default_negative_modal";
const TAGS_INPUT_ID = "default_negative_tags_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("default-negative")
    .setDescription(localizer("en-US", "commands.config.image-tags.default-negative.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const tomoriState = await getCachedTomoriState(interaction.guild.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    const currentTagsValue = formatImageTagsForModalValue(tomoriState.config.image_default_negative_tags);
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.config.image-tags.default-negative.modal_title",
      components: [
        {
          customId: TAGS_INPUT_ID,
          labelKey: "commands.config.image-tags.default-negative.tags_input_label",
          descriptionKey: "commands.config.image-tags.default-negative.tags_input_description",
          placeholder: "commands.config.image-tags.default-negative.tags_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: TAGS_MODAL_MAX_LENGTH,
          value: currentTagsValue,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees interaction exists
    modalSubmitInteraction = modalResult.interaction!;
    const tagsInput = modalResult.values?.[TAGS_INPUT_ID] ?? "";

    if (tagsInput.trim().length === 0) {
      const cleared = await configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
        image_default_negative_tags: [...DEFAULT_IMAGE_NEGATIVE_TAGS],
      });

      if (!cleared) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(interaction.guild.id);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.image-tags.default-negative.cleared_title",
        descriptionKey: "commands.config.image-tags.default-negative.cleared_description",
        descriptionVars: {
          tag_list: DEFAULT_IMAGE_NEGATIVE_TAGS.join(", "),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const validationResult = parseAndValidateImageTags(tagsInput);

    if (!validationResult.isValid && validationResult.reason === "empty") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.image-tags.default-negative.no_tags_title",
        descriptionKey: "commands.config.image-tags.default-negative.no_tags_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "too_many") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.image-tags.default-negative.too_many_tags_title",
        descriptionKey: "commands.config.image-tags.default-negative.too_many_tags_description",
        descriptionVars: { max_tags: MAX_TAGS.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.image-tags.default-negative.tag_too_long_title",
        descriptionKey: "commands.config.image-tags.default-negative.tag_too_long_description",
        descriptionVars: { max_length: MAX_TAG_LENGTH.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const updated = await configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
      image_default_negative_tags: validationResult.tags,
    });

    if (!updated) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild.id);

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.config.image-tags.default-negative.success_title",
      descriptionKey: "commands.config.image-tags.default-negative.success_description",
      descriptionVars: {
        tag_list: validationResult.tags.join(", "),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    await log.error("Error in /config image-tags default-negative command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "config image-tags default-negative",
        guildId: interaction.guild.id,
        serverId: tomoriState.server_id,
      },
    });

    await replyInfoEmbed(modalSubmitInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
