import type { Client, MessageReaction, User } from "discord.js";
import { getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { deletePersonaTurnAndMaybeRegenerate } from "@/utils/discord/deletePersonaTurn";
import {
  consumeFastRegenerationEntry,
  FAST_REGENERATION_EMOJI,
  peekFastRegenerationEntry,
} from "@/utils/discord/fastRegeneration";
import { log } from "@/utils/misc/logger";

export default async function fastRegeneration(
  client: Client,
  reactionArg: MessageReaction,
  userArg: User,
): Promise<void> {
  let reaction = reactionArg;
  let user = userArg;

  try {
    if (reaction.partial) {
      reaction = await reaction.fetch();
    }
    if (user.partial) {
      user = await user.fetch();
    }
  } catch (error) {
    log.warn("[fastRegeneration] Failed to fetch partial reaction/user", error);
    return;
  }

  if (user.bot || reaction.emoji.name !== FAST_REGENERATION_EMOJI) {
    return;
  }

  const message = reaction.message;
  if (!message.guild || !message.guildId) {
    return;
  }

  const entry = peekFastRegenerationEntry(message.id);
  if (!entry || entry.guildId !== message.guildId || entry.channelId !== message.channelId) {
    return;
  }

  if (user.id !== entry.triggerUserId) {
    try {
      await reaction.users.remove(user.id);
    } catch (error) {
      log.warn(`[fastRegeneration] Failed to remove unauthorized reaction from userId=${user.id}`, error);
    }
    return;
  }

  const consumedEntry = consumeFastRegenerationEntry(message.id);
  if (!consumedEntry) {
    return;
  }

  try {
    await reaction.users.remove(user.id);
    if (client.user?.id) {
      await reaction.users.remove(client.user.id);
    }
  } catch {
    // The message may already be gone once deletion begins.
  }

  const tomoriState = await getCachedMainPersona(message.guildId);
  if (!tomoriState) {
    log.warn(`[fastRegeneration] Cannot regenerate messageId=${message.id}: Tomori is not configured`);
    return;
  }

  const result = await deletePersonaTurnAndMaybeRegenerate({
    client,
    guild: message.guild,
    channel: message.channel,
    tomoriState,
    regenerate: true,
    locale: consumedEntry.locale,
    targetPersonaId: consumedEntry.personaId,
    targetMessageId: message.id,
    triggerUserId: consumedEntry.triggerUserId,
    triggerUsername: consumedEntry.triggerUsername,
    triggerMember: consumedEntry.member,
    textQuotaTriggerKey: `regen:${message.id}:${user.id}`,
  });

  if (result.status !== "success" || !result.regenerated) {
    log.warn(
      `[fastRegeneration] Regeneration did not complete for messageId=${message.id}; status=${result.status}, regenerated=${result.regenerated}`,
    );
  }
}
