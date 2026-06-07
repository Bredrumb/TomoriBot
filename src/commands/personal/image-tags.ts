import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { userRepository } from "@/utils/db/repositories";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import {
  formatImageTagsForModalValue,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseAndValidateImageTags,
  TAGS_MODAL_MAX_LENGTH,
} from "@/utils/image/tagHelpers";

const MODAL_CUSTOM_ID = "personal_image_tags_modal";
const TAGS_INPUT_ID = "personal_image_tags_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("image-tags").setDescription(localizer("en-US", "commands.personal.image-tags.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const userId = userData.user_id;
  if (userId === undefined) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    const currentTagsValue = formatImageTagsForModalValue(userData.physical_appearance_tags);
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.personal.image-tags.modal_title",
      components: [
        {
          customId: TAGS_INPUT_ID,
          labelKey: "commands.personal.image-tags.tags_input_label",
          descriptionKey: "commands.personal.image-tags.tags_input_description",
          placeholder: "commands.personal.image-tags.tags_input_placeholder",
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
      const cleared = await userRepository.update(userId, { physical_appearance_tags: [] });

      if (!cleared) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.image-tags.cleared_title",
        descriptionKey: "commands.personal.image-tags.cleared_description",
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const validationResult = parseAndValidateImageTags(tagsInput);

    if (!validationResult.isValid && validationResult.reason === "empty") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.image-tags.no_tags_title",
        descriptionKey: "commands.personal.image-tags.no_tags_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "too_many") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.image-tags.too_many_tags_title",
        descriptionKey: "commands.personal.image-tags.too_many_tags_description",
        descriptionVars: { max_tags: MAX_TAGS.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.personal.image-tags.tag_too_long_title",
        descriptionKey: "commands.personal.image-tags.tag_too_long_description",
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

    const updated = await userRepository.update(userId, { physical_appearance_tags: validationResult.tags });

    if (!updated) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.personal.image-tags.success_title",
      descriptionKey: "commands.personal.image-tags.success_description",
      descriptionVars: {
        tag_list: validationResult.tags.join(", "),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    await log.error("Error in /personal image-tags command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal image-tags",
        userDiscId: userData.user_disc_id,
      },
    });

    await replyInfoEmbed(modalSubmitInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
