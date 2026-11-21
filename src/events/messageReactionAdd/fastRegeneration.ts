import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import { takeFastRegeneration } from "@/utils/discord/fastRegeneration";

export default async function fastRegeneration(
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot || reaction.emoji.id || !reaction.message.guildId) return;
  const action = takeFastRegeneration(reaction.message.id, user.id, reaction.emoji.name);
  if (!action) return;

  const reply = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const member = await reply.guild?.members.fetch(user.id);
  if (!member) return;
  await tomoriChat({
    client,
    message: action.request.action === "retry" ? action.trigger : reply,
    isFromQueue: false,
    isManuallyTriggered: true,
    selectedPersonaId: action.personaId,
    textQuotaTriggerKey: `fast-regeneration:${reply.id}`,
    textQuotaUserDiscId: user.id,
    suppressSelfReply: true,
    manualTriggerInvoker: {
      userDiscId: user.id,
      username: member.user.username,
      locale: reply.guild?.preferredLocale ?? "en-US",
      member,
    },
    fastRegeneration: action.request,
  });
}
