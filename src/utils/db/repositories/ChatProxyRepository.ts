import {
  type ChatProxyIdentityRow,
  type ChatProxyNamespaceRow,
  type UserRow,
  chatProxyIdentitySchema,
  chatProxyNamespaceSchema,
} from "@/types/db/schema";
import { invalidateUserCache } from "@/utils/cache/userCache";
import type {
  ChatProxyIdentityContext,
  ChatProxyIdentityReference,
  ChatProxyIndexedMessageIdentity,
  ProxyIdentityUpsertInput,
} from "@/utils/chatProxy/types";
import { formatChatProxyIdentityUserId, parseChatProxyIdentityUserId } from "@/utils/chatProxy/identityUserId";
import { getProxyServiceDescriptor } from "@/utils/chatProxy/registry";
import { sql } from "@/utils/db/client";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { log } from "@/utils/misc/logger";

export type ChatProxyIdentityUpsertResult = {
  userRow: UserRow;
  namespace: ChatProxyNamespaceRow;
  identity: ChatProxyIdentityRow;
  isNewIdentity: boolean;
};

type ChatProxyIdentityReferenceRow = {
  service_id: string;
  user_disc_id: string;
  display_name: string | null;
  user_nickname: string | null;
};

type ChatProxyContextRow = {
  service_id: string;
  user_disc_id: string;
  external_identity_id: number | string;
  external_key: string;
  identity_short_id: string | null;
  display_name: string | null;
  chat_proxy_namespace_id: number | string;
  namespace_key: string;
  namespace_short_id: string | null;
  namespace_display_name: string | null;
  namespace_tag: string | null;
  namespace_description: string | null;
  host_user_disc_ids?: string[] | string | null;
};

type ChatProxyIndexedMessageIdentityRow = ChatProxyContextRow & {
  message_disc_id: string;
  sender_disc_id: string;
};

const CONTEXT_CACHE_MAX_ENTRIES = 2000;

export class ChatProxyRepository {
  private readonly identityContextByUserDiscId = new Map<string, ChatProxyIdentityContext | null>();

