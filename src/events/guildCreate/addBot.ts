import { log, ColorCode } from "../../utils/misc/logger";
import { sendStandardEmbed } from "../../utils/discord/embedHelper";
import type { Client, Guild } from "discord.js";
import { findBestChannel } from "@/utils/discord/eventHelper";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";

/**
 * Sends welcome message when bot joins a new guild.
 * Shows setup instructions or welcome back message based on existing data.
 * @param guild - The guild the bot joined
 */
const handler = async (client: Client, guild: Guild): Promise<void> => {
  try {
    log.info(`Bot joined new server: ${guild.name} (${guild.id})`);

    const serverId = await serverRepository.loadServerIdByDiscId(guild.id);

    let tomoriExists = false;
    if (serverId) {
      const personas = await personaRepository.loadServerPersonaSummaries(serverId);
      tomoriExists = personas !== null && personas.length > 0;
    }

    const serverLocale = guild.preferredLocale;
    let channel = guild.systemChannel;
    let sentSuccessfully = false;

    if (channel) {
      try {
        await sendStandardEmbed(channel, serverLocale, {
          titleKey: tomoriExists ? "events.addBot.rejoin_title" : "events.addBot.setup_prompt_title",
          descriptionKey: tomoriExists ? "events.addBot.rejoin_description" : "events.addBot.setup_prompt_description",
          color: tomoriExists ? ColorCode.INFO : ColorCode.WARN,
        });
        sentSuccessfully = true;
        log.success(`Sent welcome message to system channel ${channel.name} in ${guild.name}`);
      } catch (_error) {
        log.warn(`Failed to send to system channel in ${guild.name}, trying fallback`);
      }
    }

    if (!sentSuccessfully) {
      channel = await findBestChannel(guild, client);
      if (!channel) {
        log.error(`No suitable text channel found in guild ${guild.name} (${guild.id})`);
        return;
      }

      await sendStandardEmbed(channel, serverLocale, {
        titleKey: tomoriExists ? "events.addBot.rejoin_title" : "events.addBot.setup_prompt_title",
        descriptionKey: tomoriExists ? "events.addBot.rejoin_description" : "events.addBot.setup_prompt_description",
        color: tomoriExists ? ColorCode.INFO : ColorCode.WARN,
      });

      log.success(`Sent welcome message to fallback channel ${channel.name} in ${guild.name}`);
    }
  } catch (error) {
    log.error(`Error handling guild join for ${guild.id}:`, error);
  }
};

export default handler;
