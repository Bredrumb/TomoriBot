/**
 * UserRepository — manages the `users` and `personalization_blacklist` tables.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { ErrorContext, PrivacyLevel, UserRow } from "@/types/db/schema";
import { PrivacyLevel as PrivacyLevelValue, userSchema } from "@/types/db/schema";
import type { PersonalSettingsExportData } from "@/types/db/dataExport";
import { personalSettingsExportDataSchema } from "@/types/db/dataExport";
import { getCachedUserRow, invalidateUserCache, invalidateUserBlacklistCache } from "@/utils/cache/userCache";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { validateUserFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import type { IRepository } from "./IRepository";

/** Export shape for a single user's portable settings. */
export type UserExportShape = PersonalSettingsExportData;

export class UserRepository implements IRepository<UserExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads a user row by Discord ID.
   *
   * @param userDiscId - Discord user snowflake
   * @returns UserRow or null if not found
   */
  async loadByDiscordId(userDiscId: string): Promise<UserRow | null> {
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
   * Finds users whose stored nickname matches the normalized form of the given string.
   *
   * @param normalizedNickname - Pre-normalized (lowercased, trimmed) nickname
   * @returns Array of matching UserRow objects
   */
  async findByNormalizedNickname(normalizedNickname: string): Promise<UserRow[]> {
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
   * Returns the user's privacy level (0 = MINIMAL, 1 = PARTIAL, 2 = FULL).
   * Defaults to MINIMAL if user not found.
   *
   * @param userDiscId - Discord user snowflake
   */
  async getPrivacyLevel(userDiscId: string): Promise<PrivacyLevel> {
    try {
      const result = await sql`
        SELECT privacy_level
        FROM users
        WHERE user_disc_id = ${userDiscId}
        LIMIT 1
      `;

      if (!result.length) {
        return PrivacyLevelValue.MINIMAL;
      }

      // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists when length > 0.
      const level = result[0]!.privacy_level;
      if (![0, 1, 2].includes(level)) {
        log.warn(`Invalid privacy level ${level} for user ${userDiscId}, defaulting to MINIMAL`);
        return PrivacyLevelValue.MINIMAL;
      }

      return level as PrivacyLevel;
    } catch (error) {
      log.error(`Error checking privacy level for user ${userDiscId}:`, error);
      return PrivacyLevelValue.MINIMAL;
    }
  }

  /**
   * Returns true if the user has opted out of all personalization (privacy level FULL).
   *
   * @deprecated Use getPrivacyLevel() for granular checks.
   * @param userDiscId - Discord user snowflake
   */
  async isPrivacyOptedOut(userDiscId: string): Promise<boolean> {
    const level = await this.getPrivacyLevel(userDiscId);
    return level === PrivacyLevelValue.FULL;
  }

  /**
   * Returns the user's cross-server short-term memory sharing preference.
   *
   * @param userDiscId - Discord user snowflake
   */
  async getCrossServerShmOptIn(userDiscId: string): Promise<boolean> {
    try {
      const cached = await getCachedUserRow(userDiscId);
      if (cached) {
        return cached.shortterm_cache_crossserver_opt_in;
      }

      const [user] = await sql`
        SELECT shortterm_cache_crossserver_opt_in
        FROM users
        WHERE user_disc_id = ${userDiscId}
      `;

      return user?.shortterm_cache_crossserver_opt_in ?? false;
    } catch (error) {
      log.error(`Error checking cross-server short-term memory opt-in for user ${userDiscId}:`, error);
      return false;
    }
  }

  /**
   * Returns true if the user is blacklisted from a specific server.
   *
   * @param serverDiscId - Discord server snowflake
   * @param userDiscId   - Discord user snowflake
   */
  async isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
    try {
      const result = await sql`
        SELECT EXISTS (
          SELECT 1
          FROM personalization_blacklist pb
          JOIN servers s ON pb.server_id = s.server_id
          WHERE s.server_disc_id = ${serverDiscId}
          AND pb.user_disc_id = ${userDiscId}
        ) as "exists";
      `;

      // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists.
      return result[0]!.exists;
    } catch (error) {
      log.error(`Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`, error);
      return false;
    }
  }

  /**
   * Returns the list of blacklisted user Discord IDs for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBlacklistedMemberIds(serverId: number): Promise<string[]> {
    try {
      const result = await sql`
        SELECT user_disc_id FROM personalization_blacklist
        WHERE server_id = ${serverId}
        ORDER BY user_disc_id ASC
      `;

      if (!result || result.length === 0) {
        return [];
      }

      const memberIds = result.map((row: unknown) => (row as { user_disc_id: string }).user_disc_id);
      log.info(`Found ${memberIds.length} blacklisted members for server ${serverId}`);
      return memberIds;
    } catch (error) {
      log.error(`Error loading blacklisted members for server ${serverId}:`, error);
      return [];
    }
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Registers a user (upsert — preserves existing nickname and preferences on conflict).
   * Invalidates the user cache after write.
   *
   * @param userDiscId  - Discord user snowflake
   * @param displayName - Displayed nickname from Discord
   * @param language    - Registration locale
   * @returns UserRow on success, null on failure
   */
  async register(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
    const user = await this.registerUserRow(userDiscId, displayName, language);
    if (user) invalidateUserCache(userDiscId);
    return user;
  }

  /**
   * Sets the user's global privacy level.
   * Invalidates the user cache after write.
   *
   * @param userDiscId - Discord user snowflake
   * @param level      - Privacy level to set
   * @returns Updated UserRow or null on failure
   */
  async setPrivacyLevel(userDiscId: string, level: PrivacyLevel): Promise<UserRow | null> {
    const user = await this.setPrivacyLevelRow(userDiscId, level);
    if (user) invalidateUserCache(userDiscId);
    return user;
  }

  /**
   * @deprecated Use setPrivacyLevel() directly.
   */
  async setPrivacyOptOut(userDiscId: string, optedOut: boolean): Promise<UserRow | null> {
    const level = optedOut ? PrivacyLevelValue.FULL : PrivacyLevelValue.MINIMAL;
    return this.setPrivacyLevel(userDiscId, level);
  }

  /**
   * Toggles cross-server short-term memory opt-in for a user.
   * Invalidates the user cache after write.
   *
   * @param userDiscId - Discord user snowflake
   * @returns New opt-in state
   */
  async toggleCrossServerShmOptIn(userDiscId: string): Promise<boolean> {
    try {
      const [updated] = await sql`
        UPDATE users
        SET shortterm_cache_crossserver_opt_in = NOT shortterm_cache_crossserver_opt_in
        WHERE user_disc_id = ${userDiscId}
        RETURNING shortterm_cache_crossserver_opt_in
      `;

      invalidateUserCache(userDiscId);
      return updated?.shortterm_cache_crossserver_opt_in ?? false;
    } catch (error) {
      log.error(`Error toggling cross-server short-term memory opt-in for user ${userDiscId}:`, error);
      throw error;
    }
  }

  /**
   * Updates arbitrary user fields. Validates against the user schema before writing.
   * Invalidates the user cache after write.
   *
   * @param userId   - Internal user DB ID
   * @param userData - Partial UserRow with fields to update
   * @returns Updated UserRow or null on failure
   */
  async update(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
    const user = await this.updateUserRow(userId, userData);
    if (user) invalidateUserCache(user.user_disc_id);
    return user;
  }

  /**
   * Removes a user's blacklist entry in a specific server.
   * Invalidates only the per-server blacklist cache slot.
   *
   * @param serverId   - Internal server DB ID
   * @param userDiscId - Discord user snowflake
   * @returns true on success
   */
  async removeBlacklistEntry(serverId: number, userDiscId: string, serverDiscId: string): Promise<boolean> {
    try {
      await sql`
        DELETE FROM personalization_blacklist
        WHERE server_id = ${serverId} AND user_disc_id = ${userDiscId}
      `;
      invalidateUserBlacklistCache(serverDiscId, userDiscId);
      return true;
    } catch (error) {
      log.error(`Error removing blacklist entry for user ${userDiscId} in server ${serverId}:`, error);
      return false;
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports a user's portable settings for data portability (GDPR etc.).
   * The ownerId is the Discord snowflake of the user.
   *
   * @param ownerId - Discord user snowflake
   * @returns UserExportShape or null if the user has no data
   */
  async toExportShape(ownerId: string | number): Promise<UserExportShape | null> {
    const userDiscId = String(ownerId);
    const user = await this.loadByDiscordId(userDiscId);
    if (!user) return null;

    return {
      user_nickname: user.user_nickname,
      language_pref: user.language_pref,
      impersonation_prompt: user.impersonation_prompt ?? null,
      privacy_level: user.privacy_level,
      personal_dtm: (user.personal_dtm as "off" | "follow" | "on") ?? undefined,
      shortterm_cache_crossserver_opt_in: user.shortterm_cache_crossserver_opt_in,
      nai_char_tags: user.nai_char_tags ?? [],
      nai_char_ref_url: user.nai_char_ref_url ?? null,
    };
  }

  /**
   * Imports a previously exported user settings shape, merging into the existing row.
   * Creates the user row first if it doesn't exist.
   *
   * @param ownerId - Discord user snowflake
   * @param data    - Previously exported UserExportShape
   * @returns true on success, false on validation or write failure
   */
  async fromExportShape(ownerId: string | number, data: UserExportShape): Promise<boolean> {
    const userDiscId = String(ownerId);
    const validated = personalSettingsExportDataSchema.safeParse(data);
    if (!validated.success) {
      log.error(`UserRepository.fromExportShape: invalid data for ${userDiscId}:`, validated.error.flatten());
      return false;
    }

    const parsed = validated.data;

    try {
      // Ensure the user row exists before updating
      await this.registerUserRow(userDiscId, parsed.user_nickname, parsed.language_pref);

      const user = await this.loadByDiscordId(userDiscId);
      if (!user?.user_id) return false;

      await this.updateUserRow(user.user_id, {
        user_nickname: parsed.user_nickname,
        language_pref: parsed.language_pref,
        impersonation_prompt: parsed.impersonation_prompt ?? undefined,
        privacy_level: parsed.privacy_level,
        personal_dtm: parsed.personal_dtm,
        shortterm_cache_crossserver_opt_in: parsed.shortterm_cache_crossserver_opt_in,
        nai_char_tags: parsed.nai_char_tags,
        nai_char_ref_url: parsed.nai_char_ref_url ?? undefined,
      });

      invalidateUserCache(userDiscId);
      return true;
    } catch (error) {
      log.error(`UserRepository.fromExportShape: write failed for ${userDiscId}:`, error);
      return false;
    }
  }

  private async registerUserRow(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
    try {
      log.info(`Ensuring user ${userDiscId} exists (${displayName})`);

      const [userData] = await sql`
        WITH inserted_user AS (
          INSERT INTO users (
            user_disc_id,
            user_nickname,
            language_pref,
            registration_locale
          ) VALUES (
            ${userDiscId},
            ${displayName},
            ${language},
            ${language}
          )
          ON CONFLICT (user_disc_id) DO NOTHING
          RETURNING *
        )
        SELECT *
        FROM inserted_user
        UNION ALL
        SELECT *
        FROM users
        WHERE user_disc_id = ${userDiscId}
          AND NOT EXISTS (SELECT 1 FROM inserted_user)
        LIMIT 1
      `;

      const validatedUser = userSchema.safeParse(userData);
      if (!validatedUser.success) {
        log.error(`Failed to validate registered user data for ${userDiscId}:`, validatedUser.error);
        return null;
      }

      return validatedUser.data;
    } catch (error) {
      log.error(`Error registering user ${userDiscId}:`, error);
      return null;
    }
  }

  private async setPrivacyLevelRow(userDiscId: string, level: PrivacyLevel): Promise<UserRow | null> {
    try {
      log.info(`Setting privacy level to ${level} for user ${userDiscId}`);

      if (![0, 1, 2].includes(level)) {
        log.error(`Invalid privacy level ${level} for user ${userDiscId}`);
        return null;
      }

      const [userData] = await sql`
        UPDATE users
        SET privacy_level = ${level}
        WHERE user_disc_id = ${userDiscId}
        RETURNING *
      `;

      if (!userData) {
        log.warn(`Cannot set privacy level: User ${userDiscId} not found in database`);
        return null;
      }

      const validatedUser = userSchema.safeParse(userData);
      if (!validatedUser.success) {
        log.error(`Failed to validate user data after privacy update for ${userDiscId}:`, validatedUser.error);
        return null;
      }

      log.success(`Privacy level successfully set to ${level} for user ${userDiscId}`);
      return validatedUser.data;
    } catch (error) {
      log.error(`Error setting privacy level for user ${userDiscId}:`, error);
      return null;
    }
  }

  private async updateUserRow(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
    try {
      const validUserData = userSchema.partial().parse(userData);
      const fields = Object.keys(validUserData).filter((key) => key !== "user_id" && key in userData);

      if (fields.length === 0) {
        log.warn(`No fields provided to update for user_id: ${userId}`);
        return null;
      }

      validateUserFields(fields);

      const setParts: string[] = [];
      const values: SqlParameterArray = [];

      fields.forEach((field, index) => {
        setParts.push(`${field} = $${index + 1}`);
        const rawValue = validUserData[field as keyof typeof validUserData];
        if (Array.isArray(rawValue)) {
          const escaped = rawValue.map((value) => `"${String(value).replace(/(["\\])/g, "\\$1")}"`);
          values.push(`{${escaped.join(",")}}`);
        } else {
          values.push(rawValue);
        }
      });

      const setClause = setParts.join(", ");
      const finalPlaceholderIndex = values.length + 1;
      values.push(userId);

      const result = await sql.unsafe(
        `
          UPDATE users
          SET ${setClause}
          WHERE user_id = $${finalPlaceholderIndex}
          RETURNING *
        `,
        values,
      );

      if (!result.length) {
        const context: ErrorContext = {
          userId,
          errorType: "DatabaseUpdateError",
          metadata: {
            operation: "updateUser",
            fields,
          },
        };
        await log.error(`No user found with id: ${userId}`, new Error("User not found"), context);
        return null;
      }

      const updatedUser = userSchema.safeParse(result[0]);
      if (!updatedUser.success) {
        const context: ErrorContext = {
          userId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "updateUser",
            validationErrors: updatedUser.error.flatten(),
          },
        };
        await log.error(`Failed to validate updated user for id: ${userId}`, updatedUser.error, context);
        return null;
      }

      return updatedUser.data;
    } catch (error) {
      const context: ErrorContext = {
        userId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateUser",
        },
      };
      await log.error(`Error updating user for id: ${userId}`, error, context);
      return null;
    }
  }
}

/** Singleton instance — import this in callers. */
export const userRepository = new UserRepository();