  async persistAttestedIdentity(args: {
    input: ProxyIdentityUpsertInput;
    messageDiscId: string;
    senderDiscId: string;
  }): Promise<ChatProxyIdentityUpsertResult | null> {
    const { input } = args;
    const descriptor = getProxyServiceDescriptor(input.serviceId);
    if (
      !descriptor ||
      descriptor.externalIdentityKind !== input.externalIdentityKind ||
      !descriptor.validateExternalKey(input.externalKey)
    ) {
      log.warn(`Rejected invalid chat-proxy identity input for service ${input.serviceId}`);
      return null;
    }

    const userDiscId = formatChatProxyIdentityUserId(descriptor.serviceId, input.externalKey);
    const displayName = input.displayName ?? input.shortId ?? input.externalKey;
    try {
      const persisted = await sql.begin(async (tx) => {
        const [user] = await tx`
          INSERT INTO users (user_disc_id, user_nickname, language_pref, registration_locale)
          VALUES (${userDiscId}, ${displayName}, 'en', 'en')
          ON CONFLICT (user_disc_id) DO UPDATE SET
            user_nickname = CASE
              WHEN users.user_nickname IS DISTINCT FROM EXCLUDED.user_nickname THEN EXCLUDED.user_nickname
              ELSE users.user_nickname
            END,
            updated_at = CASE
              WHEN users.user_nickname IS DISTINCT FROM EXCLUDED.user_nickname THEN NOW()
              ELSE users.updated_at
            END
          RETURNING user_id
        `;
        if (!user?.user_id) throw new Error("Synthetic user upsert returned no identifier");

        await tx`
          INSERT INTO user_personalization_configs (user_id)
          VALUES (${user.user_id})
          ON CONFLICT (user_id) DO NOTHING
        `;

        const [namespaceRow] = await tx`
          INSERT INTO chat_proxy_namespaces (
            service_id, namespace_key, short_id, display_name, tag, description
          )
          VALUES (
            ${input.serviceId}, ${input.namespace.namespaceKey}, ${input.namespace.shortId},
            ${input.namespace.displayName}, ${input.namespace.tag}, ${input.namespace.description}
          )
          ON CONFLICT (service_id, namespace_key) DO UPDATE SET
            short_id = EXCLUDED.short_id,
            display_name = EXCLUDED.display_name,
            tag = EXCLUDED.tag,
            description = EXCLUDED.description,
            updated_at = NOW()
          RETURNING
            chat_proxy_namespace_id, service_id, namespace_key, short_id,
            display_name, tag, description, created_at, updated_at
        `;
        if (!namespaceRow?.chat_proxy_namespace_id) {
          throw new Error("Chat-proxy namespace upsert returned no identifier");
        }

        const [insertedExternalIdentity] = await tx`
          INSERT INTO external_identities (kind, external_key, user_id)
          VALUES (${input.externalIdentityKind}, ${input.externalKey}, ${user.user_id})
          ON CONFLICT (kind, external_key) DO NOTHING
          RETURNING external_identity_id, user_id
        `;
        const [externalIdentity] = insertedExternalIdentity
          ? [insertedExternalIdentity]
          : await tx`
              SELECT external_identity_id, user_id
              FROM external_identities
              WHERE kind = ${input.externalIdentityKind} AND external_key = ${input.externalKey}
              LIMIT 1
            `;
        if (!externalIdentity?.external_identity_id) {
          throw new Error("External identity upsert returned no identifier");
        }
        if (Number(externalIdentity.user_id) !== Number(user.user_id)) {
          throw new Error("External identity resolved to a different synthetic user");
        }

        const [identityRow] = await tx`
          INSERT INTO chat_proxy_identities (
            chat_proxy_namespace_id, external_identity_id, short_id, display_name
          )
          VALUES (
            ${namespaceRow.chat_proxy_namespace_id}, ${externalIdentity.external_identity_id},
            ${input.shortId}, ${input.displayName}
          )
          ON CONFLICT (external_identity_id) DO UPDATE SET
            chat_proxy_namespace_id = EXCLUDED.chat_proxy_namespace_id,
            short_id = EXCLUDED.short_id,
            display_name = EXCLUDED.display_name,
            updated_at = NOW()
          RETURNING
            chat_proxy_identity_id, chat_proxy_namespace_id, external_identity_id,
            short_id, display_name, created_at, updated_at
        `;
        if (!identityRow?.chat_proxy_identity_id) {
          throw new Error("Chat-proxy identity upsert returned no identifier");
        }

        await tx`
          INSERT INTO chat_proxy_namespace_accounts (chat_proxy_namespace_id, host_user_disc_id)
          VALUES (${namespaceRow.chat_proxy_namespace_id}, ${args.senderDiscId})
          ON CONFLICT (chat_proxy_namespace_id, host_user_disc_id) DO NOTHING
        `;
        await tx`
          INSERT INTO chat_proxy_message_index (message_disc_id, external_identity_id, sender_disc_id)
          VALUES (${args.messageDiscId}, ${externalIdentity.external_identity_id}, ${args.senderDiscId})
          ON CONFLICT (message_disc_id) DO NOTHING
        `;

        return {
          namespaceRow,
          identityRow,
          isNewIdentity: Boolean(insertedExternalIdentity),
        };
      });

      const namespace = this.parseNamespaceRow(
        persisted.namespaceRow,
        `${input.serviceId}:${input.namespace.namespaceKey}`,
      );
      const identity = this.parseIdentityRow(persisted.identityRow, `${input.serviceId}:${input.externalKey}`);
      if (!namespace || !identity) return null;
      invalidateUserCache(userDiscId);
      this.identityContextByUserDiscId.clear();
      const userRow = await userRepository.loadByDiscordId(userDiscId);
      if (!userRow) return null;
      return { userRow, namespace, identity, isNewIdentity: persisted.isNewIdentity };
    } catch (error) {
      log.error(`Error persisting chat-proxy identity ${input.serviceId}:${input.externalKey}:`, error);
      return null;
    }
  }

