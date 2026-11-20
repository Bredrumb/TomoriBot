import { getCachedBlacklistStatus } from "@/utils/cache/userCache";

// /comment stays unblocked because it posts a static user-attributed embed with no LLM generation, persona dialogue,
// or context ingestion.
const BLACKLIST_GATED_COMMAND_PREFIXES: readonly string[] = [
  "respond",
  "reward",
  "punish",
  "impersonate",
  "generate",
  "booru",
  "compact",
  "learn",
  "conditioning",
  "kill",
  "refresh",
  "novelai generate",
  "tool prompt",
  "tool delete",
  "persona create",
  "persona generate",
];

export function isBlacklistGatedCommand(
  commandName: string,
  groupName: string | null,
  subcommandName: string | null,
): boolean {
  const path = [commandName, groupName, subcommandName].filter(Boolean).join(" ");
  return BLACKLIST_GATED_COMMAND_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix} `));
}

// Underlying per-user blacklist cache fails closed, so unreadable entries count as blacklisted and DB blips hide
// authors rather than lifting bans.
export async function resolveBlacklistedAuthorIds(
  serverDiscId: string,
  authorIds: Iterable<string>,
): Promise<Set<string>> {
  const uniqueIds = [...new Set(authorIds)];
  const statuses = await Promise.all(uniqueIds.map((id) => getCachedBlacklistStatus(serverDiscId, id)));
  return new Set(uniqueIds.filter((_, index) => statuses[index]));
}
