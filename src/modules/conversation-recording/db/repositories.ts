import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import { z } from "zod";
import { sql } from "@/utils/db/client";
import { readRecordingRetentionDays } from "@/modules/conversation-recording/config";
import {
  RECORDING_QUOTA_BYTES,
  RECORDING_READ_BYTES,
  RECORDING_READ_EXCERPTS,
  recordingSettingsSchema,
  recordingSessionSchema,
  recordingIdentitySchema,
  recordingExcerptInputSchema,
  recordingExcerptSchema,
  storedRecordingMessageSchema,
  recordingAttachmentsSchema,
  type RecordingScope,
  type RecordingToken,
  type RecordingSettings,
  type RecordingSession,
  type RecordingIdentity,
  type RecordingExcerptInput,
  type RecordingAppendResult,
  type RecordingMessage,
  type RecordingRange,
  type RecordingCursor,
  type RecordingPage,
  type RecordingEviction,
  type RecordingSummary,
  type RecordingAttachments,
} from "@/modules/conversation-recording/db/types";

const scopeSchema = z.object({ ownerUserId: z.number().int().positive(), serverId: z.number().int().positive() });
const tokenSchema = z.object({ sessionId: z.string().uuid(), revision: z.number().int().positive() });
const rangeSchema = z.object({ from: z.date(), until: z.date() }).refine((v) => v.from < v.until);
const durationDays = { "24h": 1, "7d": 7, "14d": 14, "30d": 30, unlimited: null } as const;
type Transaction = SQL;

