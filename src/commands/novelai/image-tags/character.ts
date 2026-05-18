import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { MAX_TAG_LENGTH, MAX_TAGS, parseAndValidateNaiTags, TAGS_MODAL_MAX_LENGTH } from "@/utils/novelai/tagHelpers";
import type { SelectOption } from "@/types/discord/modal";
import { personaRepository } from "@/utils/db/repositories";

// Modal field IDs
const MODAL_CUSTOM_ID = "novelai_tags_character_modal";
const PERSONA_SELECT_ID = "persona_select";
const TAGS_INPUT_ID = "tags_input";

/**
 * Configure the subcommand for Discord slash command registration
 * @param subcommand - The subcommand builder to configure
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("character").setDescription(localizer("en-US", "commands.novelai.tags.character.description"));

/**
 * Configures NovelAI character tags (imageboard-style) for a persona profile.
 *
 * Flow:
 * 1. Load all personas for the server
 * 2. Show modal with persona dropdown + tag text input
 * 3. Parse, validate, and deduplicate tags
 * 4. Replace all existing tags for the selected persona
 * 5. Invalidate cache
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction from Discord
 * @param userData - User data from database
 * @param locale - User's locale preference
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let modalSubmitInteraction: ModalSubmitInteraction | null = null;
  let selectedPersona: TomoriState | null = null;

  try {
    // 2. Load all personas for the server
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 3. Build persona select options
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.persona_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.persona_nickname),
        value: persona.persona_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.server.trigger.add.alter_persona_description")
          : localizer(locale, "commands.server.trigger.add.main_persona_description"),
      }))
      .filter((option) => option.value !== "");

    if (personaSelectOptions.length === 0) {
      log.error("No selectable personas found while building character tags modal options");
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 4. Show modal with persona select + tags text input
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.novelai.tags.character.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.novelai.tags.character.persona_select_label",
          descriptionKey: "commands.novelai.tags.character.persona_select_description",
          placeholder: "commands.novelai.tags.character.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: TAGS_INPUT_ID,
          labelKey: "commands.novelai.tags.character.tags_input_label",
          descriptionKey: "commands.novelai.tags.character.tags_input_description",
          placeholder: "commands.novelai.tags.character.tags_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false, // Empty input clears tags
          maxLength: TAGS_MODAL_MAX_LENGTH,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Character tags modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees interaction exists
    modalSubmitInteraction = modalResult.interaction!;
    const selectedPersonaId = modalResult.values?.[PERSONA_SELECT_ID];
    const tagsInput = modalResult.values?.[TAGS_INPUT_ID];

    if (!selectedPersonaId) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 5. Find the selected persona
    selectedPersona = allPersonas.find((persona) => persona.persona_id?.toString() === selectedPersonaId) ?? null;

    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 6. Handle empty input — clear all tags
    if (!tagsInput || tagsInput.trim().length === 0) {
      await personaRepository.setNaiTags(selectedPersona.persona_id, []);
      invalidateTomoriStateCache(interaction.guild.id);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.character.cleared_title",
        descriptionKey: "commands.novelai.tags.character.cleared_description",
        descriptionVars: {
          persona_name: selectedPersona.persona_nickname,
        },
        color: ColorCode.SUCCESS,
      });
      return;
    }

    // 7. Parse, deduplicate, and validate the submitted tags.
    const validationResult = parseAndValidateNaiTags(tagsInput);

    if (!validationResult.isValid && validationResult.reason === "empty") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.character.no_tags_title",
        descriptionKey: "commands.novelai.tags.character.no_tags_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "too_many") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.character.too_many_tags_title",
        descriptionKey: "commands.novelai.tags.character.too_many_tags_description",
        descriptionVars: { max_tags: MAX_TAGS.toString() },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.tags.character.tag_too_long_title",
        descriptionKey: "commands.novelai.tags.character.tag_too_long_description",
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

    const uniqueTags = validationResult.tags;

    // 8. Replace all existing tags in the database
    await personaRepository.setNaiTags(selectedPersona.persona_id, uniqueTags);

    // 9. Invalidate cache so next access gets fresh data
    invalidateTomoriStateCache(interaction.guild.id);

    // 10. Success response with tag list
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.novelai.tags.character.success_title",
      descriptionKey: "commands.novelai.tags.character.success_description",
      descriptionVars: {
        persona_name: selectedPersona.persona_nickname,
        tag_list: uniqueTags.join(", "),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "novelai tags character",
        guildId: interaction.guild.id,
        personaId: selectedPersona?.persona_id ?? null,
      },
    };
    await log.error("Error in /novelai image-tags character command", error, context);

    const errorReplyInteraction = modalSubmitInteraction ?? interaction;

    await replyInfoEmbed(errorReplyInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
