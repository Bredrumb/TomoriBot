import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { showPersonalStatus } from "@/utils/metrics/status/personalPages";
import { showPersonaStatus } from "@/utils/metrics/status/personaPages";
import { showServerChannelsStatus } from "@/utils/metrics/status/serverChannelPages";
import { showServerConfigStatus } from "@/utils/metrics/status/serverConfigPages";
import { showServerModelStatus } from "@/utils/metrics/status/serverModelPages";

/**
 * Executes the /tool status subcommand for personal, server, and persona status scopes.
 */
export async function executeStatusCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guildId ?? interaction.user.id;
  const scope = interaction.options.getString("scope", true);

  try {
    if (scope === "personal") {
      await showPersonalStatus(interaction, userData, locale);
      return;
    }

    if (scope === "persona") {
      await showPersonaStatus(interaction, userData, serverDiscId, locale);
      return;
    }

    if (scope === "server_model" || scope === "server_config" || scope === "server_channels") {
      const tomoriState = await getCachedTomoriState(serverDiscId);

      if (!tomoriState) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.tomori_not_setup_title",
          descriptionKey: "general.errors.tomori_not_setup_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (scope === "server_model") {
        await showServerModelStatus(client, interaction, serverDiscId, tomoriState, locale);
        return;
      }

      if (scope === "server_config") {
        await showServerConfigStatus(client, interaction, tomoriState, locale);
        return;
      }

      await showServerChannelsStatus(client, interaction, serverDiscId, tomoriState, locale);
      return;
    }

    log.error(`Invalid status scope received: ${scope}`);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  } catch (error) {
    log.error(`Error executing status command for scope ${scope}:`, error, {
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "status",
        scope,
        guildDiscordId: serverDiscId,
      },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
