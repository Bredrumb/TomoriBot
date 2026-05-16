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

// ── Personal spotlight types ───────────────────────────────────────────────────

type PersonalSpotlightAggregateRow = {
  server_id: number | string | bigint;
  user_id: number | string | bigint;
  channel_disc_id: string;
  auto_trigger_tomori_id: number | string | bigint | null;
  expires_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  persona_ids: unknown;
};

export interface PersonalSpotlightStatus {
  serverId: number;
  userId: number;
  channelDiscId: string;
  personaIds: number[];
  autoTriggerPersonaId: number | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

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

  // ── Personal spotlight ────────────────────────────────────────────────────

  /**
   * Upserts a personal spotlight for a user in a channel, replacing all persona
   * associations atomically.
   *
   * @param serverId            - Internal server DB ID
   * @param userId              - Internal user DB ID
   * @param channelDiscId       - Discord channel snowflake
   * @param personaIds          - Tomori IDs to allow in the spotlight
   * @param autoTriggerPersonaId - Tomori ID to auto-trigger, or null
   * @param expiresAt           - Expiry timestamp, or null for permanent
   */
  async replacePersonalSpotlight(
    serverId: number,
    userId: number,
    channelDiscId: string,
    personaIds: number[],
    autoTriggerPersonaId: number | null,
    expiresAt: Date | null,
  ): Promise<void> {
    const uniquePersonaIds = [...new Set(personaIds)].filter(
      (personaId) => Number.isInteger(personaId) && personaId > 0,
    );

    if (uniquePersonaIds.length === 0) {
      throw new Error("Personal spotlight requires at least one persona");
    }

    if (autoTriggerPersonaId !== null && !uniquePersonaIds.includes(autoTriggerPersonaId)) {
      throw new Error("Auto-trigger persona must belong to the spotlight persona set");
    }

    await sql.transaction(async (tx) => {
      await tx`
        INSERT INTO personal_spotlights (
          server_id,
          user_id,
          channel_disc_id,
          auto_trigger_tomori_id,
          expires_at
        )
        VALUES (
          ${serverId},
          ${userId},
          ${channelDiscId},
          ${autoTriggerPersonaId},
          ${expiresAt}
        )
        ON CONFLICT (server_id, user_id, channel_disc_id)
        DO UPDATE SET
          auto_trigger_tomori_id = EXCLUDED.auto_trigger_tomori_id,
          expires_at = EXCLUDED.expires_at,
          updated_at = CURRENT_TIMESTAMP
      `;

      await tx`
        DELETE FROM personal_spotlight_personas
        WHERE server_id = ${serverId}
          AND user_id = ${userId}
          AND channel_disc_id = ${channelDiscId}
      `;

      for (const personaId of uniquePersonaIds) {
        await tx`
          INSERT INTO personal_spotlight_personas (
            server_id,
            user_id,
            channel_disc_id,
            tomori_id
          )
          VALUES (
            ${serverId},
            ${userId},
            ${channelDiscId},
            ${personaId}
          )
        `;
      }
    });
  }

