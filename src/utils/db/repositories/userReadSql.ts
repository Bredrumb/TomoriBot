import { userSchema, type UserRow } from "@/types/db/schema";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
export async function loadUserRow(userDiscId: string): Promise<UserRow | null> {
  return await withCachedPlanRetry(async () => {
    try {
      const rows = await sql`
				SELECT * FROM users
				WHERE user_disc_id = ${userDiscId}
				LIMIT 1
			`;

      if (!rows.length) {
        return null;
      }

      // Validate the row against the schema
      const parsedUser = userSchema.safeParse(rows[0]);
      if (!parsedUser.success) {
        log.error(`Failed to validate user data for ID ${userDiscId}:`, parsedUser.error.flatten());
        return null;
      }

      return parsedUser.data;
    } catch (error) {
      log.error(`Error loading user row for ID ${userDiscId}:`, error);
      return null;
    }
  }, `load user row for ID ${userDiscId}`);
}

/**
 * Loads user rows whose saved nickname exactly matches the provided normalized nickname.
 * Matching is case-insensitive, trims leading/trailing whitespace, and collapses repeated whitespace.
 * @param normalizedNickname - Pre-normalized nickname to match against
 * @returns Array of validated UserRow objects
 */
export async function loadUserRowsByNormalizedNickname(normalizedNickname: string): Promise<UserRow[]> {
  return (
    (await withCachedPlanRetry(async () => {
      try {
        const nickname = normalizedNickname.trim().toLowerCase().replace(/\s+/g, " ");
        if (!nickname) {
          return [];
        }

        const rows = await sql`
				SELECT *
				FROM users
				WHERE regexp_replace(lower(trim(user_nickname)), '[[:space:]]+', ' ', 'g') = ${nickname}
			`;

        const parsedUsers: UserRow[] = [];
        for (const row of rows) {
          const parsedUser = userSchema.safeParse(row);
          if (!parsedUser.success) {
            log.error(
              `Failed to validate user data while matching nickname "${normalizedNickname}":`,
              parsedUser.error.flatten(),
            );
            continue;
          }
          parsedUsers.push(parsedUser.data);
        }

        return parsedUsers;
      } catch (error) {
        log.error(`Error loading user rows for nickname "${normalizedNickname}":`, error);
        return [];
      }
    }, `load user rows for nickname ${normalizedNickname}`)) ?? []
  );
}

/**
 * Loads persona-scoped config row for a specific persona.
 * @param tomoriId - Internal persona ID.
 * @returns PersonaConfigRow or null if not found/invalid.
 */
export async function isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
  try {
    // Use EXISTS for efficiency - now using user_disc_id directly
    const result = await sql`
			SELECT EXISTS (
				SELECT 1
				FROM personalization_blacklist pb
				JOIN servers s ON pb.server_id = s.server_id
				WHERE s.server_disc_id = ${serverDiscId}
				AND pb.user_disc_id = ${userDiscId}
			) as "exists";
		`;

    // Bun's sql returns [{ exists: true }] or [{ exists: false }]
    // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists
    return result[0]!.exists;
  } catch (error) {
    log.error(`Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`, error);
    return false; // Default to false on error to avoid blocking personalization unintentionally
  }
}

/**
 * Gets the privacy level for a user globally.
 * This determines what personalization features are available to the user.
 *
 * Privacy levels:
 * - Level 0 (MINIMAL): Full personalization, all features enabled
 * - Level 1 (PARTIAL): Messages visible but no personal memory access by LLM
 * - Level 2 (FULL): Completely invisible, cannot trigger bot
 *
 * @param userDiscId - The Discord ID of the user to check
 * @returns The user's privacy level (0, 1, or 2), defaults to 0 (MINIMAL) if user not found
 */
export async function getPrivacyLevel(userDiscId: string): Promise<import("@/types/db/schema").PrivacyLevel> {
  const { PrivacyLevel } = await import("@/types/db/schema");

  try {
    // 1. Query user's privacy level
    const result = await sql`
			SELECT privacy_level
			FROM users
			WHERE user_disc_id = ${userDiscId}
			LIMIT 1
		`;

    // 2. If user doesn't exist, return MINIMAL (default - most permissive)
    if (!result.length) {
      return PrivacyLevel.MINIMAL;
    }

    // 3. Validate and return the privacy level
    // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists when length > 0
    const level = result[0]!.privacy_level;
    if (![0, 1, 2].includes(level)) {
      log.warn(`Invalid privacy level ${level} for user ${userDiscId}, defaulting to MINIMAL`);
      return PrivacyLevel.MINIMAL;
    }

    return level as import("@/types/db/schema").PrivacyLevel;
  } catch (error) {
    log.error(`Error checking privacy level for user ${userDiscId}:`, error);
    return PrivacyLevel.MINIMAL; // Default to most permissive on error
  }
}

/**
 * Backward compatibility helper: checks if user has opted out (Level 2 = FULL privacy)
 * @deprecated Use getPrivacyLevel() instead for granular privacy checking
 * @param userDiscId - The Discord ID of the user to check
 * @returns True if user is at Level 2 (FULL privacy), false otherwise
 */
export async function isPrivacyOptedOut(userDiscId: string): Promise<boolean> {
  const { PrivacyLevel } = await import("@/types/db/schema");
  const level = await getPrivacyLevel(userDiscId);
  return level === PrivacyLevel.FULL;
}

/**
 * Get user's cross-server short-term memory sharing preference
 *
 * Phase 4: User Controls & Privacy
 *
 * @param userDiscId - Discord user ID
 * @returns True if user has opted in to cross-server sharing, false otherwise
 */
export async function getCrossServerShortTermMemoryOptIn(userDiscId: string): Promise<boolean> {
  try {
    // 1. Try to get from user cache
    const { getCachedUserRow } = await import("@/utils/cache/userCache");
    const cached = await getCachedUserRow(userDiscId);
    if (cached) {
      return cached.shortterm_cache_crossserver_opt_in;
    }

    // 2. Query database if not in cache
    const [user] = await sql`
			SELECT shortterm_cache_crossserver_opt_in
			FROM users
			WHERE user_disc_id = ${userDiscId}
		`;

    return user?.shortterm_cache_crossserver_opt_in ?? false;
  } catch (error) {
    log.error(`Error checking cross-server short-term memory opt-in for user ${userDiscId}:`, error);
    return false; // Default to disabled on error
  }
}

/**
 * Loads all custom emojis for a given server.
 * @param internalServerId - The internal database ID of the server.
 * @returns An array of validated ServerEmojiRow objects, or null if none found or error.
 */
