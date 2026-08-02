import type { Client } from "discord.js";
import type { ContextReferenceCandidate } from "@/utils/db/repositories/UserRepository";
import { userRepository } from "@/utils/db/repositories";

export interface UserReferenceCandidateQuery {
  serverDiscId: string;
  candidateDiscordIds: readonly string[];
  normalizedHistoryText: string;
}

export interface UserReferenceCandidateSource {
  loadCandidates(query: UserReferenceCandidateQuery): Promise<readonly ContextReferenceCandidate[]>;
}

export interface ReferenceMemberIdentity {
  discordId: string;
  bot: boolean;
  displayName: string;
  nickname: string | null;
  globalName: string | null;
  username: string;
}

export interface ParticipantMemberDirectory {
  cachedMemberIds(): readonly string[];
  resolveMember(discordId: string): Promise<ReferenceMemberIdentity | null>;
}

export const repositoryUserReferenceCandidateSource: UserReferenceCandidateSource = {
  loadCandidates: (query) =>
    userRepository.loadContextReferenceCandidates({
      serverDiscId: query.serverDiscId,
      candidateDiscordIds: [...query.candidateDiscordIds],
      normalizedHistoryText: query.normalizedHistoryText,
    }),
};

export function createDiscordParticipantMemberDirectory(
  client: Client,
  guildId: string,
): ParticipantMemberDirectory | null {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  return {
    cachedMemberIds: () => [...guild.members.cache.keys()],
    resolveMember: async (discordId) => {
      const member = guild.members.cache.get(discordId) ?? (await guild.members.fetch(discordId).catch(() => null));
      if (!member) return null;
      return {
        discordId: member.id,
        bot: member.user.bot,
        displayName: member.displayName,
        nickname: member.nickname,
        globalName: member.user.globalName,
        username: member.user.username,
      };
    },
  };
}
