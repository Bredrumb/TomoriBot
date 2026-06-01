import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";

type OpenRouterModelMigrationInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;

export async function replyLegacyOpenRouterOtherModelMoved(
  interaction: OpenRouterModelMigrationInteraction,
  locale: string,
  scopeKind: "server" | "personal",
): Promise<void> {
  const addCommand =
    scopeKind === "server"
      ? commandRegistry.getCommandMention("openrouter", "model", "add")
      : commandRegistry.getCommandMention("personal", "openrouter-model", "add");
  const removeCommand =
    scopeKind === "server"
      ? commandRegistry.getCommandMention("openrouter", "model", "remove")
      : commandRegistry.getCommandMention("personal", "openrouter-model", "remove");

  await replyInfoEmbed(interaction, locale, {
    titleKey: "general.openrouter_model_moved_title",
    descriptionKey: "general.openrouter_model_moved_description",
    descriptionVars: {
      add_command: addCommand,
      remove_command: removeCommand,
    },
    color: ColorCode.ERROR,
    ...(interaction.deferred || interaction.replied ? {} : { flags: MessageFlags.Ephemeral }),
  });
}
