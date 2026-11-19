import type { GuildMember } from "discord.js";

const UNKNOWN_MEMBER_ERROR_CODE = 10007;

// Status unverified stays distinct from ended because rate limits or outages mean membership could not be read, so
// callers must not report a departure.
export type WelcomeMembershipCheck =
  | { status: "active"; member: GuildMember }
  | { status: "ended" }
  | { status: "unverified"; error: unknown };

// Live fetch is forced because member caches go stale or get swept, while joinedTimestamp detects a leave-and-rejoin
// with the same ID.
export async function checkWelcomeMembership(originalMember: GuildMember): Promise<WelcomeMembershipCheck> {
  let currentMember: GuildMember;

  try {
    currentMember = await originalMember.guild.members.fetch({ user: originalMember.id, force: true });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === UNKNOWN_MEMBER_ERROR_CODE || code === String(UNKNOWN_MEMBER_ERROR_CODE)) {
      return { status: "ended" };
    }
    return { status: "unverified", error };
  }

  if (currentMember.joinedTimestamp !== originalMember.joinedTimestamp) {
    return { status: "ended" };
  }

  return { status: "active", member: currentMember };
}
