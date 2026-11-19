import type { SQL } from "bun";
import type { ErrorContext, PrivacyLevel, UserPersonalizationConfigsRow, UserRow } from "@/types/db/schema";
import { PrivacyLevel as PrivacyLevelValue, userSchema } from "@/types/db/schema";
import type { PersonalSettingsExportData } from "@/types/db/dataExport";
import { personalSettingsExportDataSchema } from "@/types/db/dataExport";
import { DatabaseUnavailableError } from "@/types/errors";
import { getCachedUserRow, invalidateUserCache, invalidateUserBlacklistCache } from "@/utils/cache/userCache";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { validateUserFields } from "@/utils/db/sqlSecurity";
import { log } from "@/utils/misc/logger";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import type { IRepository } from "./IRepository";

type UserExportShape = PersonalSettingsExportData;

const USER_PERSONALIZATION_FIELD_NAMES = [
  "user_nickname",
  "shortterm_cache_crossserver_opt_in",
  "physical_appearance_tags",
  "char_ref_url",
  "impersonation_prompt",
  "personal_dtm",
  "personal_deliberate_tool_mode",
  "personal_server_fallback_enabled",
  "natural_nudge_opt_out",
  "timezone_offset",
  "prefix_override",
  "suffix_override",
  "gender_identity",
  "pronouns",
  "addressing_style",
] as const;

type UserPersonalizationField = (typeof USER_PERSONALIZATION_FIELD_NAMES)[number];
type UserPersonalizationPatch = Partial<Pick<UserPersonalizationConfigsRow, UserPersonalizationField>>;

const USER_PERSONALIZATION_FIELDS = new Set<string>(USER_PERSONALIZATION_FIELD_NAMES);

