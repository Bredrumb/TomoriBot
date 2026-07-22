import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "forget_attribute_modal";
const ATTRIBUTE_SELECT_ID = "attribute_select";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.attribute.remove.description"));

/** Removes a personality attribute from a selected persona. */
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
  const workflowState: {
    selectedPersona: TomoriState | null;
    message: PersonaWorkflowMessageController | null;
  } = { selectedPersona: null, message: null };
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      onSelected: async (selection) => {
        workflowState.selectedPersona = selection.persona;
        workflowState.message = selection.message;
        const personaId = selection.persona.persona_id;

        if (!personaId) {
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

        if (!tomoriState?.config.attribute_memteaching_enabled && !hasManagePermission) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.teach.attribute.teaching_disabled_title",
              descriptionKey: "commands.teach.attribute.teaching_disabled_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        const currentAttributes = selection.persona.attribute_list ?? [];
        if (currentAttributes.length === 0) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.forget.attribute.no_attributes_title",
              descriptionKey: "commands.forget.attribute.no_attributes",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const options: SelectOption[] = currentAttributes.map((attribute, index) => ({
          label: safeSelectOptionText(attribute),
          value: index.toString(),
        }));
        const modalResult = await selection.openModal({
          modalCustomId: MODAL_CUSTOM_ID,
          modalTitleKey: "commands.forget.attribute.modal_title",
          components: [
            {
              customId: ATTRIBUTE_SELECT_ID,
              labelKey: "commands.forget.attribute.select_label",
              descriptionKey: "commands.forget.attribute.select_description",
              placeholder: "commands.forget.attribute.select_placeholder",
              required: true,
              options,
            },
          ],
        });
        if (modalResult.outcome !== "submitted") {
          log.info(`Attribute removal modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        const selectedValue = modalResult.phase.values[ATTRIBUTE_SELECT_ID];
        const selectedIndex = Number.parseInt(selectedValue ?? "", 10);
        const attributeToRemove = currentAttributes[selectedIndex];
        if (!Number.isInteger(selectedIndex) || !attributeToRemove) {
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

        const removed = await personaRepository.removeAttributeAt(personaId, selectedIndex + 1);
        if (!removed) {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.update_failed_title",
              descriptionKey: "general.errors.update_failed_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        invalidateTomoriStateCache(serverDiscId);
        log.success(
          `Removed attribute "${attributeToRemove}" for tomori ${personaId} by user ${userData.user_disc_id}`,
        );
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.forget.attribute.success_title",
            descriptionKey: "commands.forget.attribute.success_description",
            descriptionVars: { attribute: attributeToRemove },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        const refreshedPersonas = await personaRepository.loadAllForServer(serverDiscId);
        return retryPersonaWorkflow(refreshedPersonas);
      },
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: workflowState.selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget attribute",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /forget attribute for user ${userData.user_disc_id}`, error as Error, context);

    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
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