  /**
   * Deletes a personal spotlight entry for a user in a specific channel.
   *
   * @param serverId      - Internal server DB ID
   * @param userId        - Internal user DB ID
   * @param channelDiscId - Discord channel snowflake
   * @returns true if a row was deleted
   */
  async removePersonalSpotlight(serverId: number, userId: number, channelDiscId: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM personal_spotlights
      WHERE server_id = ${serverId}
        AND user_id = ${userId}
        AND channel_disc_id = ${channelDiscId}
    `;

    return result.count > 0;
  }

  /**
   * Loads the current personal spotlight status for a user in a channel, pruning
   * expired entries and orphaned spotlights (no remaining personas) first.
   *
   * @param serverId      - Internal server DB ID
   * @param userId        - Internal user DB ID
   * @param channelDiscId - Discord channel snowflake
   * @returns PersonalSpotlightStatus or null if none active
   */
  async getPersonalSpotlightStatus(
    serverId: number,
    userId: number,
    channelDiscId: string,
  ): Promise<PersonalSpotlightStatus | null> {
    await this.deleteExpiredPersonalSpotlights(serverId, userId, channelDiscId);

    const [row] = await sql<PersonalSpotlightAggregateRow[]>`
      SELECT
        ps.server_id,
        ps.user_id,
        ps.channel_disc_id,
        ps.auto_trigger_tomori_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at,
        COALESCE(
          JSONB_AGG(psp.tomori_id ORDER BY psp.tomori_id) FILTER (WHERE psp.tomori_id IS NOT NULL),
          '[]'::JSONB
        ) AS persona_ids
      FROM personal_spotlights ps
      LEFT JOIN personal_spotlight_personas psp
        ON psp.server_id = ps.server_id
        AND psp.user_id = ps.user_id
        AND psp.channel_disc_id = ps.channel_disc_id
      WHERE ps.server_id = ${serverId}
        AND ps.user_id = ${userId}
        AND ps.channel_disc_id = ${channelDiscId}
      GROUP BY
        ps.server_id,
        ps.user_id,
        ps.channel_disc_id,
        ps.auto_trigger_tomori_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at
    `;

    const status = row ? this.mapAggregateRow(row) : null;
    if (!status) {
      return null;
    }

    if (status.personaIds.length > 0) {
      return status;
    }

    // Orphaned spotlight — remove it so it doesn't accumulate
    await this.removePersonalSpotlight(serverId, userId, channelDiscId);
    return null;
  }

  /**
   * Returns all active personal spotlights for a user in a server, pruning expired
   * and orphaned entries first.
   *
   * @param serverId - Internal server DB ID
   * @param userId   - Internal user DB ID
   * @returns Sorted array of active PersonalSpotlightStatus entries
   */
  async getActivePersonalSpotlightsForUser(serverId: number, userId: number): Promise<PersonalSpotlightStatus[]> {
    await this.deleteExpiredPersonalSpotlights(serverId, userId);

    const rows = await sql<PersonalSpotlightAggregateRow[]>`
      SELECT
        ps.server_id,
        ps.user_id,
        ps.channel_disc_id,
        ps.auto_trigger_tomori_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at,
        COALESCE(
          JSONB_AGG(psp.tomori_id ORDER BY psp.tomori_id) FILTER (WHERE psp.tomori_id IS NOT NULL),
          '[]'::JSONB
        ) AS persona_ids
      FROM personal_spotlights ps
      LEFT JOIN personal_spotlight_personas psp
        ON psp.server_id = ps.server_id
        AND psp.user_id = ps.user_id
        AND psp.channel_disc_id = ps.channel_disc_id
      WHERE ps.server_id = ${serverId}
        AND ps.user_id = ${userId}
      GROUP BY
        ps.server_id,
        ps.user_id,
        ps.channel_disc_id,
        ps.auto_trigger_tomori_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at
      ORDER BY ps.channel_disc_id ASC
    `;

    const emptyChannelIds: string[] = [];
    const spotlights: PersonalSpotlightStatus[] = [];

    for (const row of rows) {
      const status = this.mapAggregateRow(row);
      if (!status) {
        continue;
      }

      if (status.personaIds.length === 0) {
        emptyChannelIds.push(status.channelDiscId);
        continue;
      }

      spotlights.push(status);
    }

    if (emptyChannelIds.length > 0) {
      await Promise.all(
        emptyChannelIds.map((channelDiscId) => this.removePersonalSpotlight(serverId, userId, channelDiscId)),
      );
    }

    return spotlights;
  }

  /**
   * Returns true if the given tomoriId is permitted by the spotlight status.
   * A null spotlight means no restriction — all personas are allowed.
   *
   * @param spotlightStatus - Current spotlight, or null/undefined if none
   * @param tomoriId        - Persona DB ID to check
   */
  isPersonaAllowedByPersonalSpotlight(
    spotlightStatus: PersonalSpotlightStatus | null | undefined,
    tomoriId: number | null | undefined,
  ): boolean {
    if (!spotlightStatus) {
      return true;
    }

    if (!Number.isInteger(tomoriId) || !tomoriId) {
      return false;
    }

    return spotlightStatus.personaIds.includes(tomoriId);
  }

  /**
   * Filters a persona array to only those allowed by the given spotlight status.
   * Returns all personas unchanged when spotlightStatus is null/undefined.
   *
   * @param personas        - Array of persona-like objects with optional tomori_id
   * @param spotlightStatus - Current spotlight filter, or null/undefined
   */
  filterPersonasByPersonalSpotlight<T extends { tomori_id?: number | null | undefined }>(
    personas: readonly T[],
    spotlightStatus: PersonalSpotlightStatus | null | undefined,
  ): T[] {
    if (!spotlightStatus) {
      return [...personas];
    }

    return personas.filter((persona) => this.isPersonaAllowedByPersonalSpotlight(spotlightStatus, persona.tomori_id));
  }

  // ── Personal spotlight private helpers ───────────────────────────────────

  private normalizeNumber(value: number | string | bigint | null | undefined): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : null;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) ? parsed : null;
    }

    return null;
  }

  private parsePostgresArrayLiteral(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return [];
    }

    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }

    return inner
      .split(",")
      .map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
      .filter((entry) => entry.length > 0 && entry.toUpperCase() !== "NULL");
  }

  private normalizeNumberArray(values: unknown): number[] {
    let source: unknown = values;

    if (typeof source === "string") {
      const trimmed = source.trim();

      if (trimmed === "") {
        source = [];
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          source = Array.isArray(parsed) ? parsed : this.parsePostgresArrayLiteral(trimmed);
        } catch {
          source = this.parsePostgresArrayLiteral(trimmed);
        }
      }
    }

    const normalized = (Array.isArray(source) ? source : [])
      .map((value) => this.normalizeNumber(value))
      .filter((value): value is number => value !== null && value > 0);

    return [...new Set(normalized)].sort((left, right) => left - right);
  }

  private normalizeDate(value: Date | string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private mapAggregateRow(row: PersonalSpotlightAggregateRow): PersonalSpotlightStatus | null {
    const serverId = this.normalizeNumber(row.server_id);
    const userId = this.normalizeNumber(row.user_id);

    if (!serverId || !userId || !row.channel_disc_id) {
      return null;
    }

    return {
      serverId,
      userId,
      channelDiscId: row.channel_disc_id,
      personaIds: this.normalizeNumberArray(row.persona_ids),
      autoTriggerPersonaId: this.normalizeNumber(row.auto_trigger_tomori_id),
      expiresAt: this.normalizeDate(row.expires_at),
      createdAt: this.normalizeDate(row.created_at),
      updatedAt: this.normalizeDate(row.updated_at),
    };
  }

  private async deleteExpiredPersonalSpotlights(
    serverId: number,
    userId: number,
    channelDiscId?: string,
  ): Promise<void> {
    if (channelDiscId) {
      await sql`
        DELETE FROM personal_spotlights
        WHERE server_id = ${serverId}
          AND user_id = ${userId}
          AND channel_disc_id = ${channelDiscId}
          AND expires_at IS NOT NULL
          AND expires_at <= CURRENT_TIMESTAMP
      `;
      return;
    }

    await sql`
      DELETE FROM personal_spotlights
      WHERE server_id = ${serverId}
        AND user_id = ${userId}
        AND expires_at IS NOT NULL
        AND expires_at <= CURRENT_TIMESTAMP
    `;
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
   * Dual-writes: updates users table AND upserts into user_personalization_configs (Stage A).
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
      await this.registerUserRow(userDiscId, parsed.user_nickname, parsed.language_pref);

      const user = await this.loadByDiscordId(userDiscId);
      if (!user?.user_id) return false;

      await Promise.all([
        this.updateUserRow(user.user_id, {
          user_nickname: parsed.user_nickname,
          language_pref: parsed.language_pref,
          impersonation_prompt: parsed.impersonation_prompt ?? undefined,
          privacy_level: parsed.privacy_level,
          personal_dtm: parsed.personal_dtm,
          shortterm_cache_crossserver_opt_in: parsed.shortterm_cache_crossserver_opt_in,
          nai_char_tags: parsed.nai_char_tags,
          nai_char_ref_url: parsed.nai_char_ref_url ?? undefined,
        }),
        this.sqlUpsertUserPersonalizationConfigs(user.user_id, {
          shortterm_cache_crossserver_opt_in: parsed.shortterm_cache_crossserver_opt_in ?? false,
          nai_char_tags: parsed.nai_char_tags,
          nai_char_ref_url: parsed.nai_char_ref_url ?? null,
          impersonation_prompt: parsed.impersonation_prompt ?? null,
          personal_dtm: parsed.personal_dtm,
        }),
      ]);

      invalidateUserCache(userDiscId);
      return true;
    } catch (error) {
      log.error(`UserRepository.fromExportShape: write failed for ${userDiscId}:`, error);
      return false;
    }
  }

  // ── Stage A: user_personalization_configs upsert ──────────────────────────

  private async sqlUpsertUserPersonalizationConfigs(
    userId: number,
    data: {
      shortterm_cache_crossserver_opt_in: boolean;
      nai_char_tags: string[];
      nai_char_ref_url: string | null | undefined;
      impersonation_prompt: string | null | undefined;
      personal_dtm: "off" | "follow" | "on" | undefined;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO user_personalization_configs (
        user_id, shortterm_cache_crossserver_opt_in, nai_char_tags,
        nai_char_ref_url, impersonation_prompt, personal_dtm
      ) VALUES (
        ${userId}, ${data.shortterm_cache_crossserver_opt_in}, ${sql.array(data.nai_char_tags)},
        ${data.nai_char_ref_url ?? null}, ${data.impersonation_prompt ?? null},
        ${data.personal_dtm ?? "follow"}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        shortterm_cache_crossserver_opt_in = EXCLUDED.shortterm_cache_crossserver_opt_in,
        nai_char_tags                      = EXCLUDED.nai_char_tags,
        nai_char_ref_url                   = EXCLUDED.nai_char_ref_url,
        impersonation_prompt               = EXCLUDED.impersonation_prompt,
        personal_dtm                       = EXCLUDED.personal_dtm,
        updated_at                         = NOW()
    `;
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
