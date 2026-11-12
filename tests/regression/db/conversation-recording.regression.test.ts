import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ConversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { PrivacyLevel } from "@/types/db/schema";
import {
  RECORDING_QUOTA_BYTES,
  RECORDING_READ_BYTES,
  type RecordingScope,
  type RecordingSession,
  type RecordingMessageInput,
  type RecordingExcerptInput,
} from "@/modules/conversation-recording/db/types";
import { useEnvSandbox } from "../../helpers/env";
import { cleanupFixtures, insertFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql, executeTestSqlFile } from "./setup/testDb";

const range = { from: new Date(0), until: new Date("2100-01-01T00:00:00.000Z") };
const token = (session: RecordingSession) => ({ sessionId: session.session_id, revision: session.revision });
const noAttachments = { image: 0, video: 0, audio: 0, file: 0 };

describe.skipIf(!DB_TESTS_AVAILABLE)("conversation recording storage", () => {
  useEnvSandbox(["RECORD_RETENTION_DAYS"]);
  const repo = new ConversationRecordingRepository(testSql);
  const peer = new ConversationRecordingRepository(testSql);
  let refs: FixtureRefs;
  let scope: RecordingScope;
  let second: RecordingScope;
  let other: RecordingScope;
  let secondServerId: number;
  let secondUserId: number;
  let sequence = 1000;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_recording_server') RETURNING server_id`;
    const [user] = await testSql`INSERT INTO users (user_disc_id) VALUES ('_rt_recording_user') RETURNING user_id`;
    secondServerId = server.server_id;
    secondUserId = user.user_id;
    scope = { ownerUserId: refs.userId, serverId: refs.serverId };
    second = { ...scope, serverId: secondServerId };
    other = { ownerUserId: secondUserId, serverId: refs.serverId };
  });
  beforeEach(async () => {
    delete process.env.RECORD_RETENTION_DAYS;
    await testSql`DELETE FROM conversation_recording_sessions WHERE owner_user_id IN (${refs.userId}, ${secondUserId})`;
    await testSql`UPDATE users SET privacy_level = 0 WHERE user_id IN (${refs.userId}, ${secondUserId})`;
    await testSql`DELETE FROM personalization_blacklist WHERE server_id IN (${refs.serverId}, ${secondServerId})`;
    await testSql`UPDATE server_channel_scope_configs SET private_channel_ids = '{}', crosschannel_blocklist_ids = '{}' WHERE server_id = ${refs.serverId}`;
  });
  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_id = ${secondServerId}`;
    await testSql`DELETE FROM users WHERE user_id = ${secondUserId}`;
    await cleanupFixtures(testSql);
  });

  async function start(target = scope, context: "own" | "surrounding" = "surrounding"): Promise<RecordingSession> {
    return (await repo.start(target, { duration: "unlimited", context })).session;
  }
  function message(overrides: Partial<RecordingMessageInput> = {}): RecordingMessageInput {
    return {
      sourceMessageId: String(++sequence),
      sourceAuthorId: FIXTURE_IDS.userDiscId,
      privacyUserIds: [],
      timestamp: new Date(),
      editedTimestamp: null,
      speaker: "SELF",
      channel: "CHANNEL_1",
      body: "A lantern beside the door.",
      attachments: { ...noAttachments },
      replyToSourceMessageId: null,
      ...overrides,
    };
  }
  function excerpt(messages: RecordingMessageInput[]): RecordingExcerptInput {
    return { sourceChannelId: "200000000000000001", sourceParentChannelId: null, messages };
  }
  async function records(target = scope) {
    return (await repo.readRange(target, range)).excerpts;
  }

  it("isolates owner/server data, preserves active consent, and rejects foreign tokens and DMs", async () => {
    const active = await start();
    expect((await repo.start(scope, { duration: "7d", context: "own" })).created).toBe(false);
    expect((await repo.getActive(scope))?.context).toBe("surrounding");
    const input = excerpt([message()]);
    expect((await repo.append(scope, token(active), input)).status).toBe("stored");
    expect((await repo.append(scope, token(active), input)).status).toBe("duplicate");
    expect(await records(second)).toHaveLength(0);
    expect(await records(other)).toHaveLength(0);
    expect(await repo.stop(other, token(active))).toBe(false);
    expect(await repo.deleteRange(other, null)).toBe(0);
    expect(await records()).toHaveLength(1);
    await testSql`UPDATE servers SET is_dm_channel = true WHERE server_id = ${secondServerId}`;
    try {
      await expect(start(second)).rejects.toBeInstanceOf(Error);
    } finally {
      await testSql`UPDATE servers SET is_dm_channel = false WHERE server_id = ${secondServerId}`;
    }
  });

  it("round trips attachment-only messages and exact logical JSON bytes through overlapping excerpts and edits", async () => {
    const active = await start();
    const first = message({ body: "", attachments: { image: 2, video: 1, audio: 1, file: 1 } });
    await repo.append(scope, token(active), excerpt([first]));
    const secondMessage = message({ replyToSourceMessageId: first.sourceMessageId });
    await repo.append(scope, token(active), excerpt([first, secondMessage]));
    const saved = await records();
    expect(saved[0]?.messages[0]).toMatchObject({ body: "", attachments: first.attachments });
    expect(saved[1]?.messages[1]?.replyTo).toBe(saved[0]?.messages[0]?.id);
    expect((await repo.summary(scope)).ownerBytes).toBe(
      saved.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0),
    );
    expect(
      await testSql`SELECT message_id FROM conversation_recording_messages WHERE session_id = ${active.session_id}`,
    ).toHaveLength(2);
    await repo.updateSource(scope, token(active), first.sourceMessageId, {
      body: "SELF saw CHANNEL_1.",
      editedTimestamp: new Date(Date.now() + 1000),
    });
    const edited = await records();
    expect(edited.every((entry) => entry.messages[0]?.attachments.image === 2)).toBe(true);
    expect((await repo.summary(scope)).ownerBytes).toBe(
      edited.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0),
    );
    await repo.updateSource(scope, token(active), first.sourceMessageId, {
      body: "",
      editedTimestamp: new Date(Date.now() + 2000),
      attachments: { ...noAttachments, file: 2 },
    });
    const updatedMetadata = await records();
    expect(updatedMetadata.every((entry) => entry.messages[0]?.attachments.file === 2)).toBe(true);
    expect((await repo.summary(scope)).ownerBytes).toBe(
      updatedMetadata.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0),
    );
    await repo.deleteRange(scope, { from: first.timestamp, until: new Date(first.timestamp.getTime() + 1) });
    const remaining = await records();
    expect(remaining).toHaveLength(1);
    expect(
      await testSql`SELECT message_id FROM conversation_recording_messages WHERE session_id = ${active.session_id}`,
    ).toHaveLength(2);
    await repo.deleteRange(scope, null);
    expect(
      await testSql`SELECT message_id FROM conversation_recording_messages WHERE session_id = ${active.session_id}`,
    ).toHaveLength(0);
  });

  it("keeps context snapshots while settings fence old capture and change the collection end", async () => {
    const active = await start();
    await repo.append(scope, token(active), excerpt([message()]));
    const changed = await repo.updateSettings(scope, token(active), { duration: "24h", context: "own" });
    if (!changed) throw new Error("Missing settings result");
    expect(changed.ends_at?.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect((await repo.append(scope, token(active), excerpt([message()]))).status).toBe("stale");
    await expect(
      repo.append(
        scope,
        token(changed),
        excerpt([message({ sourceAuthorId: "_rt_recording_user", speaker: "PARTICIPANT_1" }), message()]),
      ),
    ).rejects.toBeInstanceOf(Error);
    await repo.append(scope, token(changed), excerpt([message()]));
    expect((await records()).map((entry) => entry.context)).toEqual(["surrounding", "own"]);
    const contextOnly = await repo.updateSettings(scope, token(changed), { duration: "24h", context: "surrounding" });
    expect(contextOnly?.ends_at?.getTime()).toBe(changed.ends_at?.getTime());
  });

  it("assigns stable aliases across concurrent callers and permits sanitized edits after stop", async () => {
    const active = await start();
    const identities = [
      { kind: "participant" as const, sourceId: FIXTURE_IDS.userDiscId },
      { kind: "participant" as const, sourceId: "_rt_recording_user" },
      { kind: "channel" as const, sourceId: "200000000000000001" },
    ];
    const aliases = await Promise.all([
      repo.resolveAliases(scope, token(active), identities),
      peer.resolveAliases(scope, token(active), identities),
    ]);
    expect(aliases[0]).toEqual(["SELF", "PARTICIPANT_1", "CHANNEL_1"]);
    expect(aliases[1]).toEqual(aliases[0]);
    const input = message();
    await repo.append(scope, token(active), excerpt([input]));
    await repo.stop(scope, token(active));
    const [copy] = await repo.listSourceCopies(scope.serverId, "200000000000000001", input.sourceMessageId);
    if (!copy) throw new Error("Missing source copy");
    expect(await repo.resolveAliases(scope, copy.token, identities)).toEqual(aliases[0]);
    expect(
      (
        await repo.updateSource(scope, copy.token, input.sourceMessageId, {
          body: "PARTICIPANT_1 arrived.",
          editedTimestamp: new Date(),
        })
      ).updated,
    ).toBe(true);
    expect((await records())[0]?.messages[0]?.body.length).toBeGreaterThan(0);
  });

  it("enforces newly configured retention on reads and writes and bounded cleanup", async () => {
    const active = await start();
    await repo.append(scope, token(active), excerpt([message()]));
    await testSql`UPDATE conversation_recording_excerpts SET triggered_at = clock_timestamp() - interval '3 days' WHERE session_id = ${active.session_id}`;
    expect((await repo.summary(scope)).excerpts).toBe(1);
    process.env.RECORD_RETENTION_DAYS = "1";
    expect(await records()).toHaveLength(0);
    expect((await repo.summary(scope)).ownerBytes).toBe(0);
    await testSql`UPDATE conversation_recording_sessions SET started_at = clock_timestamp() - interval '5 days' WHERE session_id = ${active.session_id}`;
    expect(
      (
        await repo.append(
          scope,
          token(active),
          excerpt([message({ timestamp: new Date(Date.now() - 3 * 86_400_000) })]),
        )
      ).status,
    ).toBe("stale");
    await testSql`UPDATE conversation_recording_sessions SET ends_at = clock_timestamp() - interval '1 second' WHERE session_id = ${active.session_id}`;
    await repo.cleanup();
    expect(await repo.getActive(scope)).toBeNull();
    expect((await repo.append(scope, token(active), excerpt([message()]))).status).toBe("stale");
  });

  it("serializes cross-server quota and evicts whole oldest excerpts without truncation", async () => {
    const first = await start();
    const next = await start(second);
    const body = "海".repeat(4000);
    const seed = Array.from({ length: 11 }, () => message({ body }));
    const [prototype] = seed;
    if (!prototype) throw new Error("Missing seed message");
    await repo.append(scope, token(first), excerpt(seed));
    const bytes = (await repo.summary(scope)).ownerBytes;
    const clones = Math.floor(RECORDING_QUOTA_BYTES / bytes) - 1;
    await testSql`UPDATE conversation_recording_sessions SET started_at = clock_timestamp() - interval '1 day' WHERE session_id = ${first.session_id}`;
    await testSql`WITH generated AS MATERIALIZED (
      SELECT n, gen_random_uuid() AS id, clock_timestamp() - interval '1 hour' + n * interval '1 millisecond' AS sent
      FROM generate_series(0, ${clones * 11 - 1}) n
    ) INSERT INTO conversation_recording_messages (session_id, source_message_id, source_channel_id,
      source_parent_channel_id, source_author_id, privacy_user_ids, message_id, transcript, logical_bytes)
      SELECT m.session_id, (100000 + g.n)::text, m.source_channel_id, m.source_parent_channel_id, m.source_author_id,
        m.privacy_user_ids, g.id, m.transcript || jsonb_build_object('id', g.id::text,
          'timestamp', to_char(g.sent AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), m.logical_bytes
      FROM generated g CROSS JOIN conversation_recording_messages m
      WHERE m.session_id = ${first.session_id} AND m.source_message_id = ${prototype.sourceMessageId}`;
    await testSql`INSERT INTO conversation_recording_excerpts
      (excerpt_id, session_id, trigger_source_message_id, triggered_at, context, overhead_bytes)
      SELECT gen_random_uuid(), m.session_id, m.source_message_id, (m.transcript->>'timestamp')::timestamptz, e.context, e.overhead_bytes
      FROM conversation_recording_messages m CROSS JOIN conversation_recording_excerpts e
      WHERE m.session_id = ${first.session_id} AND m.source_message_id::bigint >= 100000
        AND (m.source_message_id::bigint - 100000) % 11 = 10 AND e.session_id = ${first.session_id}`;
    await testSql`INSERT INTO conversation_recording_excerpt_messages (excerpt_id, message_id, position)
      SELECT e.excerpt_id, m.message_id, (m.source_message_id::bigint - 100000) % 11
      FROM conversation_recording_messages m JOIN conversation_recording_excerpts e ON e.session_id = m.session_id
      WHERE m.session_id = ${first.session_id} AND m.source_message_id::bigint >= 100000
        AND (m.source_message_id::bigint - 100000) / 11 = (e.trigger_source_message_id::bigint - 100000) / 11`;
    const [oldest] = await testSql`SELECT excerpt_id FROM conversation_recording_excerpts
      WHERE session_id = ${first.session_id} ORDER BY triggered_at, excerpt_id LIMIT 1`;
    await Promise.all([
      repo.append(scope, token(first), excerpt(Array.from({ length: 11 }, () => message({ body })))),
      peer.append(second, token(next), excerpt(Array.from({ length: 11 }, () => message({ body })))),
    ]);
    const usage = await repo.summary(scope);
    expect(usage.ownerBytes).toBeLessThanOrEqual(RECORDING_QUOTA_BYTES);
    expect(usage.ownerBytes).toBeGreaterThan(RECORDING_QUOTA_BYTES - bytes);
    expect(usage.evictedExcerpts).toBeGreaterThan(0);
    expect((await repo.append(scope, token(first), excerpt([message()]))).status).toBe("stale");
    expect(
      await testSql`SELECT excerpt_id FROM conversation_recording_excerpts WHERE excerpt_id = ${oldest.excerpt_id}`,
    ).toHaveLength(0);
    const [lengths] =
      await testSql`SELECT MIN(length(transcript->>'body')) AS shortest, MAX(length(transcript->>'body')) AS longest
      FROM conversation_recording_messages WHERE session_id IN (${first.session_id}, ${next.session_id})`;
    expect(lengths.shortest).toBe(body.length);
    expect(lengths.longest).toBe(body.length);
    const page = await repo.readRange(scope, range);
    expect(page.bytes).toBeLessThanOrEqual(RECORDING_READ_BYTES);
    expect(page.nextCursor).not.toBeNull();
    const following = await repo.readRange(scope, range, page.nextCursor ?? undefined);
    expect(following.excerpts.some((entry) => page.excerpts.some((previous) => previous.id === entry.id))).toBe(false);
  }, 60_000);

  it("removes observed source deletions, reply links, private participants and newly private channels", async () => {
    const active = await start();
    const participant = message({ sourceAuthorId: "_rt_recording_user", speaker: "PARTICIPANT_1" });
    const trigger = message({ replyToSourceMessageId: participant.sourceMessageId });
    await repo.append(scope, token(active), excerpt([participant, trigger]));
    await repo.deleteSources(scope.serverId, "200000000000000001", [participant.sourceMessageId]);
    expect((await records())[0]?.messages).toHaveLength(1);
    expect((await records())[0]?.messages[0]?.replyTo).toBeNull();
    const fresh = await repo.getActive(scope);
    if (!fresh) throw new Error("Missing active recording");
    const more = message({ sourceAuthorId: "_rt_recording_user", speaker: "PARTICIPANT_1" });
    await repo.append(scope, token(fresh), excerpt([more, message()]));
    await userRepository.setPrivacyLevel("_rt_recording_user", PrivacyLevel.FULL);
    expect(
      await testSql`SELECT message_id FROM conversation_recording_messages WHERE source_author_id = '_rt_recording_user'`,
    ).toHaveLength(0);
    expect((await records()).every((entry) => entry.messages.every((m) => m.speaker === "SELF"))).toBe(true);
    await testSql`UPDATE server_channel_scope_configs SET private_channel_ids = ARRAY['200000000000000001'] WHERE server_id = ${scope.serverId}`;
    expect(await records()).toHaveLength(0);
    expect((await repo.summary(scope)).ownerBytes).toBe(0);
  });

  it("bounds age cleanup and preserves old context until its whole excerpt expires", async () => {
    const active = await start();
    const old = message({ timestamp: new Date(Date.now() - 10 * 86_400_000) });
    for (let i = 0; i < 102; i++) await repo.append(scope, token(active), excerpt([old, message()]));
    process.env.RECORD_RETENTION_DAYS = "1";
    expect((await records())[0]?.messages[0]?.timestamp).toBe(old.timestamp.toISOString());
    await testSql`UPDATE conversation_recording_excerpts SET triggered_at = clock_timestamp() - interval '2 days' WHERE session_id = ${active.session_id}`;
    expect(await repo.cleanup()).toBe(100);
    expect(
      await testSql`SELECT excerpt_id FROM conversation_recording_excerpts WHERE session_id = ${active.session_id}`,
    ).toHaveLength(2);
    expect(await repo.cleanup()).toBe(2);
    expect(
      await testSql`SELECT message_id FROM conversation_recording_messages WHERE session_id = ${active.session_id}`,
    ).toHaveLength(0);
  });

  it("fences queued appends racing stop, range erasure and observed bulk deletion", async () => {
    for (const action of ["stop", "erase", "source"] as const) {
      const active = await start();
      const trigger = message();
      const input = excerpt([trigger]);
      const mutation =
        action === "stop"
          ? repo.stop(scope, token(active))
          : action === "erase"
            ? repo.deleteRange(scope, null)
            : repo.deleteSources(scope.serverId, input.sourceChannelId, [trigger.sourceMessageId]);
      await Promise.all([mutation, peer.append(scope, token(active), input)]);
      expect((await peer.append(scope, token(active), input)).status).toBe("stale");
      if (action !== "stop") expect(await records()).toHaveLength(0);
      const current = await repo.getActive(scope);
      if (current) await repo.stop(scope, token(current));
      await repo.deleteRange(scope, null);
    }
  });

  it("applies migration rollback/reapply and cascades source ownership on user/server deletion", async () => {
    await executeTestSqlFile("src/db/migrations/137_conversation_recordings.down.sql");
    await executeTestSqlFile("src/db/migrations/137_conversation_recordings.sql");
    const active = await start(second);
    await repo.append(second, token(active), excerpt([message()]));
    await testSql`DELETE FROM servers WHERE server_id = ${secondServerId}`;
    expect(
      await testSql`SELECT session_id FROM conversation_recording_sessions WHERE session_id = ${active.session_id}`,
    ).toHaveLength(0);
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_recording_server') RETURNING server_id`;
    secondServerId = server.server_id;
    second = { ...scope, serverId: secondServerId };
    const another = await start(other);
    await testSql`DELETE FROM users WHERE user_id = ${secondUserId}`;
    expect(
      await testSql`SELECT session_id FROM conversation_recording_sessions WHERE session_id = ${another.session_id}`,
    ).toHaveLength(0);
    const [user] = await testSql`INSERT INTO users (user_disc_id) VALUES ('_rt_recording_user') RETURNING user_id`;
    secondUserId = user.user_id;
    other = { ownerUserId: secondUserId, serverId: scope.serverId };
  });
});
