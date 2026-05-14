import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  type OpenRouterModelCapability,
  registerOpenRouterModelForScope,
} from "@/utils/provider/openrouterModelRegistry";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.personal.openrouter_models.add.description"))
    .addStringOption((option) =>
      option
        .setName("capability")
        .setDescription(localizer("en-US", "commands.personal.openrouter_models.add.capability_description"))
        .setRequired(true)
        .addChoices(
          { name: "Text", value: "text" },
          { name: "Embedding", value: "embedding" },
          { name: "Image", value: "image" },
          { name: "Video", value: "video" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("model_name")
        .setDescription(localizer("en-US", "commands.personal.openrouter_models.add.model_name_description"))
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!userData.user_id) {
    return;
  }

  try {
    const capability = interaction.options.getString("capability", true) as OpenRouterModelCapability;
    const modelName = interaction.options.getString("model_name", true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await registerOpenRouterModelForScope(
      {
        kind: "personal",
        ownerId: userData.user_id,
      },
      capability,
      modelName,
    );

    switch (result.status) {
      case "invalid_model":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.personal.openrouter_models.add.not_found_title",
          descriptionKey: "commands.personal.openrouter_models.add.not_found_description",
          descriptionVars: { model_name: modelName },
          color: ColorCode.ERROR,
        });
        return;
      case "already_available":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.personal.openrouter_models.add.already_available_title",
          descriptionKey: "commands.personal.openrouter_models.add.already_available_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.WARN,
        });
        return;
      case "already_registered":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.personal.openrouter_models.add.already_registered_title",
          descriptionKey: "commands.personal.openrouter_models.add.already_registered_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.WARN,
        });
        return;
      case "registered":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.personal.openrouter_models.add.success_title",
          descriptionKey: "commands.personal.openrouter_models.add.success_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.SUCCESS,
        });
        return;
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal openrouter-model add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal openrouter-model add", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