  async getMessageIdentitiesByMessageIds(
    messageDiscIds: string[],
  ): Promise<Map<string, ChatProxyIndexedMessageIdentity> | null> {
    const result = new Map<string, ChatProxyIndexedMessageIdentity>();
    if (messageDiscIds.length === 0) return result;
    try {
      const rows = await sql<ChatProxyIndexedMessageIdentityRow[]>`
        SELECT
          cpmi.message_disc_id,
          cpmi.sender_disc_id,
          cpn.service_id,
          u.user_disc_id,
          ei.external_identity_id,
          ei.external_key,
          cpi.short_id AS identity_short_id,
          cpi.display_name,
          cpn.chat_proxy_namespace_id,
          cpn.namespace_key,
          cpn.short_id AS namespace_short_id,
          cpn.display_name AS namespace_display_name,
          cpn.tag AS namespace_tag,
          cpn.description AS namespace_description,
          COALESCE(
            array_agg(DISTINCT cpna.host_user_disc_id) FILTER (WHERE cpna.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM chat_proxy_message_index cpmi
        JOIN external_identities ei ON ei.external_identity_id = cpmi.external_identity_id
        JOIN users u ON u.user_id = ei.user_id
        JOIN chat_proxy_identities cpi ON cpi.external_identity_id = ei.external_identity_id
        JOIN chat_proxy_namespaces cpn ON cpn.chat_proxy_namespace_id = cpi.chat_proxy_namespace_id
        LEFT JOIN chat_proxy_namespace_accounts cpna
          ON cpna.chat_proxy_namespace_id = cpn.chat_proxy_namespace_id
        WHERE cpmi.message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
        GROUP BY
          cpmi.message_disc_id, cpmi.sender_disc_id, cpn.service_id, u.user_disc_id,
          ei.external_identity_id, ei.external_key, cpi.short_id, cpi.display_name,
          cpn.chat_proxy_namespace_id, cpn.namespace_key, cpn.short_id,
          cpn.display_name, cpn.tag, cpn.description
      `;
      for (const row of rows) {
        const context = this.parseContextRow(row, `message ${row.message_disc_id}`);
        if (!context || !row.sender_disc_id) continue;
        const identity = { ...context, messageDiscId: row.message_disc_id, senderDiscId: row.sender_disc_id };
        result.set(identity.messageDiscId, identity);
        this.rememberContext(identity.userDiscId, context);
      }
      return result;
    } catch (error) {
      log.error(`Error loading chat-proxy message identities (${messageDiscIds.length} ids):`, error);
      return null;
    }
  }

  async getIdentityContextByUserDiscId(userDiscId: string): Promise<ChatProxyIdentityContext | null> {
    if (!parseChatProxyIdentityUserId(userDiscId)) return null;
    if (this.identityContextByUserDiscId.has(userDiscId)) {
      return this.identityContextByUserDiscId.get(userDiscId) ?? null;
    }
    try {
      const [row] = await sql<ChatProxyContextRow[]>`
        SELECT
          cpn.service_id,
          u.user_disc_id,
          ei.external_identity_id,
          ei.external_key,
          cpi.short_id AS identity_short_id,
          cpi.display_name,
          cpn.chat_proxy_namespace_id,
          cpn.namespace_key,
          cpn.short_id AS namespace_short_id,
          cpn.display_name AS namespace_display_name,
          cpn.tag AS namespace_tag,
          cpn.description AS namespace_description,
          COALESCE(
            array_agg(DISTINCT cpna.host_user_disc_id) FILTER (WHERE cpna.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM users u
        JOIN external_identities ei ON ei.user_id = u.user_id
        JOIN chat_proxy_identities cpi ON cpi.external_identity_id = ei.external_identity_id
        JOIN chat_proxy_namespaces cpn ON cpn.chat_proxy_namespace_id = cpi.chat_proxy_namespace_id
        LEFT JOIN chat_proxy_namespace_accounts cpna
          ON cpna.chat_proxy_namespace_id = cpn.chat_proxy_namespace_id
        WHERE u.user_disc_id = ${userDiscId}
        GROUP BY
          cpn.service_id, u.user_disc_id, ei.external_identity_id, ei.external_key,
          cpi.short_id, cpi.display_name, cpn.chat_proxy_namespace_id,
          cpn.namespace_key, cpn.short_id, cpn.display_name, cpn.tag, cpn.description
        LIMIT 1
      `;
      const context = row ? this.parseContextRow(row, `user ${userDiscId}`) : null;
      this.rememberContext(userDiscId, context);
      return context;
    } catch (error) {
      log.error(`Error loading chat-proxy identity context for ${userDiscId}:`, error);
      return null;
    }
  }

