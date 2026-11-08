import type { GuildMember } from "discord.js";

export function getMemberRoleNames(member: GuildMember, guildId: string): string[] {
  return member.roles.cache
    .filter((role) => role.id !== guildId && role.name !== "@everyone")
    .sort((left, right) => right.position - left.position)
    .map((role) => role.name);
}
