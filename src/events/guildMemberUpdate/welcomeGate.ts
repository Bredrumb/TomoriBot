import type { Client, GuildMember } from "discord.js";
import { notifyWelcomeGateMemberUpdate } from "@/events/guildMemberAdd/helpers/welcomeGate";

// _oldMember is ignored because sweeping guild members from cache makes the prior state unreliable.
const handler = async (_client: Client, _oldMember: GuildMember, newMember: GuildMember): Promise<void> => {
  notifyWelcomeGateMemberUpdate(newMember);
};

export default handler;