type PersonalSpotlightAggregateRow = {
  server_id: number | string | bigint;
  user_id: number | string | bigint;
  channel_disc_id: string;
  auto_trigger_persona_id: number | string | bigint | null;
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

// Every flag must stay server-scoped because an unscoped match admits cross-server lurkers and makes shared names
// unresolvable.
export type ContextReferenceEligibilityEvidence = {
  hasServerActivity: boolean;
  hasPersonalMemories: boolean;
  hasPendingTasks: boolean;
};

export interface ContextReferenceCandidate {
  userRow: UserRow;
  evidence: ContextReferenceEligibilityEvidence;
}

export function isEligibleContextReferenceUserV1(
  user: UserRow,
  evidence: ContextReferenceEligibilityEvidence,
): boolean {
  return (
    evidence.hasServerActivity ||
    evidence.hasPersonalMemories ||
    evidence.hasPendingTasks ||
    user.shortterm_cache_crossserver_opt_in ||
    user.physical_appearance_tags.some((tag) => tag.trim().length > 0) ||
    Boolean(user.char_ref_url?.trim()) ||
    Boolean(user.impersonation_prompt?.trim()) ||
    user.personal_dtm !== "follow" ||
    user.personal_deliberate_tool_mode !== "follow" ||
    user.timezone_offset != null ||
    user.privacy_level !== PrivacyLevelValue.MINIMAL
  );
}

class UserRepository implements IRepository<UserExportShape> {
  async loadByDiscordId(userDiscId: string): Promise<UserRow | null> {
    try {
      return await withTransientDbRetry(async () => {
        const rows = await sql`
          SELECT
            u.user_id,
            u.user_disc_id,
            upc.user_nickname,
            u.language_pref,
            u.registration_locale,
            u.privacy_level,
            u.message_proxy_service,
            u.message_proxy_instance_id,
            COALESCE(upc.personal_deliberate_tool_mode, 'follow') AS personal_deliberate_tool_mode,
            upc.timezone_offset,
            upc.prefix_override,
            upc.suffix_override,
            upc.gender_identity,
            upc.pronouns,
            upc.addressing_style,
            u.created_at,
            u.updated_at,
            COALESCE(upc.shortterm_cache_crossserver_opt_in, false) AS shortterm_cache_crossserver_opt_in,
            COALESCE(upc.physical_appearance_tags, ARRAY[]::TEXT[]) AS physical_appearance_tags,
            upc.char_ref_url,
            upc.impersonation_prompt,
            COALESCE(upc.personal_dtm, 'follow') AS personal_dtm,
            COALESCE(upc.personal_server_fallback_enabled, true) AS personal_server_fallback_enabled,
            COALESCE(upc.natural_nudge_opt_out, false) AS natural_nudge_opt_out
          FROM users u
          LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
          WHERE u.user_disc_id = ${userDiscId}
          LIMIT 1
        `;

        if (!rows.length) {
          return null;
        }

        return this.parseUserRow(rows[0], `ID ${userDiscId}`);
      }, `load user row for ID ${userDiscId}`);
    } catch (error) {
      log.error(`Error loading user row for ID ${userDiscId}:`, error);
      return null;
    }
  }

  async findByNormalizedNickname(normalizedNickname: string): Promise<UserRow[]> {
    try {
      return await withTransientDbRetry(async () => {
        const nickname = normalizedNickname.trim().toLowerCase().replace(/\s+/g, " ");
        if (!nickname) {
          return [];
        }

        const rows = await sql`
            SELECT
              u.user_id,
              u.user_disc_id,
              upc.user_nickname,
              u.language_pref,
              u.registration_locale,
              u.privacy_level,
              u.message_proxy_service,
              u.message_proxy_instance_id,
              COALESCE(upc.personal_deliberate_tool_mode, 'follow') AS personal_deliberate_tool_mode,
              upc.timezone_offset,
              upc.prefix_override,
              upc.suffix_override,
              upc.gender_identity,
              upc.pronouns,
              upc.addressing_style,
              u.created_at,
              u.updated_at,
              COALESCE(upc.shortterm_cache_crossserver_opt_in, false) AS shortterm_cache_crossserver_opt_in,
              COALESCE(upc.physical_appearance_tags, ARRAY[]::TEXT[]) AS physical_appearance_tags,
              upc.char_ref_url,
              upc.impersonation_prompt,
              COALESCE(upc.personal_dtm, 'follow') AS personal_dtm,
              COALESCE(upc.personal_server_fallback_enabled, true) AS personal_server_fallback_enabled,
              COALESCE(upc.natural_nudge_opt_out, false) AS natural_nudge_opt_out
            FROM users u
            LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
            WHERE regexp_replace(lower(trim(upc.user_nickname)), '[[:space:]]+', ' ', 'g') = ${nickname}
          `;

        const parsedUsers: UserRow[] = [];
        for (const row of rows) {
          const parsedUser = this.parseUserRow(row, `nickname "${normalizedNickname}"`);
          if (parsedUser) parsedUsers.push(parsedUser);
        }

        return parsedUsers;
      }, `load user rows for nickname ${normalizedNickname}`);
    } catch (error) {
      log.error(`Error loading user rows for nickname "${normalizedNickname}":`, error);
      return [];
    }
  }

  // Eligibility filtering stays in the participant pipeline rather than SQL so injected sources and repository
  // results share one pure contract.
  async loadContextReferenceCandidates(params: {
    serverDiscId: string;
    candidateDiscordIds: string[];
    normalizedHistoryText: string;
  }): Promise<ContextReferenceCandidate[]> {
    try {
      return await withTransientDbRetry(async () => {
        const candidateDiscordIds = Array.from(new Set(params.candidateDiscordIds));
        const normalizedHistoryText = params.normalizedHistoryText
          .replaceAll("\u0000", " ")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        const rows = await sql`
            WITH context_reference_candidates AS (
              SELECT
                u.user_id,
                u.user_disc_id,
                upc.user_nickname,
                u.language_pref,
                u.registration_locale,
                u.privacy_level,
                COALESCE(upc.personal_deliberate_tool_mode, 'follow') AS personal_deliberate_tool_mode,
                upc.timezone_offset,
                upc.prefix_override,
                upc.suffix_override,
                upc.gender_identity,
                upc.pronouns,
                upc.addressing_style,
                u.created_at,
                u.updated_at,
                COALESCE(upc.shortterm_cache_crossserver_opt_in, false) AS shortterm_cache_crossserver_opt_in,
                COALESCE(upc.physical_appearance_tags, ARRAY[]::TEXT[]) AS physical_appearance_tags,
                upc.char_ref_url,
                upc.impersonation_prompt,
                COALESCE(upc.personal_dtm, 'follow') AS personal_dtm,
                COALESCE(upc.personal_server_fallback_enabled, true) AS personal_server_fallback_enabled,
                COALESCE(upc.natural_nudge_opt_out, false) AS natural_nudge_opt_out,
                EXISTS (
                  SELECT 1
                  FROM stat_counters sc
                  JOIN servers s ON s.server_id = sc.server_id
                  WHERE sc.user_id = u.user_id
                    AND s.server_disc_id = ${params.serverDiscId}
                    AND sc.metric IN ('message_sent', 'command_used')
                    AND sc.count > 0
                ) AS has_server_activity,
                -- Reached through persona_lineage_id rather than a server column because
                -- personal_memories has none: the lineage is the cross-server pooling
                -- namespace, so joining it back to the personas of this server keeps a
                -- re-imported persona's memories counting while excluding a user whose
                -- memories all belong to lineages this server never ran. Lineage 0 is the
                -- global branch that loadForUserLineage ORs into every persona's read, so
                -- it renders here regardless of which lineages this server owns.
                EXISTS (
                  SELECT 1
                  FROM personal_memories pm
                  WHERE pm.user_id = u.user_id
                    AND (
                      pm.persona_lineage_id = 0
                      OR EXISTS (
                        SELECT 1
                        FROM personas p
                        JOIN servers s ON s.server_id = p.server_id
                        WHERE p.persona_lineage_id = pm.persona_lineage_id
                          AND s.server_disc_id = ${params.serverDiscId}
                      )
                    )
                ) AS has_personal_memories,
                EXISTS (
                  SELECT 1
                  FROM reminders r
                  JOIN servers s ON s.server_id = r.server_id
                  WHERE (r.user_discord_id = u.user_disc_id OR r.created_by_user_id = u.user_id)
                    AND r.reminder_time > CURRENT_TIMESTAMP
                    AND s.server_disc_id = ${params.serverDiscId}
                ) AS has_pending_tasks
              FROM users u
              LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
            )
            SELECT *
            FROM context_reference_candidates
            WHERE (
              user_disc_id = ANY(${sql.array(candidateDiscordIds, "TEXT")})
              OR has_server_activity
              OR (
                ${normalizedHistoryText} <> ''
                AND position(
                  regexp_replace(lower(trim(user_nickname)), '[[:space:]]+', ' ', 'g')
                  IN ${normalizedHistoryText}
                ) > 0
              )
            )
          `;

        const candidates: ContextReferenceCandidate[] = [];
        for (const row of rows) {
          const parsedUser = this.parseUserRow(row, `context reference candidate ${row.user_disc_id}`);
          if (parsedUser) {
            candidates.push({
              userRow: parsedUser,
              evidence: {
                hasServerActivity: row.has_server_activity === true,
                hasPersonalMemories: row.has_personal_memories === true,
                hasPendingTasks: row.has_pending_tasks === true,
              },
            });
          }
        }
        return candidates;
      }, `load context reference candidates for server ${params.serverDiscId}`);
    } catch (error) {
      log.error("Error loading context reference candidates:", error);
      return [];
    }
  }

  async getPrivacyLevel(userDiscId: string): Promise<PrivacyLevel> {
    try {
      const result = await withTransientDbRetry(
        async () =>
          await sql`
          SELECT privacy_level
          FROM users
          WHERE user_disc_id = ${userDiscId}
          LIMIT 1
        `,
        "get privacy level",
      );

      // A user with no row is genuinely new, and MINIMAL is the right default for them. This
      // branch must not be merged with the failure path below: an absent row and an unreadable
      // database are different facts, and only one of them permits a permissive answer.
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
      // Returning MINIMAL here treated a user who chose FULL (completely invisible) as fully
      // personalizable for the duration of every pool cascade, because this catch cannot tell
      // an unreadable database from a new user. Callers that cannot propagate must pick FULL.
      log.error(`Error checking privacy level for user ${userDiscId}:`, error);
      throw new DatabaseUnavailableError(`Failed to read the privacy level for user ${userDiscId}`);
    }
  }

  async isPrivacyOptedOut(userDiscId: string): Promise<boolean> {
    const level = await this.getPrivacyLevel(userDiscId);
    return level === PrivacyLevelValue.FULL;
  }

  async getCrossServerShmOptIn(userDiscId: string): Promise<boolean> {
    try {
      const cached = await getCachedUserRow(userDiscId);
      if (cached) {
        return cached.shortterm_cache_crossserver_opt_in;
      }

      const [user] = await sql`
        SELECT COALESCE(upc.shortterm_cache_crossserver_opt_in, false) AS shortterm_cache_crossserver_opt_in
        FROM users u
        LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
        WHERE u.user_disc_id = ${userDiscId}
      `;

      return user?.shortterm_cache_crossserver_opt_in ?? false;
    } catch (error) {
      log.error(`Error checking cross-server short-term memory opt-in for user ${userDiscId}:`, error);
      return false;
    }
  }

  async isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
    try {
      const result = await withTransientDbRetry(
        async () =>
          await sql`
          SELECT EXISTS (
            SELECT 1
            FROM personalization_blacklist pb
            JOIN servers s ON pb.server_id = s.server_id
            WHERE s.server_disc_id = ${serverDiscId}
            AND pb.user_disc_id = ${userDiscId}
          ) as "exists";
        `,
        "check personalization blacklist",
      );

      // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists.
      return result[0]!.exists;
    } catch (error) {
      // Returning false meant a moderation control that evaporated whenever the database
      // hiccuped. Callers that cannot propagate must treat the restriction as still in force.
      log.error(`Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`, error);
      throw new DatabaseUnavailableError(`Failed to read the blacklist entry for user ${userDiscId}`);
    }
  }

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

  // Observed displayName stays diagnostic rather than saving as user_nickname so null keeps the user's name linked to
  // their live Discord profile.
  async register(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
    const user = await this.registerUserRow(userDiscId, displayName, language);
    if (user) invalidateUserCache(userDiscId);
    return user;
  }

  async setPrivacyLevel(userDiscId: string, level: PrivacyLevel): Promise<UserRow | null> {
    const user = await this.setPrivacyLevelRow(userDiscId, level);
    if (user) invalidateUserCache(userDiscId);
    return user;
  }

  async setPrivacyOptOut(userDiscId: string, optedOut: boolean): Promise<UserRow | null> {
    const level = optedOut ? PrivacyLevelValue.FULL : PrivacyLevelValue.MINIMAL;
    return this.setPrivacyLevel(userDiscId, level);
  }

  async toggleCrossServerShmOptIn(userDiscId: string): Promise<boolean> {
    try {
      const [updated] = await sql`
        INSERT INTO user_personalization_configs (
          user_id,
          shortterm_cache_crossserver_opt_in
        )
        SELECT
          user_id,
          true
        FROM users
        WHERE user_disc_id = ${userDiscId}
        ON CONFLICT (user_id) DO UPDATE SET
          shortterm_cache_crossserver_opt_in = NOT user_personalization_configs.shortterm_cache_crossserver_opt_in,
          updated_at = NOW()
        RETURNING shortterm_cache_crossserver_opt_in
      `;

      if (updated) invalidateUserCache(userDiscId);
      return updated?.shortterm_cache_crossserver_opt_in ?? false;
    } catch (error) {
      log.error(`Error toggling cross-server short-term memory opt-in for user ${userDiscId}:`, error);
      throw error;
    }
  }

  async update(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
    const user = await this.updateUserRow(userId, userData);
    if (user) invalidateUserCache(user.user_disc_id);
    return user;
  }

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

  async setDeliberateTriggerMode(userId: number, mode: "off" | "follow" | "on"): Promise<boolean> {
    const updated = await this.update(userId, { personal_dtm: mode });
    return updated !== null;
  }

  async setImpersonatePrompt(userId: number, prompt: string | null): Promise<boolean> {
    const updated = await this.update(userId, { impersonation_prompt: prompt });
    return updated !== null;
  }

  async setLanguage(userId: number, language: string): Promise<boolean> {
    const updated = await this.update(userId, { language_pref: language });
    return updated !== null;
  }

  async setNickname(userId: number, nickname: string | null): Promise<boolean> {
    const updated = await this.update(userId, { user_nickname: nickname });
    return updated !== null;
  }

  async setTimezoneOffset(userId: number, offset: number | null): Promise<boolean> {
    const updated = await this.update(userId, { timezone_offset: offset });
    return updated !== null;
  }

  async setMessageProxyService(
    userId: number,
    serviceId: string | null,
    selectedInstanceId?: string,
  ): Promise<boolean> {
    const instanceId =
      serviceId === "pluralkit" || serviceId === "pluralbuddy" ? (selectedInstanceId ?? `${serviceId}:official`) : null;
    const updated = await this.update(userId, {
      message_proxy_service: serviceId,
      message_proxy_instance_id: instanceId,
    });
    return updated !== null;
  }

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
          auto_trigger_persona_id,
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
          auto_trigger_persona_id = EXCLUDED.auto_trigger_persona_id,
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
            persona_id
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

  async removePersonalSpotlight(serverId: number, userId: number, channelDiscId: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM personal_spotlights
      WHERE server_id = ${serverId}
        AND user_id = ${userId}
        AND channel_disc_id = ${channelDiscId}
    `;

    return result.count > 0;
  }

  // Cache layer calls this first so servers without spotlights skip getPersonalSpotlightStatus and its per-user
  // DELETE before SELECT.
  async serverHasPersonalSpotlights(serverId: number): Promise<boolean> {
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM personal_spotlights WHERE server_id = ${serverId}
      ) AS exists
    `;

    return row?.exists ?? false;
  }

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
        ps.auto_trigger_persona_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at,
        COALESCE(
          JSONB_AGG(psp.persona_id ORDER BY psp.persona_id) FILTER (WHERE psp.persona_id IS NOT NULL),
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
        ps.auto_trigger_persona_id,
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

    // Orphaned spotlight: remove it so it doesn't accumulate
    await this.removePersonalSpotlight(serverId, userId, channelDiscId);
    return null;
  }

  async getActivePersonalSpotlightsForUser(serverId: number, userId: number): Promise<PersonalSpotlightStatus[]> {
    await this.deleteExpiredPersonalSpotlights(serverId, userId);

    const rows = await sql<PersonalSpotlightAggregateRow[]>`
      SELECT
        ps.server_id,
        ps.user_id,
        ps.channel_disc_id,
        ps.auto_trigger_persona_id,
        ps.expires_at,
        ps.created_at,
        ps.updated_at,
        COALESCE(
          JSONB_AGG(psp.persona_id ORDER BY psp.persona_id) FILTER (WHERE psp.persona_id IS NOT NULL),
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
        ps.auto_trigger_persona_id,
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

  isPersonaAllowedByPersonalSpotlight(
    spotlightStatus: PersonalSpotlightStatus | null | undefined,
    personaId: number | null | undefined,
  ): boolean {
    if (!spotlightStatus) {
      return true;
    }

    if (!Number.isInteger(personaId) || !personaId) {
      return false;
    }

    return spotlightStatus.personaIds.includes(personaId);
  }

  filterPersonasByPersonalSpotlight<T extends { persona_id?: number | null | undefined }>(
    personas: readonly T[],
    spotlightStatus: PersonalSpotlightStatus | null | undefined,
  ): T[] {
    if (!spotlightStatus) {
      return [...personas];
    }

    return personas.filter((persona) => this.isPersonaAllowedByPersonalSpotlight(spotlightStatus, persona.persona_id));
  }

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
      autoTriggerPersonaId: this.normalizeNumber(row.auto_trigger_persona_id),
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

  async toExportShape(ownerId: string | number): Promise<UserExportShape | null> {
    const userDiscId = String(ownerId);
    const user = await this.loadByDiscordId(userDiscId);
    if (!user) return null;

    const personaNamingPreferences = await sql<
      Array<{
        persona_lineage_id: number;
        nickname_override: string | null;
        prefix_override: string | null;
        suffix_override: string | null;
      }>
    >`
      SELECT persona_lineage_id, nickname_override, prefix_override, suffix_override
      FROM user_persona_naming_preferences
      WHERE user_id = ${user.user_id as number}
      ORDER BY persona_lineage_id
    `;

    return {
      user_nickname: user.user_nickname,
      language_pref: user.language_pref,
      impersonation_prompt: user.impersonation_prompt ?? null,
      privacy_level: user.privacy_level,
      personal_dtm: (user.personal_dtm as "off" | "follow" | "on") ?? undefined,
      shortterm_cache_crossserver_opt_in: user.shortterm_cache_crossserver_opt_in,
      physical_appearance_tags: user.physical_appearance_tags ?? [],
      char_ref_url: user.char_ref_url ?? null,
      personal_deliberate_tool_mode: user.personal_deliberate_tool_mode,
      timezone_offset: user.timezone_offset ?? null,
      prefix_override: user.prefix_override ?? null,
      suffix_override: user.suffix_override ?? null,
      gender_identity: user.gender_identity ?? null,
      pronouns: user.pronouns ?? null,
      addressing_style: user.addressing_style ?? null,
      persona_naming_preferences: personaNamingPreferences.map((preference) => ({
        ...preference,
        persona_lineage_id: Number(preference.persona_lineage_id),
      })),
    };
  }

  async fromExportShape(ownerId: string | number, data: UserExportShape): Promise<boolean> {
    const userDiscId = String(ownerId);
    const validated = personalSettingsExportDataSchema.safeParse(data);
    if (!validated.success) {
      log.error(`UserRepository.fromExportShape: invalid data for ${userDiscId}:`, validated.error.flatten());
      return false;
    }

    const parsed = validated.data;

    try {
      await this.registerUserRow(userDiscId, parsed.user_nickname ?? userDiscId, parsed.language_pref);

      const user = await this.loadByDiscordId(userDiscId);
      if (!user?.user_id) return false;

      await Promise.all([
        this.updateUserRow(user.user_id, {
          language_pref: parsed.language_pref,
          privacy_level: parsed.privacy_level,
        }),
        this.sqlUpsertUserPersonalizationConfigs(user.user_id, {
          shortterm_cache_crossserver_opt_in: parsed.shortterm_cache_crossserver_opt_in ?? false,
          physical_appearance_tags: parsed.physical_appearance_tags,
          char_ref_url: parsed.char_ref_url ?? null,
          impersonation_prompt: parsed.impersonation_prompt ?? null,
          personal_dtm: parsed.personal_dtm,
          user_nickname: parsed.user_nickname,
          personal_deliberate_tool_mode: parsed.personal_deliberate_tool_mode,
          timezone_offset: parsed.timezone_offset,
          prefix_override: parsed.prefix_override,
          suffix_override: parsed.suffix_override,
          gender_identity: parsed.gender_identity,
          pronouns: parsed.pronouns,
          addressing_style: parsed.addressing_style,
        }),
      ]);

      for (const preference of parsed.persona_naming_preferences) {
        await sql`
          INSERT INTO user_persona_naming_preferences (
            user_id, persona_lineage_id, nickname_override, prefix_override, suffix_override
          ) VALUES (
            ${user.user_id}, ${preference.persona_lineage_id}, ${preference.nickname_override},
            ${preference.prefix_override}, ${preference.suffix_override}
          )
          ON CONFLICT (user_id, persona_lineage_id) DO UPDATE SET
            nickname_override = EXCLUDED.nickname_override,
            prefix_override = EXCLUDED.prefix_override,
            suffix_override = EXCLUDED.suffix_override,
            updated_at = NOW()
        `;
      }

      invalidateUserCache(userDiscId);
      return true;
    } catch (error) {
      log.error(`UserRepository.fromExportShape: write failed for ${userDiscId}:`, error);
      return false;
    }
  }

  private async sqlUpsertUserPersonalizationConfigs(
    userId: number,
    data: {
      shortterm_cache_crossserver_opt_in: boolean;
      physical_appearance_tags: string[];
      char_ref_url: string | null | undefined;
      impersonation_prompt: string | null | undefined;
      personal_dtm: "off" | "follow" | "on" | undefined;
      user_nickname: string | null;
      personal_deliberate_tool_mode: "off" | "follow" | "on" | undefined;
      timezone_offset: number | null | undefined;
      prefix_override: string | null | undefined;
      suffix_override: string | null | undefined;
      gender_identity: string | null | undefined;
      pronouns: string | null | undefined;
      addressing_style: "masculine" | "feminine" | "neutral" | null | undefined;
    },
    client: SQL = sql,
  ): Promise<void> {
    await client`
      INSERT INTO user_personalization_configs (
        user_id, user_nickname, shortterm_cache_crossserver_opt_in, physical_appearance_tags,
        char_ref_url, impersonation_prompt, personal_dtm, personal_deliberate_tool_mode,
        timezone_offset, prefix_override, suffix_override, gender_identity, pronouns,
        addressing_style
      ) VALUES (
        ${userId}, ${data.user_nickname}, ${data.shortterm_cache_crossserver_opt_in}, ${sql.array(data.physical_appearance_tags, "TEXT")},
        ${data.char_ref_url ?? null}, ${data.impersonation_prompt ?? null},
        ${data.personal_dtm ?? "follow"}, ${data.personal_deliberate_tool_mode ?? "follow"},
        ${data.timezone_offset ?? null}, ${data.prefix_override ?? null}, ${data.suffix_override ?? null},
        ${data.gender_identity ?? null}, ${data.pronouns ?? null},
        ${data.addressing_style ?? null}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        user_nickname                      = EXCLUDED.user_nickname,
        shortterm_cache_crossserver_opt_in = EXCLUDED.shortterm_cache_crossserver_opt_in,
        physical_appearance_tags                      = EXCLUDED.physical_appearance_tags,
        char_ref_url                   = EXCLUDED.char_ref_url,
        impersonation_prompt               = EXCLUDED.impersonation_prompt,
        personal_dtm                       = EXCLUDED.personal_dtm,
        personal_deliberate_tool_mode      = EXCLUDED.personal_deliberate_tool_mode,
        timezone_offset                    = EXCLUDED.timezone_offset,
        prefix_override                    = EXCLUDED.prefix_override,
        suffix_override                    = EXCLUDED.suffix_override,
        gender_identity                    = EXCLUDED.gender_identity,
        pronouns                           = EXCLUDED.pronouns,
        addressing_style                   = EXCLUDED.addressing_style,
        updated_at                         = NOW()
    `;
  }

  private async sqlUpsertUserPersonalizationPatch(
    userId: number,
    patch: UserPersonalizationPatch,
    client: SQL = sql,
  ): Promise<void> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
      [UserPersonalizationField, UserPersonalizationPatch[UserPersonalizationField]]
    >;
    if (entries.length === 0) return;

    const columns = ["user_id"];
    const placeholders = ["$1"];
    const setParts: string[] = [];
    const values: SqlParameterArray = [userId];

    for (const [field, rawValue] of entries) {
      columns.push(field);
      const placeholder = `$${values.length + 1}`;
      if (field === "physical_appearance_tags") {
        placeholders.push(`${placeholder}::TEXT[]`);
        values.push(this.toTextArrayLiteral(rawValue as string[]));
      } else {
        placeholders.push(placeholder);
        values.push(rawValue);
      }
      setParts.push(`${field} = EXCLUDED.${field}`);
    }

    await client.unsafe(
      `
        INSERT INTO user_personalization_configs (${columns.join(", ")})
        VALUES (${placeholders.join(", ")})
        ON CONFLICT (user_id) DO UPDATE SET
          ${setParts.join(", ")},
          updated_at = NOW()
      `,
      values,
    );
  }

  private async ensureUserPersonalizationConfigRow(
    userId: number,
    client: SQL = sql,
    initialNickname: string | null = null,
  ): Promise<void> {
    await client`
      INSERT INTO user_personalization_configs (user_id, user_nickname)
      VALUES (${userId}, ${initialNickname})
      ON CONFLICT (user_id) DO NOTHING
    `;
  }

  private async registerUserRow(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
    try {
      log.info(`Ensuring user ${userDiscId} exists (${displayName})`);

      // Wrapped where the raw driver error can still reach the helper: a `try/catch` inside the
      // thunk would hand it a resolved value and the retry would never fire. Replay-safe because
      // both writes are `ON CONFLICT DO NOTHING`.
      await withTransientDbRetry(async () => {
        await sql.begin(async (tx) => {
          const [row] = await tx`
            WITH inserted_user AS (
              INSERT INTO users (
                user_disc_id,
                language_pref,
                registration_locale
              ) VALUES (
                ${userDiscId},
                ${language},
                ${language}
              )
              ON CONFLICT (user_disc_id) DO NOTHING
              RETURNING user_id
            )
            SELECT user_id
            FROM inserted_user
            UNION ALL
            SELECT user_id
            FROM users
            WHERE user_disc_id = ${userDiscId}
              AND NOT EXISTS (SELECT 1 FROM inserted_user)
            LIMIT 1
          `;

          if (!row?.user_id) {
            throw new Error(`User ${userDiscId} was not returned after registration upsert`);
          }

          await this.ensureUserPersonalizationConfigRow(row.user_id, tx);
        });
      }, "register user");

      const userData = await this.loadByDiscordId(userDiscId);

      if (!userData) {
        log.error(`Failed to validate registered user data for ${userDiscId}`);
        return null;
      }

      return userData;
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
        RETURNING user_disc_id
      `;

      if (!userData) {
        log.warn(`Cannot set privacy level: User ${userDiscId} not found in database`);
        return null;
      }

      log.success(`Privacy level successfully set to ${level} for user ${userDiscId}`);
      return await this.loadByDiscordId(userData.user_disc_id);
    } catch (error) {
      log.error(`Error setting privacy level for user ${userDiscId}:`, error);
      return null;
    }
  }

  private async updateUserRow(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
    try {
      const validUserData = userSchema.partial().parse(userData);
      const fields = Object.keys(userData).filter((key) => {
        if (key === "user_id") return false;
        return validUserData[key as keyof typeof validUserData] !== undefined;
      });

      if (fields.length === 0) {
        log.warn(`No fields provided to update for user_id: ${userId}`);
        return null;
      }

      validateUserFields(fields);

      const userFields: string[] = [];
      const personalizationPatch: UserPersonalizationPatch = {};

      for (const field of fields) {
        const rawValue = validUserData[field as keyof typeof validUserData];
        if (this.isUserPersonalizationField(field)) {
          this.assignUserPersonalizationPatchField(personalizationPatch, field, rawValue);
        } else {
          userFields.push(field);
        }
      }

      let userDiscId: string | null = null;

      await sql.begin(async (tx) => {
        const [existingUser] = await tx`
          SELECT user_disc_id
          FROM users
          WHERE user_id = ${userId}
          FOR UPDATE
        `;

        if (!existingUser?.user_disc_id) {
          throw new Error("User not found");
        }
        userDiscId = existingUser.user_disc_id;

        if (userFields.length > 0) {
          const setParts: string[] = [];
          const values: SqlParameterArray = [];

          for (const field of userFields) {
            const rawValue = validUserData[field as keyof typeof validUserData];
            this.pushUnsafeUpdateValue(field, rawValue, setParts, values);
          }

          values.push(userId);

          const result = await tx.unsafe(
            `
              UPDATE users
              SET ${setParts.join(", ")}
              WHERE user_id = $${values.length}
              RETURNING user_disc_id
            `,
            values,
          );

          if (!result.length) {
            throw new Error("User not found");
          }
          userDiscId = result[0].user_disc_id;
        }

        await this.sqlUpsertUserPersonalizationPatch(userId, personalizationPatch, tx);
      });

      if (!userDiscId) {
        return null;
      }

      return await this.loadByDiscordId(userDiscId);
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

  private parseUserRow(row: unknown, contextLabel: string): UserRow | null {
    const parsedUser = userSchema.safeParse(row);
    if (!parsedUser.success) {
      log.error(`Failed to validate user data for ${contextLabel}:`, parsedUser.error.flatten());
      return null;
    }
    return parsedUser.data;
  }

  private isUserPersonalizationField(field: string): field is UserPersonalizationField {
    return USER_PERSONALIZATION_FIELDS.has(field);
  }

  private assignUserPersonalizationPatchField(
    patch: UserPersonalizationPatch,
    field: UserPersonalizationField,
    rawValue: unknown,
  ): void {
    switch (field) {
      case "user_nickname":
        patch.user_nickname = rawValue as string | null;
        break;
      case "shortterm_cache_crossserver_opt_in":
        patch.shortterm_cache_crossserver_opt_in = rawValue as boolean;
        break;
      case "physical_appearance_tags":
        patch.physical_appearance_tags = rawValue as string[];
        break;
      case "char_ref_url":
        patch.char_ref_url = rawValue as string | null;
        break;
      case "impersonation_prompt":
        patch.impersonation_prompt = rawValue as string | null;
        break;
      case "personal_dtm":
        patch.personal_dtm = rawValue as "off" | "follow" | "on";
        break;
      case "personal_deliberate_tool_mode":
        patch.personal_deliberate_tool_mode = rawValue as "off" | "follow" | "on";
        break;
      case "personal_server_fallback_enabled":
        patch.personal_server_fallback_enabled = rawValue as boolean;
        break;
      case "natural_nudge_opt_out":
        patch.natural_nudge_opt_out = rawValue as boolean;
        break;
      case "timezone_offset":
        patch.timezone_offset = rawValue as number | null;
        break;
      case "prefix_override":
        patch.prefix_override = rawValue as string | null;
        break;
      case "suffix_override":
        patch.suffix_override = rawValue as string | null;
        break;
      case "gender_identity":
        patch.gender_identity = rawValue as string | null;
        break;
      case "pronouns":
        patch.pronouns = rawValue as string | null;
        break;
      case "addressing_style":
        patch.addressing_style = rawValue as "masculine" | "feminine" | "neutral" | null;
        break;
    }
  }

  // Deleting the user cascades personal rows while anonymizing server-owned ones, so spotlight server IDs must be
  // read before the delete for cache invalidation.
  async nukeUser(userId: number): Promise<PersonalNukeResult | null> {
    try {
      return await sql.begin(async (tx: SQL) => {
        // Read the Discord id before the cascade: reminders key their target by that string, not
        // by user_id, so it is unreachable once the row is gone.
        const [user] = await tx<Array<{ user_disc_id: string }>>`
          SELECT user_disc_id FROM users WHERE user_id = ${userId}
        `;
        if (!user) return null;

        const spotlights = await tx<Array<{ server_id: number }>>`
          SELECT DISTINCT server_id FROM personal_spotlights WHERE user_id = ${userId}
        `;

        // Reminders are ON DELETE SET NULL, so the cascade alone would leave both halves behind:
        // one the user authored (their own prose and schedule, firing forever with a null creator
        // nobody can claim) and one aimed at them (their Discord id and nickname, held by a row
        // somebody else created). An erasure has to reach both.
        const reminders = await tx`
          DELETE FROM reminders
          WHERE created_by_user_id = ${userId} OR user_discord_id = ${user.user_disc_id}
        `;

        await tx`DELETE FROM short_term_memories WHERE user_disc_id = ${user.user_disc_id}`;
        await tx`DELETE FROM users WHERE user_id = ${userId}`;

        return {
          userDiscId: user.user_disc_id,
          affectedServerIds: spotlights.map((row) => row.server_id),
          remindersDeleted: reminders.count ?? 0,
        };
      });
    } catch (error) {
      log.error(`[PersonalNuke] Failed to erase user ${userId}`, error);
      throw error;
    }
  }

  async hasPendingWebhookUserCleanup(): Promise<boolean> {
    // Checked first because clean installs record migration 131 without running it, so the table may not exist.
    const [table] = await sql<Array<{ present: boolean }>>`
      SELECT to_regclass('public.webhook_user_cleanup') IS NOT NULL AS present
    `;
    if (!table?.present) return false;
    const [queue] = await sql<Array<{ pending: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM webhook_user_cleanup) AS pending
    `;
    return queue?.pending === true;
  }

  // Stat counters are rolled onto the bot user before deleting queued webhook user rows so server and persona spend
  // totals survive.
  async mergeWebhookUsersIntoBot(botUserId: number): Promise<string[] | null> {
    return sql.begin(async (tx: SQL) => {
      const [table] = await tx<Array<{ present: boolean }>>`
        SELECT to_regclass('public.webhook_user_cleanup') IS NOT NULL AS present
      `;
      if (!table?.present) return null;

      // The production runtime role has no DDL privilege, so the queue is emptied rather than dropped;
      // claiming rows first leaves anything queued mid-merge for the next run instead of discarding it.
      const claimed = await tx<Array<{ user_id: number }>>`DELETE FROM webhook_user_cleanup RETURNING user_id`;
      if (claimed.length === 0) return null;
      const userIds = claimed.map((row) => row.user_id);

      await tx`
        INSERT INTO stat_counters (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count, first_at, last_at)
        SELECT sc.server_id, ${botUserId}, sc.persona_lineage_id, sc.metric, sc.metric_key, sc.bucket,
               SUM(sc.count), MIN(sc.first_at), MAX(sc.last_at)
        FROM stat_counters sc
        WHERE sc.user_id IN ${tx(userIds)}
        GROUP BY sc.server_id, sc.persona_lineage_id, sc.metric, sc.metric_key, sc.bucket
        ON CONFLICT (server_id, user_id, persona_lineage_id, metric, metric_key, bucket) DO UPDATE
        SET count = stat_counters.count + EXCLUDED.count,
            first_at = LEAST(stat_counters.first_at, EXCLUDED.first_at),
            last_at = GREATEST(stat_counters.last_at, EXCLUDED.last_at)
      `;
      const deleted = await tx<Array<{ user_disc_id: string }>>`
        DELETE FROM users WHERE user_id IN ${tx(userIds)}
        RETURNING user_disc_id
      `;
      return deleted.map((row) => row.user_disc_id);
    });
  }

  private pushUnsafeUpdateValue(field: string, rawValue: unknown, setParts: string[], values: SqlParameterArray): void {
    const placeholder = `$${values.length + 1}`;
    if (Array.isArray(rawValue)) {
      setParts.push(`${field} = ${placeholder}::TEXT[]`);
      values.push(this.toTextArrayLiteral(rawValue));
      return;
    }

    setParts.push(`${field} = ${placeholder}`);
    values.push(rawValue);
  }

  private toTextArrayLiteral(values: string[]): string {
    const escaped = values.map((value) => `"${String(value).replace(/(["\\])/g, "\\$1")}"`);
    return `{${escaped.join(",")}}`;
  }
}

interface PersonalNukeResult {
  userDiscId: string;
  affectedServerIds: number[];
  remindersDeleted: number;
}

export const userRepository = new UserRepository();
