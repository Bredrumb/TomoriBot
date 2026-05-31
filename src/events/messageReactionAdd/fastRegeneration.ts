import type { Client, MessageReaction, User } from "discord.js";
import { getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { deletePersonaTurnAndMaybeRegenerate } from "@/utils/discord/deletePersonaTurn";
import {
  consumeFastRegenerationEntry,
  FAST_ACTION_EMOJIS,
  FAST_CONTINUE_EMOJI,
  FAST_REGENERATION_EMOJI,
  getEnabledFastRegenerationActions,
  normalizeFastActionEmoji,
  peekFastRegenerationEntry,
} from "@/utils/discord/fastRegeneration";
import { log } from "@/utils/misc/logger";
import tomoriChat from "@/events/messageCreate/tomoriChat";

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

  const reactionEmoji = reaction.emoji.name;
  const actionEmoji = normalizeFastActionEmoji(reactionEmoji);
  if (user.bot || !actionEmoji || !FAST_ACTION_EMOJIS.has(reactionEmoji ?? "")) {
    return;
  }

  let message = reaction.message;
  try {
    if (message.partial) {
      message = await message.fetch();
    }
  } catch (error) {
    log.warn("[fastRegeneration] Failed to fetch partial message", error);
    return;
  }

  if (!message.guild || !message.guildId) {
    return;
  }

  const entry = peekFastRegenerationEntry(message.id);
  if (!entry || entry.guildId !== message.guildId || entry.channelId !== message.channelId) {
    return;
  }

  if (!entry.enabledActions.includes(actionEmoji)) {
    try {
      await reaction.users.remove(user.id);
    } catch (error) {
      log.warn(`[fastRegeneration] Failed to remove disabled action reaction from userId=${user.id}`, error);
    }
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
    for (const emoji of FAST_ACTION_EMOJIS) {
      const actionReaction = message.reactions.cache.get(emoji) ?? message.reactions.resolve(emoji);
      await actionReaction?.users.remove(user.id);
      if (client.user?.id) {
        await actionReaction?.users.remove(client.user.id);
      }
    }
  } catch {
    // The message may already be gone once regeneration begins.
  }

  const tomoriState = await getCachedMainPersona(message.guildId);
  const enabledActions = tomoriState ? getEnabledFastRegenerationActions(tomoriState.config) : [];
  if (!tomoriState || !enabledActions.includes(actionEmoji)) {
    log.warn(`[fastRegeneration] Cannot handle messageId=${message.id}: Tomori is not configured or feature is off`);
    return;
  }

  if (actionEmoji === FAST_CONTINUE_EMOJI) {
    void tomoriChat(
      client,
      message,
      false,
      true,
      false,
      undefined,
      undefined,
      false,
      0,
      false,
      undefined,
      undefined,
      consumedEntry.personaId,
      false,
      false,
      undefined,
      "user",
      `continue:${message.id}:${user.id}`,
      consumedEntry.triggerUserId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        userDiscId: consumedEntry.triggerUserId,
        username: consumedEntry.triggerUsername,
        locale: consumedEntry.locale,
        member: consumedEntry.member,
      },
    );
    return;
  }

  if (actionEmoji === FAST_REGENERATION_EMOJI) {
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
}