  async loadContextReferenceIdentities(params: {
    hostUserDiscIds: readonly string[];
    normalizedHistoryText: string;
  }): Promise<ChatProxyIdentityReference[]> {
    const hostUserDiscIds = [...new Set(params.hostUserDiscIds)];
    const normalizedHistoryText = params.normalizedHistoryText.trim().toLowerCase().replace(/\s+/g, " ");
    if (hostUserDiscIds.length === 0 || !normalizedHistoryText) return [];
    try {
      const rows = await sql<ChatProxyIdentityReferenceRow[]>`
        SELECT DISTINCT cpn.service_id, u.user_disc_id, cpi.display_name, u.user_nickname
        FROM chat_proxy_identities cpi
        JOIN external_identities ei ON ei.external_identity_id = cpi.external_identity_id
        JOIN users u ON u.user_id = ei.user_id
        JOIN chat_proxy_namespaces cpn ON cpn.chat_proxy_namespace_id = cpi.chat_proxy_namespace_id
        JOIN chat_proxy_namespace_accounts cpna
          ON cpna.chat_proxy_namespace_id = cpn.chat_proxy_namespace_id
        WHERE cpna.host_user_disc_id = ANY(${sql.array(hostUserDiscIds, "TEXT")})
          AND (
            (btrim(cpi.display_name) <> '' AND position(
              regexp_replace(lower(trim(cpi.display_name)), '[[:space:]]+', ' ', 'g')
              IN ${normalizedHistoryText}
            ) > 0)
            OR
            (btrim(u.user_nickname) <> '' AND position(
              regexp_replace(lower(trim(u.user_nickname)), '[[:space:]]+', ' ', 'g')
              IN ${normalizedHistoryText}
            ) > 0)
          )
      `;
      return rows.flatMap((row) => {
        const parsed = parseChatProxyIdentityUserId(String(row.user_disc_id));
        if (!parsed || parsed.serviceId !== row.service_id) return [];
        return [
          {
            serviceId: parsed.serviceId,
            userDiscId: String(row.user_disc_id),
            displayName: row.display_name,
            savedNickname: row.user_nickname,
          },
        ];
      });
    } catch (error) {
      log.error("Error loading chat-proxy context reference identities:", error);
      return [];
    }
  }

  async pruneMessageIndexOlderThanDays(retentionDays: number): Promise<number> {
    try {
      const rows = await sql<Array<{ message_disc_id: string }>>`
        DELETE FROM chat_proxy_message_index
        WHERE created_at < NOW() - make_interval(days => ${retentionDays})
        RETURNING message_disc_id
      `;
      return rows.length;
    } catch (error) {
      log.error(`Error pruning chat-proxy message index older than ${retentionDays} days:`, error);
      return 0;
    }
  }

  private rememberContext(userDiscId: string, context: ChatProxyIdentityContext | null): void {
    if (
      !this.identityContextByUserDiscId.has(userDiscId) &&
      this.identityContextByUserDiscId.size >= CONTEXT_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.identityContextByUserDiscId.keys().next().value;
      if (oldestKey) this.identityContextByUserDiscId.delete(oldestKey);
    }
    this.identityContextByUserDiscId.set(userDiscId, context);
  }

  private parseNamespaceRow(row: unknown, context: string): ChatProxyNamespaceRow | null {
    const parsed = chatProxyNamespaceSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid chat_proxy_namespaces row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseIdentityRow(row: unknown, context: string): ChatProxyIdentityRow | null {
    const parsed = chatProxyIdentitySchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid chat_proxy_identities row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseContextRow(row: ChatProxyContextRow, context: string): ChatProxyIdentityContext | null {
    const externalIdentityId = Number(row.external_identity_id);
    const namespaceId = Number(row.chat_proxy_namespace_id);
    const parsedUserId = parseChatProxyIdentityUserId(String(row.user_disc_id));
    const descriptor = getProxyServiceDescriptor(row.service_id);
    if (
      !Number.isSafeInteger(externalIdentityId) ||
      !Number.isSafeInteger(namespaceId) ||
      !parsedUserId ||
      !descriptor ||
      parsedUserId.serviceId !== descriptor.serviceId ||
      parsedUserId.externalKey !== String(row.external_key)
    ) {
      log.warn(`Invalid chat-proxy context row for ${context}`);
      return null;
    }
    return {
      serviceId: descriptor.serviceId,
      userDiscId: String(row.user_disc_id),
      externalIdentityId,
      externalKey: String(row.external_key),
      identityShortId: row.identity_short_id ?? null,
      displayName: row.display_name ?? null,
      namespaceId,
      namespaceKey: String(row.namespace_key),
      namespaceShortId: row.namespace_short_id ?? null,
      namespaceDisplayName: row.namespace_display_name ?? null,
      namespaceTag: row.namespace_tag ?? null,
      namespaceDescription: row.namespace_description ?? null,
      hostUserDiscIds: this.parseTextArray(row.host_user_disc_ids),
    };
  }

  private parseTextArray(value: string[] | string | null | undefined): string[] {
    if (Array.isArray(value)) return value.map(String).filter((entry) => entry.trim().length > 0);
    if (typeof value !== "string" || !value.trim()) return [];
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
}

export const chatProxyRepository = new ChatProxyRepository();
