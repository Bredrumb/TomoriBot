/**
 * One-time chat-proxy identity bio seeding into personal memories.
 * Runs once at an identity's first registration. Later service-side bio edits
 * do not rewrite memory that the user may already have curated.
 */
import { invalidateUserCache } from "@/utils/cache/userCache";
import { personalMemoryRepository } from "@/utils/db/repositories/PersonalMemoryRepository";
import { log } from "@/utils/misc/logger";
import { getChatProxyHostProtection } from "@/utils/chatProxy/hostProtection";

const DEFAULT_BIO_SEED_MAX_CHARS = 1000;

/** Read lazily per call (never cached at module load) so tests can set the env before a dynamic import. */
function getBioSeedMaxChars(): number {
  const parsed = Number.parseInt(process.env.CHAT_PROXY_BIO_SEED_MAX_CHARS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BIO_SEED_MAX_CHARS;
}

/**
 * Composes the one-time bio-seed memory string: a single-line snapshot of a
 * chat-proxy identity's bio, truncated to `CHAT_PROXY_BIO_SEED_MAX_CHARS`.
 */
export function composeChatProxyBioSeedContent(description: string): string {
  // Whitespace-flattened: memories render semicolon-joined on a single line, so
  // an embedded newline would break the surrounding block.
  const flattened = description.replace(/\s+/g, " ").trim();
  const maxChars = getBioSeedMaxChars();
  return flattened.length > maxChars ? flattened.slice(0, maxChars) : flattened;
}

export type ChatProxyBioSeedArgs = {
  /** Gate: only an identity's first-ever registration is eligible to seed */
  isNewIdentity: boolean;
  /** Synthetic identity ID the memory is written under and whose cache is invalidated */
  identityUserDiscId: string;
  /** Internal `users.user_id` for the synthetic row */
  identityUserId: number;
  /** Raw chat-proxy identity bio; empty/nullish means nothing to seed */
  description: string | null | undefined;
  serverDiscId: string | null | undefined;
};

/** Injectable seams for unit testing; production callers omit this and get the real implementations. */
export type ChatProxyBioSeedDeps = {
  getHostProtection: typeof getChatProxyHostProtection;
  addPersonalMemory: (userId: number, personaLineageId: number, content: string) => Promise<unknown>;
  invalidateCache: typeof invalidateUserCache;
};

const defaultDeps: ChatProxyBioSeedDeps = {
  getHostProtection: getChatProxyHostProtection,
  addPersonalMemory: (userId, personaLineageId, content) =>
    personalMemoryRepository.add(userId, personaLineageId, content),
  invalidateCache: invalidateUserCache,
};

/**
 * Seeds a newly-registered chat-proxy identity's bio as a single personal
 * memory (lineage 0), once ever. No-ops when `isNewIdentity` is false, the bio
 * is empty, the host is protected (FULL privacy / blacklisted), or the
 * personal-memory limit is exhausted. Callers must fire this without
 * awaiting, because it must never delay admission and failures must never
 * surface to the triggering reply.
 */
export async function seedChatProxyIdentityBio(
  args: ChatProxyBioSeedArgs,
  deps: ChatProxyBioSeedDeps = defaultDeps,
): Promise<void> {
  if (!args.isNewIdentity) {
    return;
  }

  const description = args.description?.trim();
  if (!description) {
    return;
  }

  const protection = await deps.getHostProtection(args.identityUserDiscId, args.serverDiscId);
  if (protection.protected) {
    return;
  }

  const content = composeChatProxyBioSeedContent(description);
  const inserted = await deps.addPersonalMemory(args.identityUserId, 0, content);
  if (!inserted) {
    log.info(
      `Skipped chat-proxy bio seed for ${args.identityUserDiscId}: personal memory limit reached or content invalid`,
    );
    return;
  }

  deps.invalidateCache(args.identityUserDiscId);
}
