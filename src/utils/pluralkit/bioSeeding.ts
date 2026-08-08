/**
 * One-time PluralKit member bio seeding into personal memories.
 * See plans/pluralkit-integration.md §7.7 (v1: raw single-memory seed, no LLM
 * extraction, which is deferred to §11). Runs exactly once, at a member's
 * first-ever registration; later bio edits on PluralKit never propagate.
 */
import { invalidateUserCache } from "@/utils/cache/userCache";
import { personalMemoryRepository } from "@/utils/db/repositories/PersonalMemoryRepository";
import { log } from "@/utils/misc/logger";
import { getPluralKitHostProtection } from "@/utils/pluralkit/hostProtection";

const DEFAULT_BIO_SEED_MAX_CHARS = 1000;

/** Read lazily per call (never cached at module load) so tests can set the env before a dynamic import. */
function getBioSeedMaxChars(): number {
  const parsed = Number.parseInt(process.env.PLURALKIT_BIO_SEED_MAX_CHARS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BIO_SEED_MAX_CHARS;
}

/**
 * Composes the one-time bio-seed memory string: a single-line snapshot of a
 * PluralKit member's bio, truncated to `PLURALKIT_BIO_SEED_MAX_CHARS`.
 */
export function composePluralKitBioSeedContent(description: string): string {
  // Whitespace-flattened: memories render semicolon-joined on a single line, so
  // an embedded newline would break the surrounding block.
  const flattened = description.replace(/\s+/g, " ").trim();
  const maxChars = getBioSeedMaxChars();
  return flattened.length > maxChars ? flattened.slice(0, maxChars) : flattened;
}

export type PluralKitBioSeedArgs = {
  /** Gate: only a member's first-ever registration is eligible to seed */
  isNewMember: boolean;
  /** Synthetic `pk:{uuid}` Discord ID the memory is written under and whose cache is invalidated */
  memberUserDiscId: string;
  /** Internal `users.user_id` for the member's synthetic row */
  memberUserId: number;
  /** Raw PluralKit member bio; empty/nullish means nothing to seed */
  description: string | null | undefined;
  serverDiscId: string | null | undefined;
};

/** Injectable seams for unit testing; production callers omit this and get the real implementations. */
export type PluralKitBioSeedDeps = {
  getHostProtection: typeof getPluralKitHostProtection;
  addPersonalMemory: (userId: number, personaLineageId: number, content: string) => Promise<unknown>;
  invalidateCache: typeof invalidateUserCache;
};

const defaultDeps: PluralKitBioSeedDeps = {
  getHostProtection: getPluralKitHostProtection,
  addPersonalMemory: (userId, personaLineageId, content) =>
    personalMemoryRepository.add(userId, personaLineageId, content),
  invalidateCache: invalidateUserCache,
};

/**
 * Seeds a newly-registered PluralKit member's bio as a single personal
 * memory (lineage 0), once ever. No-ops when `isNewMember` is false, the bio
 * is empty, the host is protected (FULL privacy / blacklisted), or the
 * personal-memory limit is exhausted. Callers must fire this without
 * awaiting, because it must never delay admission and failures must never
 * surface to the triggering reply.
 */
export async function seedPluralKitMemberBio(
  args: PluralKitBioSeedArgs,
  deps: PluralKitBioSeedDeps = defaultDeps,
): Promise<void> {
  if (!args.isNewMember) {
    return;
  }

  const description = args.description?.trim();
  if (!description) {
    return;
  }

  const protection = await deps.getHostProtection(args.memberUserDiscId, args.serverDiscId);
  if (protection.protected) {
    return;
  }

  const content = composePluralKitBioSeedContent(description);
  const inserted = await deps.addPersonalMemory(args.memberUserId, 0, content);
  if (!inserted) {
    log.info(
      `Skipped PluralKit bio seed for ${args.memberUserDiscId}: personal memory limit reached or content invalid`,
    );
    return;
  }

  deps.invalidateCache(args.memberUserDiscId);
}
