import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import {
  buildOpenRouterModelCheckboxGroups,
  collectCheckedOpenRouterModelValues,
  MAX_OPENROUTER_MODEL_GROUPS,
} from "@/utils/discord/openrouterModelRemovalModal";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  loadRegisteredOpenRouterModelsForScope,
  removeOpenRouterModelForScope,
  type OpenRouterModelCapability,
  type RegisteredOpenRouterModelEntry,
} from "@/utils/provider/openrouterModelRegistry";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.openrouter.models.remove.description"));

function getCapabilityLabel(locale: string, capability: OpenRouterModelCapability): string {
  switch (capability) {
    case "text":
      return localizer(locale, "commands.openrouter.models.remove.capability_text");
    case "embedding":
      return localizer(locale, "commands.openrouter.models.remove.capability_embedding");
    case "image":
      return localizer(locale, "commands.openrouter.models.remove.capability_image");
    case "video":
      return localizer(locale, "commands.openrouter.models.remove.capability_video");
  }
}

function formatRemovedModels(locale: string, models: RegisteredOpenRouterModelEntry[]): string {
  const grouped = new Map<OpenRouterModelCapability, string[]>();

  for (const model of models) {
    const existing = grouped.get(model.capability) ?? [];
    existing.push(`\`${model.codename}\``);
    grouped.set(model.capability, existing);
  }

  return Array.from(grouped.entries())
    .map(([capability, entries]) => `${getCapabilityLabel(locale, capability)}: ${entries.join(", ")}`)
    .join("; ");
}

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
    const scope = {
      kind: "server" as const,
      ownerId: tomoriState.server_id,
    };
    const registeredModels = await loadRegisteredOpenRouterModelsForScope(scope);
    if (registeredModels.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.openrouter.models.remove.none_title",
        descriptionKey: "commands.openrouter.models.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxGroups = buildOpenRouterModelCheckboxGroups(registeredModels);
    if (checkboxGroups.length > MAX_OPENROUTER_MODEL_GROUPS) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.openrouter.models.remove.too_many_title",
        descriptionKey: "commands.openrouter.models.remove.too_many_description",
        descriptionVars: {
          max_groups: MAX_OPENROUTER_MODEL_GROUPS,
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
        modalCustomId: `openrouter_models_remove_modal_${interaction.id}`,
        modalTitleKey: "commands.openrouter.models.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const checkedValues = collectCheckedOpenRouterModelValues(modalResult.multiValues, checkboxGroups.length);
    const modelsToRemove = registeredModels.filter(
      (model) => !checkedValues.has(`${model.capability}:${model.modelId}`),
    );
    if (modelsToRemove.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.openrouter.models.remove.no_removals_title",
        descriptionKey: "commands.openrouter.models.remove.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const removedModels: RegisteredOpenRouterModelEntry[] = [];
    let stillReferenced = false;

    for (const model of modelsToRemove) {
      const result = await removeOpenRouterModelForScope(scope, model.capability, model.codename);
      if (result.status === "removed") {
        removedModels.push(result.model);
        stillReferenced ||= result.stillReferenced;
      }
    }

    if (removedModels.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.openrouter.models.remove.success_title",
      descriptionKey: stillReferenced
        ? "commands.openrouter.models.remove.success_still_referenced_description"
        : "commands.openrouter.models.remove.success_description",
      descriptionVars: {
        models_removed: formatRemovedModels(locale, removedModels),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "openrouter model remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /openrouter model remove", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