function parseTranscript(value: unknown): RecordingMessage {
  return storedRecordingMessageSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

export class ConversationRecordingRepository {
  constructor(private readonly client: SQL = sql) {}

  async findServerId(serverDiscordId: string): Promise<number | null> {
    const [row] = await this
      .client`SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscordId} AND NOT is_dm_channel`;
    return row?.server_id ?? null;
  }

  async findCaptureScope(serverDiscordId: string, ownerDiscordId: string): Promise<RecordingScope | null> {
    const [row] = await this.client`SELECT s.owner_user_id, s.server_id FROM conversation_recording_sessions s
      JOIN users u ON u.user_id = s.owner_user_id JOIN servers g ON g.server_id = s.server_id
      WHERE g.server_disc_id = ${serverDiscordId} AND NOT g.is_dm_channel AND u.user_disc_id = ${ownerDiscordId}
        AND s.stopped_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > clock_timestamp())`;
    return row ? { ownerUserId: row.owner_user_id, serverId: row.server_id } : null;
  }

  async channelExcluded(serverId: number, channelId: string, parentId: string | null): Promise<boolean> {
    const [row] = await this
      .client`SELECT EXISTS (SELECT 1 FROM server_channel_scope_configs WHERE server_id = ${serverId}
      AND (${channelId} = ANY(private_channel_ids) OR ${parentId} = ANY(private_channel_ids)
        OR ${channelId} = ANY(crosschannel_blocklist_ids) OR ${parentId} = ANY(crosschannel_blocklist_ids))) AS excluded`;
    return row.excluded;
  }

  async eligibleUsers(serverId: number, userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.client<
      Array<{ id: string }>
    >`SELECT id FROM unnest(${this.client.array([...new Set(userIds)], "TEXT")}) AS id
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_disc_id = id AND u.privacy_level = 2)
        AND NOT EXISTS (SELECT 1 FROM personalization_blacklist b WHERE b.server_id = ${serverId} AND b.user_disc_id = id)
        AND NOT EXISTS (SELECT 1 FROM persona_user_blocks b WHERE b.server_id = ${serverId} AND b.user_disc_id = id
          AND b.block_type = 'block' AND b.expires_at > clock_timestamp())`;
    return new Set(rows.map((row) => String(row.id)));
  }

  private async lockOwner(tx: Transaction, ownerUserId: number): Promise<void> {
    const rows = await tx`SELECT user_id FROM users WHERE user_id = ${ownerUserId} FOR NO KEY UPDATE`;
    if (!rows.length) throw new Error("Recording owner does not exist");
  }

  private async now(tx: Transaction): Promise<Date> {
    const [row] = await tx`SELECT clock_timestamp() AS now`;
    return z.date().parse(row.now);
  }

  private cutoff(now: Date): Date | null {
    const days = readRecordingRetentionDays();
    return days === null ? null : new Date(Math.max(-8_640_000_000_000_000, now.getTime() - days * 86_400_000));
  }

  private async reclaim(tx: Transaction, ownerUserId: number): Promise<void> {
    await tx`DELETE FROM conversation_recording_messages m USING conversation_recording_sessions s
      WHERE m.session_id = s.session_id AND s.owner_user_id = ${ownerUserId}
      AND NOT EXISTS (SELECT 1 FROM conversation_recording_excerpt_messages r WHERE r.message_id = m.message_id)`;
    await tx`DELETE FROM conversation_recording_aliases a USING conversation_recording_sessions s
      WHERE a.session_id = s.session_id AND s.owner_user_id = ${ownerUserId} AND s.stopped_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM conversation_recording_excerpts e WHERE e.session_id = s.session_id)`;
  }

  private async maintain(tx: Transaction, ownerUserId: number, now: Date): Promise<void> {
    await tx`UPDATE conversation_recording_sessions SET stopped_at = ends_at, revision = revision + 1
      WHERE owner_user_id = ${ownerUserId} AND stopped_at IS NULL AND ends_at <= ${now}`;
    await tx`UPDATE conversation_recording_sessions s SET stopped_at = ${now}, revision = revision + 1
      FROM users u WHERE s.owner_user_id = ${ownerUserId} AND u.user_id = s.owner_user_id AND s.stopped_at IS NULL
        AND (u.privacy_level = 2 OR EXISTS (SELECT 1 FROM personalization_blacklist b
          WHERE b.server_id = s.server_id AND b.user_disc_id = u.user_disc_id))`;
    const cutoff = this.cutoff(now);
    if (cutoff) {
      await tx`DELETE FROM conversation_recording_excerpts e USING conversation_recording_sessions s
        WHERE e.session_id = s.session_id AND s.owner_user_id = ${ownerUserId} AND e.triggered_at <= ${cutoff}`;
    }
    const removed = await tx`DELETE FROM conversation_recording_messages m USING conversation_recording_sessions s
      WHERE m.session_id = s.session_id AND s.owner_user_id = ${ownerUserId}
      AND (
        EXISTS (SELECT 1 FROM users u WHERE u.user_disc_id = ANY(m.privacy_user_ids) AND u.privacy_level = 2)
        OR EXISTS (SELECT 1 FROM personalization_blacklist b
          WHERE b.server_id = s.server_id AND b.user_disc_id = ANY(m.privacy_user_ids))
        OR EXISTS (SELECT 1 FROM persona_user_blocks b
          WHERE b.server_id = s.server_id AND b.user_disc_id = ANY(m.privacy_user_ids)
            AND b.block_type = 'block' AND b.expires_at > ${now})
        OR EXISTS (SELECT 1 FROM server_channel_scope_configs c WHERE c.server_id = s.server_id
          AND (m.source_channel_id = ANY(c.private_channel_ids)
            OR m.source_parent_channel_id = ANY(c.private_channel_ids)
            OR m.source_channel_id = ANY(c.crosschannel_blocklist_ids)
            OR m.source_parent_channel_id = ANY(c.crosschannel_blocklist_ids)))
      ) RETURNING m.session_id`;
    if (removed.length) {
      await tx`UPDATE conversation_recording_sessions SET revision = revision + 1 WHERE owner_user_id = ${ownerUserId}`;
    }
    await this.reclaim(tx, ownerUserId);
  }

  private async transact<T>(scope: RecordingScope, run: (tx: Transaction, now: Date) => Promise<T>): Promise<T> {
    scopeSchema.parse(scope);
    return this.client.begin(async (tx) => {
      await this.lockOwner(tx, scope.ownerUserId);
      const now = await this.now(tx);
      await this.maintain(tx, scope.ownerUserId, now);
      return run(tx, now);
    }) as Promise<T>;
  }

  private async session(
    tx: Transaction,
    scope: RecordingScope,
    token?: RecordingToken,
  ): Promise<RecordingSession | null> {
    const rows = token
      ? await tx`SELECT * FROM conversation_recording_sessions WHERE owner_user_id = ${scope.ownerUserId}
          AND server_id = ${scope.serverId} AND session_id = ${token.sessionId} AND revision = ${token.revision}`
      : await tx`SELECT * FROM conversation_recording_sessions WHERE owner_user_id = ${scope.ownerUserId}
          AND server_id = ${scope.serverId} AND stopped_at IS NULL`;
    return rows[0] ? recordingSessionSchema.parse(rows[0]) : null;
  }

  async getActive(scope: RecordingScope): Promise<RecordingSession | null> {
    return this.transact(scope, (tx) => this.session(tx, scope));
  }

  async start(
    scope: RecordingScope,
    settings: RecordingSettings,
  ): Promise<{ session: RecordingSession; created: boolean }> {
    recordingSettingsSchema.parse(settings);
    return this.transact(scope, async (tx, now) => {
      const existing = await this.session(tx, scope);
      if (existing) return { session: existing, created: false };
      const [guild] =
        await tx`SELECT server_id FROM servers WHERE server_id = ${scope.serverId} AND is_dm_channel = false`;
      if (!guild) throw new Error("Recordings require a guild");
      const [owner] = await tx`SELECT privacy_level FROM users WHERE user_id = ${scope.ownerUserId}`;
      if (owner.privacy_level === 2) throw new Error("Recording owner is excluded by privacy settings");
      const days = durationDays[settings.duration];
      const endsAt = days === null ? null : new Date(now.getTime() + days * 86_400_000);
      const [row] = await tx`INSERT INTO conversation_recording_sessions
        (session_id, owner_user_id, server_id, context, duration, started_at, ends_at)
        VALUES (${randomUUID()}, ${scope.ownerUserId}, ${scope.serverId}, ${settings.context}, ${settings.duration}, ${now}, ${endsAt})
        RETURNING *`;
      return { session: recordingSessionSchema.parse(row), created: true };
    });
  }

  async updateSettings(
    scope: RecordingScope,
    token: RecordingToken,
    settings: RecordingSettings,
  ): Promise<RecordingSession | null> {
    tokenSchema.parse(token);
    recordingSettingsSchema.parse(settings);
    return this.transact(scope, async (tx, now) => {
      const current = await this.session(tx, scope, token);
      if (!current || current.stopped_at) return null;
      const days = durationDays[settings.duration];
      const endsAt =
        settings.duration === current.duration
          ? current.ends_at
          : days === null
            ? null
            : new Date(now.getTime() + days * 86_400_000);
      const [row] = await tx`UPDATE conversation_recording_sessions SET context = ${settings.context},
        duration = ${settings.duration}, ends_at = ${endsAt}, revision = revision + 1
        WHERE session_id = ${current.session_id} RETURNING *`;
      return recordingSessionSchema.parse(row);
    });
  }

  async stop(scope: RecordingScope, token: RecordingToken): Promise<boolean> {
    tokenSchema.parse(token);
    return this.transact(scope, async (tx, now) => {
      const current = await this.session(tx, scope, token);
      if (!current || current.stopped_at) return false;
      await tx`UPDATE conversation_recording_sessions SET stopped_at = ${now}, revision = revision + 1
        WHERE session_id = ${current.session_id}`;
      await this.reclaim(tx, scope.ownerUserId);
      return true;
    });
  }

  async resolveAliases(
    scope: RecordingScope,
    token: RecordingToken,
    identities: readonly RecordingIdentity[],
  ): Promise<string[] | null> {
    tokenSchema.parse(token);
    z.array(recordingIdentitySchema).max(200).parse(identities);
    return this.transact(scope, async (tx) => {
      const current = await this.session(tx, scope, token);
      if (!current) return null;
      const [owner] = await tx`SELECT user_disc_id FROM users WHERE user_id = ${scope.ownerUserId}`;
      const aliases: string[] = [];
      for (const identity of identities) {
        if (identity.kind === "participant" && identity.sourceId === owner.user_disc_id) {
          aliases.push("SELF");
          continue;
        }
        const [existing] =
          await tx`SELECT alias FROM conversation_recording_aliases WHERE session_id = ${current.session_id}
          AND kind = ${identity.kind} AND source_id = ${identity.sourceId}`;
        if (existing) {
          aliases.push(existing.alias);
          continue;
        }
        const [count] = await tx`SELECT COUNT(*)::INT AS count FROM conversation_recording_aliases
          WHERE session_id = ${current.session_id} AND kind = ${identity.kind}`;
        const alias = `${identity.kind.toUpperCase()}_${count.count + 1}`;
        await tx`INSERT INTO conversation_recording_aliases (session_id, kind, source_id, alias)
          VALUES (${current.session_id}, ${identity.kind}, ${identity.sourceId}, ${alias})`;
        aliases.push(alias);
      }
      return aliases;
    });
  }

  private async isPrivate(
    tx: Transaction,
    scope: RecordingScope,
    input: RecordingExcerptInput,
    now: Date,
  ): Promise<boolean> {
    const ids = [...new Set(input.messages.flatMap((m) => [m.sourceAuthorId, ...m.privacyUserIds]))];
    const [row] = await tx`SELECT
      EXISTS (SELECT 1 FROM users WHERE user_disc_id IN ${tx(ids)} AND privacy_level = 2)
      OR EXISTS (SELECT 1 FROM personalization_blacklist WHERE server_id = ${scope.serverId} AND user_disc_id IN ${tx(ids)})
      OR EXISTS (SELECT 1 FROM persona_user_blocks WHERE server_id = ${scope.serverId} AND user_disc_id IN ${tx(ids)}
        AND block_type = 'block' AND expires_at > ${now})
      OR EXISTS (SELECT 1 FROM server_channel_scope_configs WHERE server_id = ${scope.serverId}
        AND (${input.sourceChannelId} = ANY(private_channel_ids) OR ${input.sourceParentChannelId} = ANY(private_channel_ids)
          OR ${input.sourceChannelId} = ANY(crosschannel_blocklist_ids) OR ${input.sourceParentChannelId} = ANY(crosschannel_blocklist_ids)))
      AS private`;
    return row.private;
  }

  private async evict(tx: Transaction, ownerUserId: number, now: Date): Promise<RecordingEviction> {
    const rows = await tx<
      Array<{ excerpt_id: string; session_id: string; logical_bytes: number | string }>
    >`WITH ranked AS (
      SELECT v.*, SUM(v.logical_bytes) OVER (ORDER BY v.triggered_at DESC, v.excerpt_id DESC) AS running
      FROM conversation_recording_excerpt_sizes v JOIN conversation_recording_sessions s USING (session_id)
      WHERE s.owner_user_id = ${ownerUserId}
    ) SELECT * FROM ranked WHERE running > ${RECORDING_QUOTA_BYTES}`;
    const result = { excerpts: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.logical_bytes), 0) };
    for (const sessionId of new Set<string>(rows.map((row) => row.session_id))) {
      const evicted = rows.filter((row) => row.session_id === sessionId);
      await tx`UPDATE conversation_recording_sessions SET evicted_excerpts = evicted_excerpts + ${evicted.length},
        evicted_bytes = evicted_bytes + ${evicted.reduce((sum, row) => sum + Number(row.logical_bytes), 0)}, last_evicted_at = ${now},
        revision = revision + 1
        WHERE session_id = ${sessionId}`;
    }
    if (rows.length) {
      await tx`DELETE FROM conversation_recording_excerpts WHERE excerpt_id IN ${tx(rows.map((row) => row.excerpt_id))}`;
      await this.reclaim(tx, ownerUserId);
    }
    return result;
  }

  async append(
    scope: RecordingScope,
    token: RecordingToken,
    input: RecordingExcerptInput,
  ): Promise<RecordingAppendResult> {
    tokenSchema.parse(token);
    recordingExcerptInputSchema.parse(input);
    const trigger = input.messages.at(-1);
    if (!trigger || new Set(input.messages.map((m) => m.sourceMessageId)).size !== input.messages.length) {
      throw new Error("Recording messages must be unique and chronological");
    }
    for (const [i, message] of input.messages.entries()) {
      const previous = input.messages[i - 1];
      if (
        previous &&
        (message.timestamp < previous.timestamp ||
          (message.timestamp.getTime() === previous.timestamp.getTime() &&
            BigInt(message.sourceMessageId) <= BigInt(previous.sourceMessageId)))
      ) {
        throw new Error("Recording messages must be unique and chronological");
      }
    }
    return this.transact(scope, async (tx, now) => {
      const current = await this.session(tx, scope, token);
      const cutoff = this.cutoff(now);
      if (
        !current ||
        current.stopped_at ||
        trigger.timestamp < current.started_at ||
        trigger.timestamp > now ||
        (cutoff && trigger.timestamp <= cutoff)
      )
        return { status: "stale" };
      const [owner] = await tx`SELECT user_disc_id FROM users WHERE user_id = ${scope.ownerUserId}`;
      if (
        trigger.sourceAuthorId !== owner.user_disc_id ||
        trigger.speaker !== "SELF" ||
        (current.context === "own" &&
          input.messages.some((m) => m.sourceAuthorId !== owner.user_disc_id || m.speaker !== "SELF"))
      ) {
        throw new Error("Recording excerpt does not match its owner and context");
      }
      if (await this.isPrivate(tx, scope, input, now)) return { status: "private" };
      const duplicate = await tx`SELECT excerpt_id FROM conversation_recording_excerpts
        WHERE session_id = ${current.session_id} AND trigger_source_message_id = ${trigger.sourceMessageId}`;
      if (duplicate.length) return { status: "duplicate" };
      const id = randomUUID();
      const header = {
        version: 1 as const,
        id,
        sessionId: current.session_id,
        triggeredAt: trigger.timestamp.toISOString(),
        context: current.context,
        messages: [],
      };
      const overhead = Buffer.byteLength(JSON.stringify(header), "utf8");
      const messages: Array<{
        incoming: RecordingExcerptInput["messages"][number];
        sourceId: string;
        message: RecordingMessage;
        replySourceId: string | null;
      }> = [];
      for (const incoming of input.messages) {
        const [existing] = await tx`SELECT transcript FROM conversation_recording_messages
          WHERE session_id = ${current.session_id} AND source_message_id = ${incoming.sourceMessageId}`;
        const message = existing
          ? parseTranscript(existing.transcript)
          : storedRecordingMessageSchema.parse({
              id: randomUUID(),
              timestamp: incoming.timestamp.toISOString(),
              editedTimestamp: incoming.editedTimestamp?.toISOString() ?? null,
              speaker: incoming.speaker,
              channel: incoming.channel,
              body: incoming.body,
              attachments: incoming.attachments,
              replyTo: null,
            });
        messages.push({
          incoming,
          sourceId: incoming.sourceMessageId,
          message,
          replySourceId: incoming.replyToSourceMessageId,
        });
      }
      const projected = messages.map(({ message, replySourceId }) => ({
        ...message,
        replyTo: messages.find((m) => m.sourceId === replySourceId)?.message.id ?? null,
      }));
      if (Buffer.byteLength(JSON.stringify({ ...header, messages: projected }), "utf8") > RECORDING_QUOTA_BYTES)
        return { status: "too-large" };
      for (const { incoming, message } of messages) {
        const privacyIds = [...new Set([incoming.sourceAuthorId, ...incoming.privacyUserIds])];
        await tx`INSERT INTO conversation_recording_messages (session_id, source_message_id, source_channel_id,
          source_parent_channel_id, source_author_id, privacy_user_ids, message_id, transcript, logical_bytes)
          VALUES (${current.session_id}, ${incoming.sourceMessageId}, ${input.sourceChannelId}, ${input.sourceParentChannelId},
            ${incoming.sourceAuthorId}, ${sql.array(privacyIds, "TEXT")}, ${message.id}, ${message}::jsonb, ${Buffer.byteLength(JSON.stringify(message), "utf8")})
          ON CONFLICT (session_id, source_message_id) DO NOTHING`;
      }
      await tx`INSERT INTO conversation_recording_excerpts
        (excerpt_id, session_id, trigger_source_message_id, triggered_at, context, overhead_bytes)
        VALUES (${id}, ${current.session_id}, ${trigger.sourceMessageId}, ${trigger.timestamp}, ${current.context}, ${overhead})`;
      for (const [i, message] of projected.entries()) {
        await tx`INSERT INTO conversation_recording_excerpt_messages (excerpt_id, message_id, position, reply_to)
          VALUES (${id}, ${message.id}, ${i}, ${message.replyTo})`;
      }
      return { status: "stored", excerptId: id, eviction: await this.evict(tx, scope.ownerUserId, now) };
    });
  }

  async summary(scope: RecordingScope): Promise<RecordingSummary> {
    return this.transact(scope, async (tx) => {
      const [row] = await tx`SELECT COALESCE(SUM(v.logical_bytes), 0) AS owner_bytes,
        COALESCE(SUM(v.logical_bytes) FILTER (WHERE s.server_id = ${scope.serverId}), 0) AS server_bytes,
        COUNT(*) FILTER (WHERE s.server_id = ${scope.serverId}) AS excerpts,
        MIN(v.triggered_at) FILTER (WHERE s.server_id = ${scope.serverId}) AS oldest
        FROM conversation_recording_excerpt_sizes v JOIN conversation_recording_sessions s USING (session_id)
        WHERE s.owner_user_id = ${scope.ownerUserId}`;
      const [evictions] = await tx`SELECT COALESCE(SUM(evicted_excerpts), 0) AS excerpts,
        COALESCE(SUM(evicted_bytes), 0) AS bytes, MAX(last_evicted_at) AS last
        FROM conversation_recording_sessions WHERE owner_user_id = ${scope.ownerUserId} AND server_id = ${scope.serverId}`;
      const days = readRecordingRetentionDays();
      return {
        session: await this.session(tx, scope),
        ownerBytes: Number(row.owner_bytes),
        serverBytes: Number(row.server_bytes),
        excerpts: Number(row.excerpts),
        quotaBytes: RECORDING_QUOTA_BYTES,
        retentionDays: days,
        nextExpiry: days !== null && row.oldest ? new Date(new Date(row.oldest).getTime() + days * 86_400_000) : null,
        evictedExcerpts: Number(evictions.excerpts),
        evictedBytes: Number(evictions.bytes),
        lastEvictedAt: evictions.last,
      };
    });
  }

  async readRange(scope: RecordingScope, range: RecordingRange, cursor?: RecordingCursor): Promise<RecordingPage> {
    rangeSchema.parse(range);
    if (cursor) z.object({ triggeredAt: z.date(), excerptId: z.string().uuid() }).parse(cursor);
    return this.transact(scope, async (tx) => {
      const rows = await tx`SELECT e.*, v.logical_bytes FROM conversation_recording_excerpts e
        JOIN conversation_recording_sessions s USING (session_id)
        JOIN conversation_recording_excerpt_sizes v USING (excerpt_id)
        WHERE s.owner_user_id = ${scope.ownerUserId} AND s.server_id = ${scope.serverId}
          AND e.triggered_at >= ${range.from} AND e.triggered_at < ${range.until}
          AND (e.triggered_at, e.excerpt_id) > (${cursor?.triggeredAt ?? range.from}, ${cursor?.excerptId ?? "00000000-0000-0000-0000-000000000000"}::uuid)
        ORDER BY e.triggered_at, e.excerpt_id LIMIT ${RECORDING_READ_EXCERPTS + 1}`;
      const page: RecordingPage = { excerpts: [], nextCursor: null, bytes: 0, oversized: false };
      for (const row of rows) {
        if (
          page.excerpts.length === RECORDING_READ_EXCERPTS ||
          page.bytes + Number(row.logical_bytes) > RECORDING_READ_BYTES
        ) {
          page.oversized = page.excerpts.length === 0;
          const last = page.excerpts.at(-1);
          page.nextCursor = last ? { triggeredAt: new Date(last.triggeredAt), excerptId: last.id } : (cursor ?? null);
          break;
        }
        const refs = await tx<
          Array<{ transcript: unknown; reply_to: string | null }>
        >`SELECT m.transcript, r.reply_to FROM conversation_recording_excerpt_messages r
          JOIN conversation_recording_messages m USING (message_id) WHERE r.excerpt_id = ${row.excerpt_id} ORDER BY r.position`;
        page.excerpts.push(
          recordingExcerptSchema.parse({
            version: 1,
            id: row.excerpt_id,
            sessionId: row.session_id,
            triggeredAt: row.triggered_at.toISOString(),
            context: row.context,
            messages: refs.map((ref) => ({ ...parseTranscript(ref.transcript), replyTo: ref.reply_to })),
          }),
        );
        page.bytes += Number(row.logical_bytes);
      }
      return page;
    });
  }

  async deleteRange(scope: RecordingScope, range: RecordingRange | null): Promise<number> {
    if (range) rangeSchema.parse(range);
    return this.transact(scope, async (tx) => {
      await tx`UPDATE conversation_recording_sessions SET revision = revision + 1
        WHERE owner_user_id = ${scope.ownerUserId} AND server_id = ${scope.serverId}`;
      const removed = range
        ? await tx`DELETE FROM conversation_recording_excerpts e USING conversation_recording_sessions s
            WHERE e.session_id = s.session_id AND s.owner_user_id = ${scope.ownerUserId} AND s.server_id = ${scope.serverId}
            AND e.triggered_at >= ${range.from} AND e.triggered_at < ${range.until}`
        : await tx`DELETE FROM conversation_recording_excerpts e USING conversation_recording_sessions s
            WHERE e.session_id = s.session_id AND s.owner_user_id = ${scope.ownerUserId} AND s.server_id = ${scope.serverId}`;
      await this.reclaim(tx, scope.ownerUserId);
      return removed.count;
    });
  }

  async listSourceCopies(
    serverId: number,
    sourceChannelId: string,
    sourceMessageId: string,
  ): Promise<
    Array<{
      scope: RecordingScope;
      token: RecordingToken;
      ownerDiscordId: string;
      sourceAuthorId: string;
      privacyUserIds: string[];
    }>
  > {
    const rows = await this.client<
      Array<{
        owner_user_id: number;
        server_id: number;
        session_id: string;
        revision: number;
        user_disc_id: string;
        source_author_id: string;
        privacy_user_ids: unknown;
      }>
    >`SELECT s.owner_user_id, s.server_id, s.session_id, s.revision,
      m.source_author_id, m.privacy_user_ids, u.user_disc_id
      FROM conversation_recording_messages m JOIN conversation_recording_sessions s USING (session_id)
      JOIN users u ON u.user_id = s.owner_user_id
      WHERE s.server_id = ${serverId} AND m.source_channel_id = ${sourceChannelId} AND m.source_message_id = ${sourceMessageId}`;
    return rows.map((row) => ({
      scope: { ownerUserId: row.owner_user_id, serverId: row.server_id },
      token: { sessionId: row.session_id, revision: row.revision },
      ownerDiscordId: row.user_disc_id,
      sourceAuthorId: row.source_author_id,
      privacyUserIds: z.array(z.string()).parse(row.privacy_user_ids),
    }));
  }

  async updateSource(
    scope: RecordingScope,
    token: RecordingToken,
    sourceMessageId: string,
    update: { body: string; editedTimestamp: Date; attachments?: RecordingAttachments },
  ): Promise<{ updated: boolean; eviction: RecordingEviction }> {
    tokenSchema.parse(token);
    z.object({ body: z.string(), editedTimestamp: z.date(), attachments: recordingAttachmentsSchema.optional() })
      .strict()
      .parse(update);
    return this.transact(scope, async (tx, now) => {
      const current = await this.session(tx, scope, token);
      const unchanged = { updated: false, eviction: { excerpts: 0, bytes: 0 } };
      if (!current) return unchanged;
      const [row] = await tx`SELECT transcript FROM conversation_recording_messages
        WHERE session_id = ${current.session_id} AND source_message_id = ${sourceMessageId}`;
      if (!row) return unchanged;
      const original = parseTranscript(row.transcript);
      if (original.editedTimestamp && new Date(original.editedTimestamp) >= update.editedTimestamp) return unchanged;
      const message = storedRecordingMessageSchema.parse({
        ...original,
        body: update.body,
        attachments: update.attachments ?? original.attachments,
        editedTimestamp: update.editedTimestamp.toISOString(),
      });
      await tx`UPDATE conversation_recording_messages SET transcript = ${message}::jsonb,
        logical_bytes = ${Buffer.byteLength(JSON.stringify(message), "utf8")}
        WHERE session_id = ${current.session_id} AND source_message_id = ${sourceMessageId}`;
      return { updated: true, eviction: await this.evict(tx, scope.ownerUserId, now) };
    });
  }

  async deleteSources(serverId: number, sourceChannelId: string, sourceMessageIds: readonly string[]): Promise<number> {
    z.array(z.string().regex(/^\d{1,20}$/))
      .min(1)
      .max(100)
      .parse(sourceMessageIds);
    const owners = await this.client`SELECT DISTINCT owner_user_id FROM conversation_recording_sessions
      WHERE server_id = ${serverId} ORDER BY owner_user_id`;
    let deleted = 0;
    for (const owner of owners) {
      deleted += await this.transact({ ownerUserId: owner.owner_user_id, serverId }, async (tx) => {
        await tx`UPDATE conversation_recording_sessions SET revision = revision + 1
          WHERE owner_user_id = ${owner.owner_user_id} AND server_id = ${serverId}`;
        const rows = await tx`DELETE FROM conversation_recording_messages m USING conversation_recording_sessions s
          WHERE m.session_id = s.session_id AND s.owner_user_id = ${owner.owner_user_id} AND s.server_id = ${serverId}
            AND m.source_channel_id = ${sourceChannelId} AND m.source_message_id IN ${tx([...sourceMessageIds])}`;
        await this.reclaim(tx, owner.owner_user_id);
        return rows.count;
      });
    }
    return deleted;
  }

  async removePrivateParticipant(sourceUserId: string, serverId?: number): Promise<number> {
    const owners = await this.client`SELECT DISTINCT s.owner_user_id FROM conversation_recording_sessions s
      JOIN users u ON u.user_id = s.owner_user_id
      LEFT JOIN conversation_recording_messages m USING (session_id)
      WHERE (${sourceUserId} = ANY(m.privacy_user_ids) OR u.user_disc_id = ${sourceUserId})
        AND (${serverId ?? null}::int IS NULL OR s.server_id = ${serverId ?? null})
      ORDER BY s.owner_user_id`;
    let deleted = 0;
    for (const owner of owners) {
      deleted += await this.client.begin(async (tx) => {
        await this.lockOwner(tx, owner.owner_user_id);
        await tx`UPDATE conversation_recording_sessions SET revision = revision + 1
          WHERE owner_user_id = ${owner.owner_user_id} AND (${serverId ?? null}::int IS NULL OR server_id = ${serverId ?? null})`;
        await tx`UPDATE conversation_recording_sessions s SET stopped_at = clock_timestamp()
          FROM users u WHERE u.user_id = s.owner_user_id AND u.user_disc_id = ${sourceUserId} AND u.privacy_level = 2
            AND s.owner_user_id = ${owner.owner_user_id} AND s.stopped_at IS NULL
            AND (${serverId ?? null}::int IS NULL OR s.server_id = ${serverId ?? null})`;
        const rows = await tx`DELETE FROM conversation_recording_messages m USING conversation_recording_sessions s
          WHERE m.session_id = s.session_id AND s.owner_user_id = ${owner.owner_user_id}
          AND (${serverId ?? null}::int IS NULL OR s.server_id = ${serverId ?? null}) AND ${sourceUserId} = ANY(m.privacy_user_ids)`;
        await this.reclaim(tx, owner.owner_user_id);
        return rows.count;
      });
    }
    return deleted;
  }

  async cleanup(): Promise<number> {
    const cutoff = this.cutoff(await this.now(this.client));
    const candidates = await this.client`SELECT DISTINCT s.owner_user_id FROM conversation_recording_sessions s
      WHERE (s.stopped_at IS NULL AND s.ends_at <= clock_timestamp())
        OR EXISTS (SELECT 1 FROM conversation_recording_excerpts e WHERE e.session_id = s.session_id AND e.triggered_at <= ${cutoff})
      ORDER BY s.owner_user_id LIMIT 10`;
    let deleted = 0;
    for (const owner of candidates) {
      deleted += await this.client.begin(async (tx) => {
        await this.lockOwner(tx, owner.owner_user_id);
        const now = await this.now(tx);
        await tx`UPDATE conversation_recording_sessions SET stopped_at = ends_at, revision = revision + 1
          WHERE session_id IN (SELECT session_id FROM conversation_recording_sessions WHERE owner_user_id = ${owner.owner_user_id}
            AND stopped_at IS NULL AND ends_at <= ${now} ORDER BY ends_at LIMIT 100)`;
        const rows = await tx`DELETE FROM conversation_recording_excerpts WHERE excerpt_id IN (
          SELECT e.excerpt_id FROM conversation_recording_excerpts e JOIN conversation_recording_sessions s USING (session_id)
          WHERE s.owner_user_id = ${owner.owner_user_id} AND e.triggered_at <= ${this.cutoff(now)}
          ORDER BY e.triggered_at, e.excerpt_id LIMIT 100)`;
        await this.reclaim(tx, owner.owner_user_id);
        return rows.count;
      });
    }
    return deleted;
  }
}

export const conversationRecordingRepository = new ConversationRecordingRepository();
