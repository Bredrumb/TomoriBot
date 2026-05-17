import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CustomEndpointCapability, CustomEndpointRow, ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository, llmProviderRepo } from "@/utils/db/repositories";
import {
  buildCustomEndpointCheckboxGroups,
  collectCheckedCustomEndpointValues,
  MAX_CUSTOM_MODEL_GROUPS,
} from "@/utils/discord/customModelRemovalModal";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { sql } from "@/utils/db/client";
import { log, ColorCode } from "@/utils/misc/logger";
import { removeCustomEndpointRegistration } from "@/utils/provider/customEndpointService";
import { buildServerCustomProviderName } from "@/utils/provider/customProviderUtils";
import { localizer } from "@/utils/text/localizer";

async function resolveCurrentProvider(serverId: number, capability: CustomEndpointCapability): Promise<string | null> {
  switch (capability) {
    case "speech":
    case "transcription":
      return null;
    case "text":
    case "image":
    case "embedding":
    case "video": {
      const [row] =
        capability === "text"
          ? await sql`SELECT llm_provider AS provider FROM llms WHERE llm_id = (SELECT llm_id FROM server_model_configs WHERE server_id = ${serverId}) LIMIT 1`
          : capability === "image"
            ? await sql`SELECT provider FROM image_diffusion_models WHERE diffusion_model_id = (SELECT diffusion_model_id FROM server_model_configs WHERE server_id = ${serverId}) LIMIT 1`
            : capability === "embedding"
              ? await sql`SELECT provider FROM embedding_models WHERE embedding_model_id = (SELECT embedding_model_id FROM server_model_configs WHERE server_id = ${serverId}) LIMIT 1`
              : await sql`SELECT provider FROM video_generation_models WHERE video_model_id = (SELECT video_model_id FROM server_model_configs WHERE server_id = ${serverId}) LIMIT 1`;
      return row?.provider ? String(row.provider).toLowerCase() : null;
    }
  }
}

function getCapabilityLabel(locale: string, capability: CustomEndpointCapability): string {
  switch (capability) {
    case "text":
      return localizer(locale, "commands.config.custom_models.remove.capability_text");
    case "embedding":
      return localizer(locale, "commands.config.custom_models.remove.capability_embedding");
    case "image":
      return localizer(locale, "commands.config.custom_models.remove.capability_image");
    case "video":
      return localizer(locale, "commands.config.custom_models.remove.capability_video");
    case "speech":
      return localizer(locale, "commands.config.custom_models.remove.capability_speech");
    case "transcription":
      return localizer(locale, "commands.config.custom_models.remove.capability_transcription");
  }
}

function formatRemovedEndpoints(locale: string, endpoints: CustomEndpointRow[]): string {
  const grouped = new Map<CustomEndpointCapability, string[]>();

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.capability) ?? [];
    existing.push(`\`${endpoint.label}\``);
    grouped.set(endpoint.capability, existing);
  }

  return Array.from(grouped.entries())
    .map(([capability, entries]) => `${getCapabilityLabel(locale, capability)}: ${entries.join(", ")}`)
    .join("; ");
}

async function clearCurrentProviderSelections(
  serverId: number,
  capabilitiesToClear: Set<CustomEndpointCapability>,
  currentLlmId: number | null,
  currentVisionLlmId: number | null,
): Promise<void> {
  for (const capability of capabilitiesToClear) {
    switch (capability) {
      case "text": {
        // Self-referencing case: if vision_llm_id pointed at the now-removed text
        // model, null it too. Resolved in TS so the patch stays a flat partial.
        const shouldClearVision = currentVisionLlmId !== null && currentVisionLlmId === currentLlmId;
        await configRepository.updateModelConfig(serverId, {
          llm_id: null,
          custom_endpoint_url: null,
          custom_model_name: null,
          custom_num_ctx: null,
          ...(shouldClearVision ? { vision_llm_id: null } : {}),
        });
        break;
      }
      case "embedding":
        await configRepository.updateModelConfig(serverId, { embedding_model_id: null });
        break;
      case "image":
        await configRepository.updateModelConfig(serverId, { diffusion_model_id: null });
        break;
      case "video":
        await configRepository.updateModelConfig(serverId, { video_model_id: null });
        break;
    }
  }
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.config.custom_models.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
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
    const registeredEndpoints = await llmProviderRepo.loadCustomEndpointsForServer(tomoriState.server_id);
    if (registeredEndpoints.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.custom_models.remove.none_title",
        descriptionKey: "commands.config.custom_models.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxKeyRoot = ["commands", "config", "custom_models", "remove"].join(".");
    const checkboxGroups = buildCustomEndpointCheckboxGroups(registeredEndpoints, checkboxKeyRoot);
    if (checkboxGroups.length > MAX_CUSTOM_MODEL_GROUPS) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.custom_models.remove.too_many_title",
        descriptionKey: "commands.config.custom_models.remove.too_many_description",
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
        modalCustomId: `config_custom_models_remove_modal_${interaction.id}`,
        modalTitleKey: "commands.config.custom_models.remove.modal_title",
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
        titleKey: "commands.config.custom_models.remove.no_removals_title",
        descriptionKey: "commands.config.custom_models.remove.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const removedCapabilities = new Set(endpointsToRemove.map((endpoint) => endpoint.capability));
    const currentProviders = new Map<CustomEndpointCapability, string | null>();
    for (const capability of removedCapabilities) {
      currentProviders.set(capability, await resolveCurrentProvider(tomoriState.server_id, capability));
    }

    const removedEndpoints: CustomEndpointRow[] = [];
    const capabilitiesToClear = new Set<CustomEndpointCapability>();

    for (const endpoint of endpointsToRemove) {
      const removed = await removeCustomEndpointRegistration({
        scope: {
          kind: "server",
          ownerId: tomoriState.server_id,
          baseConfig: tomoriState.config,
          serverDiscId: interaction.guild?.id ?? interaction.user.id,
        },
        label: endpoint.label,
        capability: endpoint.capability,
      });

      if (!removed) {
        continue;
      }

      removedEndpoints.push(endpoint);

      const removedProvider = buildServerCustomProviderName(tomoriState.server_id, endpoint.label);
      if (currentProviders.get(endpoint.capability) === removedProvider) {
        capabilitiesToClear.add(endpoint.capability);
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

    await clearCurrentProviderSelections(
      tomoriState.server_id,
      capabilitiesToClear,
      tomoriState.config.llm_id ?? null,
      tomoriState.config.vision_llm_id ?? null,
    );
    if (capabilitiesToClear.size > 0) {
      invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);
    }

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.config.custom_models.remove.success_title",
      descriptionKey: "commands.config.custom_models.remove.success_description",
      descriptionVars: {
        models_removed: formatRemovedEndpoints(locale, removedEndpoints),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config custom-endpoint remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /config custom-endpoint remove", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
