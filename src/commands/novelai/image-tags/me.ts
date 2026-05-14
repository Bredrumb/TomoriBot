import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { sql } from "@/utils/db/client";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import {
  formatTextArrayLiteral,
  formatNaiTagsForModalValue,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseAndValidateNaiTags,
  TAGS_MODAL_MAX_LENGTH,
} from "@/utils/novelai/tagHelpers";

const MODAL_CUSTOM_ID = "novelai_tags_me_modal";
const TAGS_INPUT_ID = "me_tags_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("me").setDescription(localizer("en-US", "commands.novelai.tags.me.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    const currentTagsValue = formatNaiTagsForModalValue(userData.nai_char_tags);
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.novelai.tags.me.modal_title",
      components: [
        {
          customId: TAGS_INPUT_ID,
          labelKey: "commands.novelai.tags.me.tags_input_label",
          descriptionKey: "commands.novelai.tags.me.tags_input_description",
          placeholder: "commands.novelai.tags.me.tags_input_placeholder",
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
      const cleared = await sql<Array<{ user_id: number }>>`
				UPDATE users
				SET nai_char_tags = ARRAY[]::TEXT[]
				WHERE user_disc_id = ${userData.user_disc_id}
				RETURNING user_id
			`;

      if (!cleared.length) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateUserCache(userData.user_disc_id);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.me.cleared_title",
        descriptionKey: "commands.novelai.tags.me.cleared_description",
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const validationResult = parseAndValidateNaiTags(tagsInput);

    if (!validationResult.isValid && validationResult.reason === "empty") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.me.no_tags_title",
        descriptionKey: "commands.novelai.tags.me.no_tags_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "too_many") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.me.too_many_tags_title",
        descriptionKey: "commands.novelai.tags.me.too_many_tags_description",
        descriptionVars: { max_tags: MAX_TAGS.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.me.tag_too_long_title",
        descriptionKey: "commands.novelai.tags.me.tag_too_long_description",
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

    const tagArrayLiteral = formatTextArrayLiteral(validationResult.tags);
    const updated = await sql<Array<{ user_id: number }>>`
			UPDATE users
			SET nai_char_tags = ${tagArrayLiteral}::TEXT[]
			WHERE user_disc_id = ${userData.user_disc_id}
			RETURNING user_id
		`;

    if (!updated.length) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateUserCache(userData.user_disc_id);

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.novelai.tags.me.success_title",
      descriptionKey: "commands.novelai.tags.me.success_description",
      descriptionVars: {
        tag_list: validationResult.tags.join(", "),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    await log.error("Error in /novelai image-tags me command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "novelai tags me",
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
