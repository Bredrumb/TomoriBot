import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CustomEndpointCapability, CustomEndpointRow, ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { llmProviderRepo } from "@/utils/db/repositories";
import {
  buildCustomEndpointCheckboxGroups,
  collectCheckedCustomEndpointValues,
  MAX_CUSTOM_MODEL_GROUPS,
} from "@/utils/discord/customModelRemovalModal";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { removeCustomEndpointRegistration } from "@/utils/provider/customEndpointService";
import { localizer } from "@/utils/text/localizer";

function getCapabilityLabel(locale: string, capability: CustomEndpointCapability): string {
  switch (capability) {
    case "text":
      return localizer(locale, "commands.personal.custom_models.remove.capability_text");
    case "embedding":
      return localizer(locale, "commands.personal.custom_models.remove.capability_embedding");
    case "image":
      return localizer(locale, "commands.personal.custom_models.remove.capability_image");
    case "video":
      return localizer(locale, "commands.personal.custom_models.remove.capability_video");
    case "speech":
      return localizer(locale, "commands.personal.custom_models.remove.capability_speech");
    case "transcription":
      return localizer(locale, "commands.personal.custom_models.remove.capability_transcription");
  }
}

function formatRemovedEndpoints(locale: string, endpoints: CustomEndpointRow[]): string {
  const grouped = new Map<CustomEndpointCapability, string[]>();

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.capability) ?? [];
    // Surface the model name when present so removing one model among several reads clearly.
    const display = endpoint.model_name?.trim() ? `${endpoint.label} (${endpoint.model_name.trim()})` : endpoint.label;
    existing.push(`\`${display}\``);
    grouped.set(endpoint.capability, existing);
  }

  return Array.from(grouped.entries())
    .map(([capability, entries]) => `${getCapabilityLabel(locale, capability)}: ${entries.join(", ")}`)
    .join("; ");
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.personal.custom_models.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!userData.user_id) {
    return;
  }

  const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const registeredEndpoints = await llmProviderRepo.loadCustomEndpointsForUser(userData.user_id);
    if (registeredEndpoints.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.custom_models.remove.none_title",
        descriptionKey: "commands.personal.custom_models.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxKeyRoot = ["commands", "personal", "custom_models", "remove"].join(".");
    const checkboxGroups = buildCustomEndpointCheckboxGroups(registeredEndpoints, checkboxKeyRoot);
    if (checkboxGroups.length > MAX_CUSTOM_MODEL_GROUPS) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.custom_models.remove.too_many_title",
        descriptionKey: "commands.personal.custom_models.remove.too_many_description",
        descriptionVars: {
          max_groups: MAX_CUSTOM_MODEL_GROUPS,
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: `personal_custom_models_remove_modal_${interaction.id}`,
        modalTitleKey: "commands.personal.custom_models.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const checkedValues = collectCheckedCustomEndpointValues(modalResult.multiValues, checkboxGroups.length);
    const endpointsToRemove = registeredEndpoints.filter(
      (endpoint) =>
        !checkedValues.has(endpoint.custom_endpoint_id?.toString() ?? `${endpoint.capability}:${endpoint.label}`),
    );
    if (endpointsToRemove.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.personal.custom_models.remove.no_removals_title",
        descriptionKey: "commands.personal.custom_models.remove.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    // The service owns synthetic-model deletion and exact active-selection cleanup,
    // so removing one endpoint leaves sibling models under the same label intact.
    const removedEndpoints: CustomEndpointRow[] = [];

    for (const endpoint of endpointsToRemove) {
      if (endpoint.custom_endpoint_id == null) {
        continue;
      }

      const removed = await removeCustomEndpointRegistration({
        scope: {
          kind: "personal",
          ownerId: userData.user_id,
          baseConfig: tomoriState.config,
        },
        customEndpointId: endpoint.custom_endpoint_id,
        label: endpoint.label,
        capability: endpoint.capability,
        modelRefId: endpoint.model_ref_id ?? null,
      });

      if (removed) {
        removedEndpoints.push(endpoint);
      }
    }

    if (removedEndpoints.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.personal.custom_models.remove.success_title",
      descriptionKey: "commands.personal.custom_models.remove.success_description",
      descriptionVars: {
        models_removed: formatRemovedEndpoints(locale, removedEndpoints),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal custom-endpoint remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal custom-endpoint remove", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
