import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, TomoriState } from "@/types/db/schema";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PersonaWorkflowUpdateError,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { buildTextPreview, textPreviewFooterKey, textPreviewFooterVars } from "@/utils/text/textPreview";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.prompt.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
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

  if (interaction.guild) {
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.forget.personaprompt.no_permission_title",
        descriptionKey: "commands.forget.personaprompt.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  let tomoriState: TomoriState | null = null;
  let personaWorkflowStarted = false;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
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

    personaWorkflowStarted = true;
    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      onSelected: async (selection) => {
        const { message } = await selection.beginInPlaceWork();
        const selectedPersona = selection.persona;

        try {
          if (!selectedPersona.persona_id) {
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.invalid_option_title",
                descriptionKey: "general.errors.invalid_option_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          // 1. Capture the prompt before the write, so the success notice can
          //    echo it back — this is the user's last chance to copy it.
          const removedPreview = buildTextPreview(selectedPersona.persona_prompt);

          const ok = await personaRepository.removePrompt(selectedPersona.persona_id);
          if (!ok) {
            await message.replace(
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
          // 2. Show the removed prompt when there was one; fall back to the
          //    plain notice for personas that had nothing set.
          const hadPrompt = removedPreview.totalChars > 0;
          await message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.forget.personaprompt.success_title",
              descriptionKey: hadPrompt
                ? "commands.forget.personaprompt.success_description_with_prompt"
                : "commands.forget.personaprompt.success_description",
              descriptionVars: {
                persona_name: selectedPersona.persona_nickname,
                removed_prompt: removedPreview.text,
              },
              footerKey: textPreviewFooterKey(removedPreview),
              footerVars: textPreviewFooterVars(removedPreview),
              color: ColorCode.SUCCESS,
            }),
          );
        } catch (error) {
          if (error instanceof PersonaWorkflowUpdateError) throw error;
          await log.error("Error in /forget personaprompt command", error, {
            serverId: selectedPersona.server_id,
            personaId: selectedPersona.persona_id,
            errorType: "CommandExecutionError",
            metadata: {
              command: "forget personaprompt",
              guildId: interaction.guild?.id,
              userId: interaction.user.id,
            },
          });
          await message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.unknown_error_title",
              descriptionKey: "general.errors.unknown_error_description",
              color: ColorCode.ERROR,
            }),
          );
        }

        return completePersonaWorkflow();
      },
    });
  } catch (error) {
    await log.error("Error in /forget personaprompt command", error, {
      serverId: tomoriState?.server_id,
      personaId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget personaprompt",
        guildId: interaction.guild?.id,
        userId: interaction.user.id,
      },
    });

    if (personaWorkflowStarted) return;
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
