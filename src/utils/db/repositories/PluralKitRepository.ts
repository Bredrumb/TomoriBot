import {
  type PluralKitMemberRow,
  type PluralKitSystemRow,
  type UserRow,
  pluralKitMemberSchema,
  pluralKitSystemSchema,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { isPluralKitUserId, toPluralKitUserId } from "@/utils/bridges";

export type PluralKitSystemUpsertInput = {
  systemUuid: string;
  systemHid: string;
  systemName: string | null;
  systemTag: string | null;
};

export type PluralKitMemberIdentityInput = {
  system: PluralKitSystemUpsertInput;
  memberUuid: string;
  memberHid: string;
  displayName: string | null;
};

export type PluralKitMemberIdentityResult = {
  userRow: UserRow;
  system: PluralKitSystemRow;
  member: PluralKitMemberRow;
  isNewMember: boolean;
};

export type PluralKitMemberContext = {
  userDiscId: string;
  externalIdentityId: number;
  memberUuid: string;
  memberHid: string;
  displayName: string | null;
  pkSystemId: number;
  systemUuid: string;
  systemHid: string;
  systemName: string | null;
  systemTag: string | null;
  hostUserDiscIds: string[];
};

export type PluralKitIndexedMessageIdentity = PluralKitMemberContext & {
  messageDiscId: string;
  senderDiscId: string;
};

type PluralKitContextRow = {
  user_disc_id: string;
  external_identity_id: number | string;
  member_uuid: string;
  member_hid: string;
  display_name: string | null;
  pk_system_id: number | string;
  system_uuid: string;
  system_hid: string;
  system_name: string | null;
  system_tag: string | null;
  host_user_disc_ids?: string[] | string | null;
};

type PluralKitIndexedMessageIdentityRow = PluralKitContextRow & {
  message_disc_id: string;
  sender_disc_id: string;
};

/**
 * Data-layer access for PluralKit identity: systems, members, the
 * synthetic-user anchor (`external_identities`), host-account links, and the
 * durable message->identity index. See plans/pluralkit-integration.md §6.
 *
 * Never key on names (volatile); system_uuid/member_uuid are canonical, while
 * system_name/system_tag/display_name are cosmetic caches refreshed
 * opportunistically from PluralKit API lookups.
 */
export class PluralKitRepository {
  private readonly memberContextByUserDiscId = new Map<string, PluralKitMemberContext | null>();

  /**
   * Upserts a PluralKit system row keyed on `system_uuid`, refreshing the
   * cosmetic hid/name/tag cache on every call (cheap, and lookups are already
   * rate-limited upstream by the proxy-expectation gate).
   *
   * @returns the upserted row, or null on error
   */
  async upsertSystem(input: PluralKitSystemUpsertInput): Promise<PluralKitSystemRow | null> {
    try {
      const [row] = await sql`
        INSERT INTO pluralkit_systems (system_uuid, system_hid, system_name, system_tag)
        VALUES (${input.systemUuid}, ${input.systemHid}, ${input.systemName}, ${input.systemTag})
        ON CONFLICT (system_uuid) DO UPDATE
        SET
          system_hid = EXCLUDED.system_hid,
          system_name = EXCLUDED.system_name,
          system_tag = EXCLUDED.system_tag,
          updated_at = NOW()
        RETURNING pk_system_id, system_uuid, system_hid, system_name, system_tag, created_at, updated_at
      `;
      return row ? this.parseSystemRow(row, `system ${input.systemUuid}`) : null;
    } catch (error) {
      log.error(`Error upserting PluralKit system ${input.systemUuid}:`, error);
      return null;
    }
  }

  /**
   * Resolves the full identity behind a PluralKit member: ensures the system
   * row, ensures a synthetic `users` row (`pk:{member_uuid}`) plus its
   * `external_identities` anchor on first sighting, and refreshes cosmetic
   * fields on every subsequent sighting. Never re-registers an existing
   * member (idempotent by `member_uuid`).
   *
   * @returns the resolved identity, or null on error
   */
  async upsertMemberIdentity(input: PluralKitMemberIdentityInput): Promise<PluralKitMemberIdentityResult | null> {
    try {
      const userDiscId = toPluralKitUserId(input.memberUuid);
      this.memberContextByUserDiscId.delete(userDiscId);

      const system = await this.upsertSystem(input.system);
      if (!system?.pk_system_id) {
        return null;
      }

      const existing = await this.getMemberByUuid(input.memberUuid);
      if (existing) {
        const refreshed = await this.refreshMemberDisplayName(input.memberUuid, input.displayName);
        const userRow = await userRepository.loadByDiscordId(`pk:${input.memberUuid}`);
        if (!refreshed || !userRow) {
          return null;
        }
        // Refresh the synthetic users row's nickname on drift (same hid
        // fallback as registration). register() preserves nicknames on
        // conflict, so this explicit write is the only path that follows a
        // PluralKit member rename; conditional to avoid cache-invalidation
        // churn on every sighting. Cosmetic only: identity keys on the UUID.
        const currentName = input.displayName ?? input.memberHid;
        if (userRow.user_id && userRow.user_nickname !== currentName) {
          const renamed = await userRepository.setNickname(userRow.user_id, currentName);
          if (renamed) userRow.user_nickname = currentName;
        }
        return { userRow, system, member: refreshed, isNewMember: false };
      }

      return await this.registerNewMember(system, input);
    } catch (error) {
      log.error(`Error resolving PluralKit member identity ${input.memberUuid}:`, error);
      return null;
    }
  }

  /**
   * First-sighting path: creates the synthetic `users` row, then inserts the
   * `external_identities` anchor and the `pluralkit_members` row in one
   * transaction. `userRepository.register()` already invalidates the user
   * cache on success.
   */
  private async registerNewMember(
    system: PluralKitSystemRow,
    input: PluralKitMemberIdentityInput,
  ): Promise<PluralKitMemberIdentityResult | null> {
    if (!system.pk_system_id) {
      return null;
    }

    const userDiscId = toPluralKitUserId(input.memberUuid);
    const userRow = await userRepository.register(userDiscId, input.displayName ?? input.memberHid);
    if (!userRow?.user_id) {
      log.error(`Failed to register synthetic user row for PluralKit member ${input.memberUuid}`);
      return null;
    }

    try {
      const [memberRow] = await sql.begin(async (tx) => {
        const [identity] = await tx`
          INSERT INTO external_identities (kind, external_key, user_id)
          VALUES ('pluralkit_member', ${input.memberUuid}, ${userRow.user_id})
          ON CONFLICT (kind, external_key) DO UPDATE SET updated_at = NOW()
          RETURNING external_identity_id
        `;

        if (!identity?.external_identity_id) {
          throw new Error(`external_identities insert did not return an id for member ${input.memberUuid}`);
        }

        return await tx`
          INSERT INTO pluralkit_members (pk_system_id, external_identity_id, member_uuid, member_hid, display_name)
          VALUES (${system.pk_system_id}, ${identity.external_identity_id}, ${input.memberUuid}, ${input.memberHid}, ${input.displayName})
          ON CONFLICT (member_uuid) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            updated_at = NOW()
          RETURNING pk_member_id, pk_system_id, external_identity_id, member_uuid, member_hid, display_name, created_at, updated_at
        `;
      });

      const member = memberRow ? this.parseMemberRow(memberRow, `member ${input.memberUuid}`) : null;
      if (!member) {
        return null;
      }

      return { userRow, system, member, isNewMember: true };
    } catch (error) {
      log.error(`Error inserting PluralKit identity rows for member ${input.memberUuid}:`, error);
      return null;
    }
  }

  private async refreshMemberDisplayName(
    memberUuid: string,
    displayName: string | null,
  ): Promise<PluralKitMemberRow | null> {
    try {
      const [row] = await sql`
        UPDATE pluralkit_members
        SET display_name = ${displayName}, updated_at = NOW()
        WHERE member_uuid = ${memberUuid}
        RETURNING pk_member_id, pk_system_id, external_identity_id, member_uuid, member_hid, display_name, created_at, updated_at
      `;
      return row ? this.parseMemberRow(row, `member ${memberUuid}`) : null;
    } catch (error) {
      log.error(`Error refreshing display name for PluralKit member ${memberUuid}:`, error);
      return null;
    }
  }

  async getMemberByUuid(memberUuid: string): Promise<PluralKitMemberRow | null> {
    try {
      const [row] = await sql`
        SELECT pk_member_id, pk_system_id, external_identity_id, member_uuid, member_hid, display_name, created_at, updated_at
        FROM pluralkit_members
        WHERE member_uuid = ${memberUuid}
        LIMIT 1
      `;
      return row ? this.parseMemberRow(row, `member ${memberUuid}`) : null;
    } catch (error) {
      log.error(`Error loading PluralKit member ${memberUuid}:`, error);
      return null;
    }
  }

  /**
   * Links a PluralKit system to a Discord host account that proxies for it.
   * Called per confirmed lookup; the composite key makes repeat calls idempotent.
   *
   * @returns true on success (including no-op on an existing link), false on error
   */
  async linkHostAccount(pkSystemId: number, hostUserDiscId: string): Promise<boolean> {
    try {
      await sql`
        INSERT INTO pluralkit_system_accounts (pk_system_id, host_user_disc_id)
        VALUES (${pkSystemId}, ${hostUserDiscId})
        ON CONFLICT (pk_system_id, host_user_disc_id) DO NOTHING
      `;
      this.memberContextByUserDiscId.clear();
      return true;
    } catch (error) {
      log.error(`Error linking PluralKit system ${pkSystemId} to host account ${hostUserDiscId}:`, error);
      return false;
    }
  }

  /**
   * Records that a Discord message belongs to a PluralKit member, so future
   * context rebuilds can resolve attribution without re-querying the
   * PluralKit API. Rows are immutable (a message's identity never changes).
   *
   * @returns true on success (including no-op on an existing row), false on error
   */
  async recordMessageIndex(messageDiscId: string, externalIdentityId: number, senderDiscId: string): Promise<boolean> {
    try {
      await sql`
        INSERT INTO pluralkit_message_index (message_disc_id, external_identity_id, sender_disc_id)
        VALUES (${messageDiscId}, ${externalIdentityId}, ${senderDiscId})
        ON CONFLICT (message_disc_id) DO NOTHING
      `;
      return true;
    } catch (error) {
      log.error(`Error recording PluralKit message index for message ${messageDiscId}:`, error);
      return false;
    }
  }

  /**
   * Batch-loads PluralKit message attribution for context rebuilding.
   * Single round trip via `message_disc_id = ANY(...)`; callers must never loop
   * per message or call the PluralKit API during a history rebuild.
   *
   * @returns null on query failure so callers avoid negative-caching transient DB errors
   */
  async getMessageIdentitiesByMessageIds(
    messageDiscIds: string[],
  ): Promise<Map<string, PluralKitIndexedMessageIdentity> | null> {
    const result = new Map<string, PluralKitIndexedMessageIdentity>();
    if (messageDiscIds.length === 0) {
      return result;
    }

    try {
      const rows = await sql<PluralKitIndexedMessageIdentityRow[]>`
        SELECT
          pmi.message_disc_id,
          pmi.sender_disc_id,
          u.user_disc_id,
          ei.external_identity_id,
          pm.member_uuid::TEXT AS member_uuid,
          pm.member_hid,
          pm.display_name,
          ps.pk_system_id,
          ps.system_uuid::TEXT AS system_uuid,
          ps.system_hid,
          ps.system_name,
          ps.system_tag,
          COALESCE(
            array_agg(DISTINCT psa.host_user_disc_id) FILTER (WHERE psa.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM pluralkit_message_index pmi
        JOIN external_identities ei ON ei.external_identity_id = pmi.external_identity_id
        JOIN users u ON u.user_id = ei.user_id
        JOIN pluralkit_members pm ON pm.external_identity_id = ei.external_identity_id
        JOIN pluralkit_systems ps ON ps.pk_system_id = pm.pk_system_id
        LEFT JOIN pluralkit_system_accounts psa ON psa.pk_system_id = ps.pk_system_id
        WHERE pmi.message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
          AND ei.kind = 'pluralkit_member'
        GROUP BY
          pmi.message_disc_id,
          pmi.sender_disc_id,
          u.user_disc_id,
          ei.external_identity_id,
          pm.member_uuid,
          pm.member_hid,
          pm.display_name,
          ps.pk_system_id,
          ps.system_uuid,
          ps.system_hid,
          ps.system_name,
          ps.system_tag
      `;

      for (const row of rows) {
        const parsed = this.parseMemberContextRow(row, `message ${row.message_disc_id}`);
        if (!parsed) continue;
        const senderDiscId = typeof row.sender_disc_id === "string" ? row.sender_disc_id : "";
        if (!senderDiscId) {
          log.warn(`Invalid PluralKit message index row for message ${row.message_disc_id}: missing sender_disc_id`);
          continue;
        }
        const identity = {
          ...parsed,
          messageDiscId: row.message_disc_id,
          senderDiscId,
        };
        result.set(identity.messageDiscId, identity);
        this.memberContextByUserDiscId.set(identity.userDiscId, parsed);
      }
      return result;
    } catch (error) {
      log.error(`Error loading PluralKit message identities (${messageDiscIds.length} ids):`, error);
      return null;
    }
  }

  /**
   * Loads cached member/system/host details for a PluralKit synthetic user row.
   */
  async getMemberContextByUserDiscId(userDiscId: string): Promise<PluralKitMemberContext | null> {
    if (!isPluralKitUserId(userDiscId)) {
      return null;
    }

    if (this.memberContextByUserDiscId.has(userDiscId)) {
      return this.memberContextByUserDiscId.get(userDiscId) ?? null;
    }

    try {
      const [row] = await sql<PluralKitContextRow[]>`
        SELECT
          u.user_disc_id,
          ei.external_identity_id,
          pm.member_uuid::TEXT AS member_uuid,
          pm.member_hid,
          pm.display_name,
          ps.pk_system_id,
          ps.system_uuid::TEXT AS system_uuid,
          ps.system_hid,
          ps.system_name,
          ps.system_tag,
          COALESCE(
            array_agg(DISTINCT psa.host_user_disc_id) FILTER (WHERE psa.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM users u
        JOIN external_identities ei ON ei.user_id = u.user_id
        JOIN pluralkit_members pm ON pm.external_identity_id = ei.external_identity_id
        JOIN pluralkit_systems ps ON ps.pk_system_id = pm.pk_system_id
        LEFT JOIN pluralkit_system_accounts psa ON psa.pk_system_id = ps.pk_system_id
        WHERE u.user_disc_id = ${userDiscId}
          AND ei.kind = 'pluralkit_member'
        GROUP BY
          u.user_disc_id,
          ei.external_identity_id,
          pm.member_uuid,
          pm.member_hid,
          pm.display_name,
          ps.pk_system_id,
          ps.system_uuid,
          ps.system_hid,
          ps.system_name,
          ps.system_tag
        LIMIT 1
      `;

      const parsed = row ? this.parseMemberContextRow(row, `user ${userDiscId}`) : null;
      this.memberContextByUserDiscId.set(userDiscId, parsed);
      return parsed;
    } catch (error) {
      log.error(`Error loading PluralKit member context for ${userDiscId}:`, error);
      return null;
    }
  }

  /**
   * Deletes message-index rows older than the retention window. Old rows only
   * matter while their messages can still appear in a fetched history window.
   *
   * @returns number of rows deleted, or 0 on error
   */
  async pruneMessageIndexOlderThanDays(retentionDays: number): Promise<number> {
    try {
      const rows = await sql<Array<{ message_disc_id: string }>>`
        DELETE FROM pluralkit_message_index
        WHERE created_at < NOW() - make_interval(days => ${retentionDays})
        RETURNING message_disc_id
      `;
      return rows.length;
    } catch (error) {
      log.error(`Error pruning PluralKit message index older than ${retentionDays} days:`, error);
      return 0;
    }
  }

  private parseSystemRow(row: unknown, context: string): PluralKitSystemRow | null {
    const parsed = pluralKitSystemSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid pluralkit_systems row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseMemberRow(row: unknown, context: string): PluralKitMemberRow | null {
    const parsed = pluralKitMemberSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid pluralkit_members row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseMemberContextRow(row: PluralKitContextRow, context: string): PluralKitMemberContext | null {
    const externalIdentityId = Number(row.external_identity_id);
    const pkSystemId = Number(row.pk_system_id);
    if (!Number.isSafeInteger(externalIdentityId) || !Number.isSafeInteger(pkSystemId)) {
      log.warn(`Invalid PluralKit context row for ${context}: invalid numeric IDs`);
      return null;
    }

    const userDiscId = String(row.user_disc_id);
    if (!isPluralKitUserId(userDiscId)) {
      log.warn(`Invalid PluralKit context row for ${context}: ${userDiscId} is not a pk user ID`);
      return null;
    }

    return {
      userDiscId,
      externalIdentityId,
      memberUuid: String(row.member_uuid),
      memberHid: String(row.member_hid),
      displayName: row.display_name ?? null,
      pkSystemId,
      systemUuid: String(row.system_uuid),
      systemHid: String(row.system_hid),
      systemName: row.system_name ?? null,
      systemTag: row.system_tag ?? null,
      hostUserDiscIds: this.parseTextArray(row.host_user_disc_ids),
    };
  }

  private parseTextArray(value: string[] | string | null | undefined): string[] {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0);
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return [];
    }
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "").trim())
      .filter((entry) => entry.length > 0);
  }
}

export const pluralKitRepository = new PluralKitRepository();
