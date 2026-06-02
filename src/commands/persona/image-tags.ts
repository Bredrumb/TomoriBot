import {
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { acknowledgeModalSubmitForRefresh, promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import type { TomoriState, UserRow } from "@/types/db/schema";
import {
  formatImageTagsForModalValue,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseAndValidateImageTags,
  TAGS_MODAL_MAX_LENGTH,
} from "@/utils/image/tagHelpers";
import { personaRepository } from "@/utils/db/repositories";

const MODAL_CUSTOM_ID = "persona_image_tags_modal";
const TAGS_INPUT_ID = "persona_image_tags_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("image-tags").setDescription(localizer("en-US", "commands.persona.image-tags.description"));

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

  // Check permissions (ManageGuild required)
  const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
  if (!hasPermission) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.persona.image-tags.no_permission_title",
      descriptionKey: "commands.persona.image-tags.no_permission_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let personaSelectionInteraction: ButtonInteraction | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;
  let selectedPersona: TomoriState | null = null;

  try {
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        titleKey: "commands.persona.image-tags.persona_select_title",
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        return;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

      if (!selectedPersona?.persona_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const currentTagsValue = formatImageTagsForModalValue(selectedPersona.physical_appearance_tags);
      const modalResult = await promptWithRawModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.image-tags.modal_title",
        components: [
          {
            customId: TAGS_INPUT_ID,
            labelKey: "commands.persona.image-tags.tags_input_label",
            descriptionKey: "commands.persona.image-tags.tags_input_description",
            placeholder: "commands.persona.image-tags.tags_input_placeholder",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: TAGS_MODAL_MAX_LENGTH,
            value: currentTagsValue,
          },
        ],
      });

      if (modalResult.outcome !== "submit") {
        log.info(`Persona image tags modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees interaction exists
      modalSubmitInteraction = modalResult.interaction!;
      const tagsInput = modalResult.values?.[TAGS_INPUT_ID] ?? "";

      if (tagsInput.trim().length === 0) {
        const cleared = await personaRepository.setPhysicalAppearanceTags(selectedPersona.persona_id, []);
        if (!cleared) {
          await replyInfoEmbed(modalSubmitInteraction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          continue;
        }

        selectedPersona.physical_appearance_tags = [];
        invalidateTomoriStateCache(interaction.guild.id);

        await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
        await replyComponentsV2Status(
          interaction,
          locale,
          "commands.persona.image-tags.cleared_title",
          "commands.persona.image-tags.cleared_description",
          ColorCode.SUCCESS,
          { persona_name: selectedPersona.persona_nickname },
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const validationResult = parseAndValidateImageTags(tagsInput);

      if (!validationResult.isValid && validationResult.reason === "empty") {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.persona.image-tags.no_tags_title",
          descriptionKey: "commands.persona.image-tags.no_tags_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (!validationResult.isValid && validationResult.reason === "too_many") {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.persona.image-tags.too_many_tags_title",
          descriptionKey: "commands.persona.image-tags.too_many_tags_description",
          descriptionVars: { max_tags: MAX_TAGS.toString() },
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (!validationResult.isValid && validationResult.reason === "tag_too_long") {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.persona.image-tags.tag_too_long_title",
          descriptionKey: "commands.persona.image-tags.tag_too_long_description",
          descriptionVars: { max_length: MAX_TAG_LENGTH.toString() },
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (!validationResult.isValid) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      const updated = await personaRepository.setPhysicalAppearanceTags(
        selectedPersona.persona_id,
        validationResult.tags,
      );
      if (!updated) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      selectedPersona.physical_appearance_tags = validationResult.tags;
      invalidateTomoriStateCache(interaction.guild.id);

      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.persona.image-tags.success_title",
        "commands.persona.image-tags.success_description",
        ColorCode.SUCCESS,
        {
          persona_name: selectedPersona.persona_nickname,
          tag_list: validationResult.tags.join(", "),
        },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona image-tags",
        guildId: interaction.guild.id,
        personaId: selectedPersona?.persona_id ?? null,
      },
    };
    await log.error("Error in /persona image-tags command", error, context);

    const errorReplyTarget =
      modalSubmitInteraction ??
      (personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction);

    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
