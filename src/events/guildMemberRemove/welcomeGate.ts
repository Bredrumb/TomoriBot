import type { Client, GuildMember, PartialGuildMember } from "discord.js";
import { notifyWelcomeGateMemberRemove } from "@/events/guildMemberAdd/helpers/welcomeGate";

const handler = async (_client: Client, member: GuildMember | PartialGuildMember): Promise<void> => {
  notifyWelcomeGateMemberRemove(member.guild.id, member.id);
};

export default handler;
