import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
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
    .setDescription(localizer("en-US", "commands.openrouter.models.add.description"))
    .addStringOption((option) =>
      option
        .setName("capability")
        .setDescription(localizer("en-US", "commands.openrouter.models.add.capability_description"))
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
        .setDescription(localizer("en-US", "commands.openrouter.models.add.model_name_description"))
        .setRequired(true),
    );

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
    const capability = interaction.options.getString("capability", true) as OpenRouterModelCapability;
    const modelName = interaction.options.getString("model_name", true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await registerOpenRouterModelForScope(
      {
        kind: "server",
        ownerId: tomoriState.server_id,
      },
      capability,
      modelName,
    );

    switch (result.status) {
      case "invalid_model":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.openrouter.models.add.not_found_title",
          descriptionKey: "commands.openrouter.models.add.not_found_description",
          descriptionVars: { model_name: modelName },
          color: ColorCode.ERROR,
        });
        return;
      case "already_available":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.openrouter.models.add.already_available_title",
          descriptionKey: "commands.openrouter.models.add.already_available_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.WARN,
        });
        return;
      case "already_registered":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.openrouter.models.add.already_registered_title",
          descriptionKey: "commands.openrouter.models.add.already_registered_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.WARN,
        });
        return;
      case "registered":
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.openrouter.models.add.success_title",
          descriptionKey: "commands.openrouter.models.add.success_description",
          descriptionVars: { capability, model_name: result.model.codename },
          color: ColorCode.SUCCESS,
        });
        return;
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "openrouter model add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /openrouter model add", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
