import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { sql } from "@/utils/db/client";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { DEFAULT_NAI_NEGATIVE_TAGS } from "@/utils/image/naiTagDefaults";
import {
  formatTextArrayLiteral,
  formatNaiTagsForModalValue,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseAndValidateNaiTags,
  TAGS_MODAL_MAX_LENGTH,
} from "@/utils/novelai/tagHelpers";

const MODAL_CUSTOM_ID = "novelai_tags_negative_modal";
const TAGS_INPUT_ID = "negative_tags_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("negative").setDescription(localizer("en-US", "commands.novelai.tags.negative.description"));

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

  if (!interaction.memberPermissions?.has("ManageGuild")) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.permission_denied_title",
      descriptionKey: "general.errors.permission_denied_description",
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
    const currentTagsValue = formatNaiTagsForModalValue(tomoriState.config.nai_negative_tags);
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.novelai.tags.negative.modal_title",
      components: [
        {
          customId: TAGS_INPUT_ID,
          labelKey: "commands.novelai.tags.negative.tags_input_label",
          descriptionKey: "commands.novelai.tags.negative.tags_input_description",
          placeholder: "commands.novelai.tags.negative.tags_input_placeholder",
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
      const defaultTagArrayLiteral = formatTextArrayLiteral(DEFAULT_NAI_NEGATIVE_TAGS);
      const cleared = await sql<Array<{ tomori_config_id: number }>>`
				UPDATE tomori_configs
				SET nai_negative_tags = ${defaultTagArrayLiteral}::TEXT[]
				WHERE server_id = ${tomoriState.server_id}
				RETURNING tomori_config_id
			`;

      if (!cleared.length) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(interaction.guild.id);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.negative.cleared_title",
        descriptionKey: "commands.novelai.tags.negative.cleared_description",
        descriptionVars: {
          tag_list: DEFAULT_NAI_NEGATIVE_TAGS.join(", "),
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    const validationResult = parseAndValidateNaiTags(tagsInput);

    if (!validationResult.isValid && validationResult.reason === "empty") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.negative.no_tags_title",
        descriptionKey: "commands.novelai.tags.negative.no_tags_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "too_many") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.negative.too_many_tags_title",
        descriptionKey: "commands.novelai.tags.negative.too_many_tags_description",
        descriptionVars: { max_tags: MAX_TAGS.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.negative.tag_too_long_title",
        descriptionKey: "commands.novelai.tags.negative.tag_too_long_description",
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
    const updated = await sql<Array<{ tomori_config_id: number }>>`
			UPDATE tomori_configs
			SET nai_negative_tags = ${tagArrayLiteral}::TEXT[]
			WHERE server_id = ${tomoriState.server_id}
			RETURNING tomori_config_id
		`;

    if (!updated.length) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild.id);

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.novelai.tags.negative.success_title",
      descriptionKey: "commands.novelai.tags.negative.success_description",
      descriptionVars: {
        tag_list: validationResult.tags.join(", "),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    await log.error("Error in /novelai image-tags negative command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "novelai tags negative",
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
