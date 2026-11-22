import type { Client, GatewayDispatchPayload } from "discord.js";

export default async function syncEmojiAvailability(client: Client, packet: GatewayDispatchPayload): Promise<void> {
  if (packet.t !== "GUILD_EMOJIS_UPDATE" && packet.t !== "GUILD_UPDATE" && packet.t !== "GUILD_CREATE") return;

  const guildId = packet.t === "GUILD_EMOJIS_UPDATE" ? packet.d.guild_id : packet.d.id;
  const cache = client.guilds.cache.get(guildId)?.emojis?.cache;
  if (!cache || !packet.d.emojis) return;

  // Read the raw flag because discord.js 14.25.1 skips availability when comparing gateway emojis with its cache.
  for (const { id, available } of packet.d.emojis) {
    if (!id || typeof available !== "boolean") continue;
    const emoji = cache.get(id);
    if (emoji) emoji.available = available;
  }
}
