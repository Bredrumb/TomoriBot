import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
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
  const guildId = interaction.guild.id;

  const workflowState: {
    message: PersonaWorkflowMessageController | null;
    selectedPersona: TomoriState | null;
  } = { message: null, selectedPersona: null };

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const allPersonas = await personaRepository.loadAllForServer(guildId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      titleKey: "commands.persona.image-tags.persona_select_title",
      color: ColorCode.INFO,
      async onSelected(selection) {
        workflowState.message = selection.message;
        const selectedPersona = selection.persona;
        workflowState.selectedPersona = selectedPersona;

        if (!selectedPersona.persona_id) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.invalid_option_title",
              descriptionKey: "general.errors.invalid_option_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        const currentTagsValue = formatImageTagsForModalValue(selectedPersona.physical_appearance_tags);
        const modalResult = await selection.openModal({
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

        if (modalResult.outcome !== "submitted") {
          log.info(`Persona image tags modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        const tagsInput = modalResult.phase.values[TAGS_INPUT_ID] ?? "";
        if (tagsInput.trim().length === 0) {
          const cleared = await personaRepository.setPhysicalAppearanceTags(selectedPersona.persona_id, []);
          if (!cleared) {
            await work.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.update_failed_title",
                descriptionKey: "general.errors.update_failed_description",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.ERROR,
              }),
            );
            return retryPersonaWorkflow();
          }

          selectedPersona.physical_appearance_tags = [];
          invalidateTomoriStateCache(guildId);
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.persona.image-tags.cleared_title",
              descriptionKey: "commands.persona.image-tags.cleared_description",
              descriptionVars: { persona_name: selectedPersona.persona_nickname },
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.SUCCESS,
            }),
          );
          return retryPersonaWorkflow();
        }

        const validationResult = parseAndValidateImageTags(tagsInput);
        if (!validationResult.isValid) {
          const validationNotice: {
            titleKey: string;
            descriptionKey: string;
            descriptionVars?: Record<string, string | number | boolean>;
          } =
            validationResult.reason === "empty"
              ? {
                  titleKey: "commands.persona.image-tags.no_tags_title",
                  descriptionKey: "commands.persona.image-tags.no_tags_description",
                }
              : validationResult.reason === "too_many"
                ? {
                    titleKey: "commands.persona.image-tags.too_many_tags_title",
                    descriptionKey: "commands.persona.image-tags.too_many_tags_description",
                    descriptionVars: { max_tags: MAX_TAGS.toString() },
                  }
                : validationResult.reason === "tag_too_long"
                  ? {
                      titleKey: "commands.persona.image-tags.tag_too_long_title",
                      descriptionKey: "commands.persona.image-tags.tag_too_long_description",
                      descriptionVars: { max_length: MAX_TAG_LENGTH.toString() },
                    }
                  : {
                      titleKey: "general.errors.invalid_option_title",
                      descriptionKey: "general.errors.invalid_option_description",
                    };
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              ...validationNotice,
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        const updated = await personaRepository.setPhysicalAppearanceTags(
          selectedPersona.persona_id,
          validationResult.tags,
        );
        if (!updated) {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.update_failed_title",
              descriptionKey: "general.errors.update_failed_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        selectedPersona.physical_appearance_tags = validationResult.tags;
        invalidateTomoriStateCache(guildId);
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.persona.image-tags.success_title",
            descriptionKey: "commands.persona.image-tags.success_description",
            descriptionVars: {
              persona_name: selectedPersona.persona_nickname,
              tag_list: validationResult.tags.join(", "),
            },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        return retryPersonaWorkflow();
      },
    });
  } catch (error) {
    const context = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona image-tags",
        guildId,
        personaId: workflowState.selectedPersona?.persona_id ?? null,
      },
    };
    await log.error("Error in /persona image-tags command", error, context);

    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
    } else {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
