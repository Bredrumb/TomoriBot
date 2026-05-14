import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, PersonalProviderCapability, UserRow } from "@/types/db/schema";
import { loadUserSavedProviderConfigs } from "@/utils/db/repositories";
import {
  getActivePersonalProviderForCapability,
  getStoredPersonalProviderForCapability,
  setPersonalCapabilityEnabled,
} from "@/utils/provider/personalProviderHelpers";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";

const CHECKBOX_ID = "personal_provider_capabilities";
const CAPABILITIES: PersonalProviderCapability[] = ["text", "embedding", "image", "video", "vision"];

function getCapabilityLabel(locale: string, capability: PersonalProviderCapability): string {
  return localizer(locale, `commands.personal.provider.capability_${capability}`);
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("toggle-models")
    .setDescription(localizer("en-US", "commands.personal.provider.toggle-models.description"));

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
  if (!userData.user_id) {
    return;
  }

  try {
    const rows = await loadUserSavedProviderConfigs(userData.user_id);
    if (rows.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.provider.no_saved_title",
        descriptionKey: "commands.personal.provider.no_saved_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const options = CAPABILITIES.map((capability) => {
      const activeRow = getActivePersonalProviderForCapability(rows, capability);
      const storedRow = getStoredPersonalProviderForCapability(rows, capability);
      const description = storedRow
        ? localizer(locale, "commands.personal.provider.toggle-models.provider_description", {
            provider: getProviderDisplayName(activeRow?.provider ?? storedRow.provider),
          })
        : localizer(locale, "commands.personal.provider.toggle-models.none_set_description");

      return {
        label: getCapabilityLabel(locale, capability),
        value: capability,
        description,
        default: Boolean(activeRow),
      };
    });

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: "personal_provider_toggle_models_modal",
        modalTitleKey: "commands.personal.provider.toggle-models.modal_title",
        components: [
          {
            kind: "checkboxGroup",
            customId: CHECKBOX_ID,
            labelKey: "commands.personal.provider.toggle-models.group_label",
            descriptionKey: "commands.personal.provider.toggle-models.group_description",
            required: false,
            options,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const selectedCapabilities = new Set(
      (modalResult.multiValues?.[CHECKBOX_ID] ?? []) as PersonalProviderCapability[],
    );

    for (const capability of selectedCapabilities) {
      if (!getStoredPersonalProviderForCapability(rows, capability)) {
        await replyInfoEmbed(modalResult.interaction, locale, {
          titleKey: "commands.personal.provider.toggle-models.missing_model_title",
          descriptionKey: "commands.personal.provider.toggle-models.missing_model_description",
          descriptionVars: {
            capability: getCapabilityLabel(locale, capability),
          },
          color: ColorCode.ERROR,
        });
        return;
      }
    }

    for (const capability of CAPABILITIES) {
      const enabled = selectedCapabilities.has(capability);
      await setPersonalCapabilityEnabled(userData.user_id, capability, enabled);
    }

    const refreshedRows = await loadUserSavedProviderConfigs(userData.user_id);
    const activeSummary = CAPABILITIES.map((capability) => {
      const row = getActivePersonalProviderForCapability(refreshedRows, capability);
      return row
        ? `- ${getCapabilityLabel(locale, capability)}: ${getProviderDisplayName(row.provider)}`
        : `- ${getCapabilityLabel(locale, capability)}: ${localizer(locale, "general.none")}`;
    }).join("\n");

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.personal.provider.toggle-models.success_title",
      descriptionKey: "commands.personal.provider.toggle-models.success_description",
      descriptionVars: {
        active_summary: activeSummary,
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal provider toggle-models",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider toggle-models", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
