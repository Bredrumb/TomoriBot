import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Client, Guild } from "discord.js";
import { z } from "zod";
import { createPersona } from "../../helpers/fixtures";
import { PrivacyLevel } from "@/types/db/schema";
import {
  InvalidationBus,
  invalidationBus,
  type InvalidationTransport,
  INVALIDATION_CHANNEL,
  INVALIDATION_MAX_BYTES,
  invalidationKey,
  startInvalidationBus,
  stopInvalidationBus,
} from "@/utils/cache/invalidationBus";
import { log } from "@/utils/misc/logger";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import {
  cache,
  lastDbError,
  invalidateTomoriStateCache,
  invalidateTomoriStateCaches,
} from "@/utils/cache/tomoriStateCacheStore";
import { getCachedAllPersonas, clearTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import {
  commitPersonaAppearance,
  getPersonaAppearance,
  clearPersonaAppearances,
} from "@/utils/cache/personaAppearanceCacheStore";
import {
  getCachedUserRow,
  getCachedPrivacyLevel,
  getCachedBlacklistStatus,
  invalidateUserCache,
  invalidateUserBlacklistCache,
  invalidateAllUserBlacklistCacheForServer,
  clearUserCache,
  getUserCacheStats,
} from "@/utils/cache/userCache";
import {
  getCachedWhitelistStatus,
  getWhitelistCacheStats,
  invalidateWhitelistCache,
  clearWhitelistCache,
} from "@/utils/cache/channelWhitelistCache";
import {
  getChannelPromptCacheEntry,
  setChannelPromptCache,
  invalidateChannelPromptCache,
  invalidateAllChannelPromptCacheForServer,
} from "@/utils/cache/channelPromptCacheStore";
import {
  getChannelLlmCacheEntry,
  setChannelLlmCache,
  invalidateChannelLlmCache,
  invalidateAllChannelLlmCacheForServer,
} from "@/utils/cache/channelLlmCacheStore";
import {
  getChannelContextNoteCacheEntry,
  setChannelContextNoteCache,
  invalidateChannelContextNoteCache,
  invalidateAllChannelContextNoteCacheForServer,
} from "@/utils/cache/channelContextNoteCacheStore";
import {
  setPersonaSpriteCache,
  getPersonaSpriteCacheEntry,
  invalidatePersonaSpriteCache,
} from "@/utils/cache/personaSpriteCacheStore";
import {
  getCachedActiveBlocksForUser,
  getCachedActiveBlocksForPersona,
  invalidatePersonaUserBlockCache,
  invalidateAllPersonaUserBlockCacheForServer,
} from "@/utils/cache/personaUserBlockCache";
import {
  getCachedPersonalSpotlightStatus,
  getPersonalSpotlightCacheStats,
  invalidatePersonalSpotlightCache,
  clearPersonalSpotlightCache,
} from "@/utils/cache/personalSpotlightCache";
import {
  getCachedGuildMcpConfigs,
  getGuildMcpConfigCacheStats,
  invalidateGuildMcpConfigCache,
} from "@/utils/cache/guildMcpConfigCache";
import { getCachedActivePreset, getStPresetCacheStats, invalidateStPresetCache } from "@/utils/cache/stPresetCache";
import {
  loadEmojiStickerCache,
  getEmojiStickerCacheStats,
  invalidateEmojiStickerCache,
} from "@/utils/cache/emojiStickerCache";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  readNaturalNudgeGate,
  isNaturalNudgeServerActive,
  invalidateNaturalNudgeConfigCache,
  invalidateInactiveNaturalNudgeGates,
} from "@/modules/natural-nudges/runtime/configCache";
import { invalidatePresetPointerStateCaches } from "@/utils/db/initializeDatabase";
import { personaRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, insertFixtures, cleanupFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "1,3" });
const kinds = [
  "tomoriState",
  "user",
  "userBlacklist",
  "whitelist",
  "channelPrompt",
  "channelLlm",
  "channelContextNote",
  "personaSprite",
  "personaUserBlock",
  "personalSpotlight",
  "emojiSticker",
  "guildMcpConfig",
  "naturalNudgeConfig",
  "naturalNudgeInactive",
  "stPreset",
];
type Args = (string | null)[];

// Poll real delivery because a fake transport cannot exercise PostgreSQL ordering or Bun's reconnect backoff.
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for cache invalidation");
    await Bun.sleep(10);
  }
}

describe.skipIf(!DB_TESTS_AVAILABLE)("PostgreSQL derived cache invalidation", () => {
  let refs: FixtureRefs;
  let writer: SQL;
  let reader: SQL;
  const peer = new InvalidationBus();
  const observed: { kind: string; args: Args }[] = [];
  const payloads: string[] = [];
  let listenerPid: number;
  let subscriptions = 0;
  let barrierResolve: (() => void) | undefined;
  let peerBarrierResolve: (() => void) | undefined;
  const sender = crypto.randomUUID();

  async function notify(kind: string, args: Args[]): Promise<void> {
    await (writer as unknown as InvalidationTransport).notify(
      INVALIDATION_CHANNEL,
      JSON.stringify({ v: 1, s: sender, k: kind, a: args }),
    );
    const barrier = new Promise<void>((resolve) => {
      barrierResolve = resolve;
    });
    const peerBarrier = new Promise<void>((resolve) => {
      peerBarrierResolve = resolve;
    });
    await (writer as unknown as InvalidationTransport).notify(
      INVALIDATION_CHANNEL,
      JSON.stringify({ v: 1, s: sender, k: "testBarrier", a: [["ready"]] }),
    );
    await Promise.all([barrier, peerBarrier]);
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const options = {
      hostname: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      idleTimeout: 1,
      maxLifetime: 1,
    };
    writer = new SQL({ ...options, idleTimeout: 0, maxLifetime: 0 });
    reader = new SQL(options);
    invalidationBus.register(
      "testBarrier",
      z.tuple([invalidationKey]),
      () => {
        barrierResolve?.();
      },
      () => {
        subscriptions++;
      },
    );
    await startInvalidationBus(reader, topology);
    const [listener] = await testSql<
      { pid: number }[]
    >`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN "tomori_cache"'`;
    listenerPid = listener.pid;
    for (const kind of kinds) {
      peer.register(
        kind,
        z.array(z.string().nullable()),
        (args) => {
          observed.push({ kind, args });
        },
        () => {},
      );
    }
    peer.register(
      "testBarrier",
      z.tuple([invalidationKey]),
      () => {
        peerBarrierResolve?.();
      },
      () => {},
    );
    await peer.start(writer, topology);
    await (writer as unknown as InvalidationTransport).listen(
      INVALIDATION_CHANNEL,
      (payload) => {
        payloads.push(payload);
      },
      () => {},
    );
  });

  afterAll(async () => {
    await stopInvalidationBus();
    await peer.stop();
    await Promise.all([writer?.close(), reader?.close()]);
    clearTomoriStateCache();
    clearUserCache();
    clearPersonaAppearances();
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM persona_presets WHERE persona_preset_name = '_rt_bus_pointer'`;
  });

  it("publishes every existing scope and bulk invalidator through the production API", async () => {
    const server = String(refs.serverId);
    const persona = String(refs.personaId);
    const user = String(refs.userId);
    const cases: [() => void, string, Args][] = [
      [() => invalidateTomoriStateCache(FIXTURE_IDS.serverDiscId), "tomoriState", [FIXTURE_IDS.serverDiscId]],
      [() => invalidateUserCache(FIXTURE_IDS.userDiscId), "user", [FIXTURE_IDS.userDiscId]],
      [
        () => invalidateUserBlacklistCache(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId),
        "userBlacklist",
        [FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId],
      ],
      [
        () => invalidateAllUserBlacklistCacheForServer(FIXTURE_IDS.serverDiscId),
        "userBlacklist",
        [FIXTURE_IDS.serverDiscId],
      ],
      [() => invalidateWhitelistCache(FIXTURE_IDS.serverDiscId), "whitelist", [FIXTURE_IDS.serverDiscId]],
      [
        () => invalidateWhitelistCache(FIXTURE_IDS.serverDiscId, "channel"),
        "whitelist",
        [FIXTURE_IDS.serverDiscId, "channel"],
      ],
      [() => invalidateChannelPromptCache(refs.serverId, "channel"), "channelPrompt", [server, "channel"]],
      [() => invalidateAllChannelPromptCacheForServer(refs.serverId), "channelPrompt", [server]],
      [() => invalidateChannelLlmCache(refs.serverId, "channel"), "channelLlm", [server, "channel"]],
      [() => invalidateAllChannelLlmCacheForServer(refs.serverId), "channelLlm", [server]],
      [() => invalidateChannelContextNoteCache(refs.serverId, "channel"), "channelContextNote", [server, "channel"]],
      [() => invalidateAllChannelContextNoteCacheForServer(refs.serverId), "channelContextNote", [server]],
      [() => invalidatePersonaSpriteCache(refs.personaId), "personaSprite", [persona]],
      [
        () => invalidatePersonaUserBlockCache(refs.serverId, refs.personaId, FIXTURE_IDS.userDiscId),
        "personaUserBlock",
        [server, persona, FIXTURE_IDS.userDiscId],
      ],
      [() => invalidatePersonaUserBlockCache(refs.serverId, refs.personaId), "personaUserBlock", [server, persona]],
      [() => invalidateAllPersonaUserBlockCacheForServer(refs.serverId), "personaUserBlock", [server]],
      [
        () => invalidatePersonalSpotlightCache(refs.serverId, refs.userId, "channel"),
        "personalSpotlight",
        [server, user, "channel"],
      ],
      [() => invalidatePersonalSpotlightCache(refs.serverId), "personalSpotlight", [server, null, null]],
      [() => invalidateEmojiStickerCache(refs.serverId), "emojiSticker", [server]],
      [() => invalidateGuildMcpConfigCache(refs.serverId), "guildMcpConfig", [server]],
      [() => invalidateNaturalNudgeConfigCache(refs.serverId), "naturalNudgeConfig", [server]],
      [() => invalidateInactiveNaturalNudgeGates(refs.serverId), "naturalNudgeInactive", [server]],
      [() => invalidateStPresetCache(refs.serverId), "stPreset", [server]],
    ];
    observed.length = 0;
    for (const [invalidate] of cases) invalidate();
    await until(() => observed.length >= cases.length);
    expect(observed.map((entry) => JSON.stringify(entry)).sort()).toEqual(
      cases.map(([, kind, args]) => JSON.stringify({ kind, args })).sort(),
    );
    observed.length = 0;
    function* guilds() {
      yield FIXTURE_IDS.serverDiscId;
      yield "_rt_peer_guild";
    }
    invalidateTomoriStateCaches(guilds());
    await until(() => observed.length === 2);
    expect(observed.map(({ args }) => args)).toEqual([[FIXTURE_IDS.serverDiscId], ["_rt_peer_guild"]]);
  });

  it("evicts peer user row/privacy and one-user or all-user blacklists without erasing unrelated settings", async () => {
    await getCachedUserRow(FIXTURE_IDS.userDiscId);
    await testSql`UPDATE users SET privacy_level = ${PrivacyLevel.PARTIAL} WHERE user_id = ${refs.userId}`;
    await notify("user", [[FIXTURE_IDS.userDiscId]]);
    expect(await getCachedPrivacyLevel(FIXTURE_IDS.userDiscId)).toBe(PrivacyLevel.PARTIAL);
    const second = FIXTURE_IDS.altUserDiscId;
    for (const user of [FIXTURE_IDS.userDiscId, second]) await getCachedBlacklistStatus(FIXTURE_IDS.serverDiscId, user);
    await testSql`INSERT INTO personalization_blacklist (server_id, user_disc_id) VALUES (${refs.serverId}, ${FIXTURE_IDS.userDiscId}), (${refs.serverId}, ${second})`;
    const size = getUserCacheStats().cacheSize;
    await notify("userBlacklist", [[FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId]]);
    expect(await getCachedBlacklistStatus(FIXTURE_IDS.serverDiscId, FIXTURE_IDS.userDiscId)).toBe(true);
    expect(await getCachedBlacklistStatus(FIXTURE_IDS.serverDiscId, second)).toBe(false);
    await notify("userBlacklist", [[FIXTURE_IDS.serverDiscId]]);
    expect(await getCachedBlacklistStatus(FIXTURE_IDS.serverDiscId, second)).toBe(true);
    expect(getUserCacheStats().cacheSize).toBe(size);
    await testSql`DELETE FROM personalization_blacklist WHERE server_id = ${refs.serverId}`;
  });

  it("preserves numeric channel scopes, cached nulls and server-wide invalidation", async () => {
    const stores = [
      {
        kind: "channelPrompt",
        set: (server: number, channel: string) => setChannelPromptCache(server, channel, null),
        get: getChannelPromptCacheEntry,
      },
      {
        kind: "channelLlm",
        set: (server: number, channel: string) => setChannelLlmCache(server, channel, null),
        get: getChannelLlmCacheEntry,
      },
      {
        kind: "channelContextNote",
        set: (server: number, channel: string) => setChannelContextNoteCache(server, channel, null),
        get: getChannelContextNoteCacheEntry,
      },
    ];
    for (const store of stores) {
      for (const server of [refs.serverId, refs.serverId + 1])
        for (const channel of ["one", "two"]) store.set(server, channel);
      await notify(store.kind, [[String(refs.serverId), "one"]]);
      expect(store.get(refs.serverId, "one")).toBeUndefined();
      expect(store.get(refs.serverId, "two")).toBeNull();
      await notify(store.kind, [[String(refs.serverId)]]);
      expect(store.get(refs.serverId, "two")).toBeUndefined();
      expect(store.get(refs.serverId + 1, "one")).toBeNull();
    }
  });

  it("invalidates parent whitelist checks and whole-server scopes", async () => {
    clearWhitelistCache();
    await getCachedWhitelistStatus(FIXTURE_IDS.serverDiscId, "thread", [], "parent");
    await getCachedWhitelistStatus(FIXTURE_IDS.serverDiscId, "other");
    await notify("whitelist", [[FIXTURE_IDS.serverDiscId, "parent"]]);
    expect(getWhitelistCacheStats().size).toBe(1);
    await notify("whitelist", [[FIXTURE_IDS.serverDiscId]]);
    expect(getWhitelistCacheStats().size).toBe(0);
  });

  it("keeps TTL expiry and emergency local clearing off the notification channel", async () => {
    setChannelPromptCache(refs.serverId, "expires", null);
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now + 60 * 60 * 1_000);
    try {
      expect(getChannelPromptCacheEntry(refs.serverId, "expires")).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
    observed.length = 0;
    clearTomoriStateCache();
    clearUserCache();
    clearWhitelistCache();
    clearPersonalSpotlightCache();
    await notify("testBarrier", [["ready"]]);
    expect(observed).toEqual([]);
  });

  it("preserves sprite and state appearance cascades and clears current database error markers", async () => {
    setPersonaSpriteCache(refs.personaId, []);
    const persona = createPersona({ persona_id: refs.personaId, server_id: refs.serverId });
    cache.set(FIXTURE_IDS.serverDiscId, { personas: [persona], mainPersona: persona, cachedAt: Date.now() });
    lastDbError.set(FIXTURE_IDS.serverDiscId, { message: "unavailable", timestamp: Date.now() });
    commitPersonaAppearance({
      channelId: "channel",
      personaId: refs.personaId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      genericAvatar: false,
    });
    await notify("personaSprite", [[String(refs.personaId)]]);
    expect(getPersonaSpriteCacheEntry(refs.personaId)).toBeUndefined();
    expect(getPersonaAppearance("channel", refs.personaId)).toBeUndefined();
    commitPersonaAppearance({
      channelId: "channel",
      personaId: refs.personaId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      genericAvatar: false,
    });
    await notify("tomoriState", [[FIXTURE_IDS.serverDiscId]]);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
    expect(lastDbError.has(FIXTURE_IDS.serverDiscId)).toBe(false);
    expect(getPersonaAppearance("channel", refs.personaId)).toBeUndefined();
  });

  it("evicts shared-pointer personas through the existing pointer fan-out API", async () => {
    const [preset] =
      await testSql`INSERT INTO persona_presets (persona_preset_name, persona_preset_desc, preset_lineage_id, preset_language, preset_attribute_list, preset_sample_dialogues_in, preset_sample_dialogues_out) VALUES ('_rt_bus_pointer', 'before', 900004, 'en-US', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[]) RETURNING *`;
    await personaRepository.applyPresetPointerToPersona({
      personaId: refs.personaId,
      nickname: "_rt_bus_persona",
      preset,
    });
    invalidateTomoriStateCache(FIXTURE_IDS.serverDiscId);
    expect((await getCachedAllPersonas(FIXTURE_IDS.serverDiscId))[0]?.persona_prompt).toBe("before");
    await testSql`UPDATE persona_presets SET persona_preset_desc = 'after' WHERE preset_lineage_id = 900004`;
    observed.length = 0;
    await invalidatePresetPointerStateCaches(testSql);
    await until(() =>
      observed.some(({ kind, args }) => kind === "tomoriState" && args[0] === FIXTURE_IDS.serverDiscId),
    );
    expect((await getCachedAllPersonas(FIXTURE_IDS.serverDiscId))[0]?.persona_prompt).toBe("after");
  });

  it("clears persona/user block scopes and spotlight result and absence gates", async () => {
    await getCachedActiveBlocksForPersona(refs.serverId, refs.personaId);
    await getCachedActiveBlocksForUser(refs.serverId, FIXTURE_IDS.userDiscId);
    await testSql`INSERT INTO persona_user_blocks (server_id, persona_id, user_disc_id, block_type, reason, expires_at) VALUES (${refs.serverId}, ${refs.personaId}, ${FIXTURE_IDS.userDiscId}, 'mute', '_rt_scope', NOW() + INTERVAL '1 hour')`;
    await notify("personaUserBlock", [[String(refs.serverId), String(refs.personaId)]]);
    expect((await getCachedActiveBlocksForUser(refs.serverId, FIXTURE_IDS.userDiscId)).length).toBeGreaterThan(0);
    expect((await getCachedActiveBlocksForPersona(refs.serverId, refs.personaId)).length).toBeGreaterThan(0);
    await testSql`DELETE FROM persona_user_blocks WHERE server_id = ${refs.serverId}`;
    await notify("personaUserBlock", [[String(refs.serverId)]]);
    expect(await getCachedActiveBlocksForUser(refs.serverId, FIXTURE_IDS.userDiscId)).toEqual([]);
    clearPersonalSpotlightCache();
    expect(await getCachedPersonalSpotlightStatus(refs.serverId, refs.userId, "one")).toBeNull();
    for (const channel of ["one", "two"]) {
      await testSql`INSERT INTO personal_spotlights (server_id, user_id, channel_disc_id) VALUES (${refs.serverId}, ${refs.userId}, ${channel})`;
      await testSql`INSERT INTO personal_spotlight_personas (server_id, user_id, channel_disc_id, persona_id) VALUES (${refs.serverId}, ${refs.userId}, ${channel}, ${refs.personaId})`;
    }
    await notify("personalSpotlight", [[String(refs.serverId), null, null]]);
    for (const channel of ["one", "two"])
      expect(await getCachedPersonalSpotlightStatus(refs.serverId, refs.userId, channel)).not.toBeNull();
    await notify("personalSpotlight", [[String(refs.serverId), null, "one"]]);
    expect(getPersonalSpotlightCacheStats().size).toBe(1);
    await notify("personalSpotlight", [[String(refs.serverId), String(refs.userId), null]]);
    expect(getPersonalSpotlightCacheStats().size).toBe(0);
  });

  it("refreshes Natural Nudges configuration and inactive gates after peer writes", async () => {
    const server = refs.serverId;
    await testSql`DELETE FROM server_natural_nudge_runtime_state WHERE server_id = ${server}`;
    await notify("naturalNudgeInactive", [[String(server)]]);
    expect(await isNaturalNudgeServerActive(server)).toBe(false);
    await readNaturalNudgeGate(FIXTURE_IDS.serverDiscId);
    await testSql`INSERT INTO server_natural_nudge_runtime_state (server_id, last_direct_chat_at) VALUES (${server}, NOW())`;
    await notify("naturalNudgeInactive", [[String(server)]]);
    expect(await isNaturalNudgeServerActive(server)).toBe(true);
    const load = spyOn(naturalNudgeRepository, "loadServerConfig");
    try {
      await readNaturalNudgeGate(FIXTURE_IDS.serverDiscId);
      const before = load.mock.calls.length;
      await notify("naturalNudgeConfig", [[String(server)]]);
      await readNaturalNudgeGate(FIXTURE_IDS.serverDiscId);
      expect(load.mock.calls.length).toBeGreaterThan(before);
    } finally {
      load.mockRestore();
    }
  });

  it("rejects malformed live notifications and never echoes a peer invalidation", async () => {
    setChannelPromptCache(refs.serverId, "one", null);
    const transport = writer as unknown as InvalidationTransport;
    for (const message of [
      "broken",
      JSON.stringify({ v: 2, s: sender, k: "channelPrompt", a: [[String(refs.serverId), "one"]] }),
      JSON.stringify({ v: 1, s: sender, k: "channelPrompt", a: [[refs.serverId, "one"]] }),
    ])
      await transport.notify(INVALIDATION_CHANNEL, message);
    await notify("testBarrier", [["ready"]]);
    expect(getChannelPromptCacheEntry(refs.serverId, "one")).toBeNull();
    const before = observed.filter(({ kind }) => kind === "channelPrompt").length;
    await notify("channelPrompt", [[String(refs.serverId), "one"]]);
    await until(() => observed.filter(({ kind }) => kind === "channelPrompt").length > before);
    expect(observed.filter(({ kind }) => kind === "channelPrompt").length - before).toBe(1);
    expect(getChannelPromptCacheEntry(refs.serverId, "one")).toBeUndefined();
  });

  it("delivers bounded UTF-8 bulk messages once between bus instances with equal topology labels", async () => {
    const keys = Array.from({ length: 200 }, (_, index) => `${index}${"界".repeat(100)}`);
    observed.length = 0;
    const before = payloads.length;
    const entries = new Set(keys);
    invalidationBus.register(
      "testUtf8",
      z.tuple([invalidationKey]),
      ([key]) => {
        entries.delete(key);
      },
      () => {
        entries.clear();
      },
    );
    peer.register(
      "testUtf8",
      z.tuple([invalidationKey]),
      (args) => {
        observed.push({ kind: "testUtf8", args });
      },
      () => {},
    );
    peer.publish(
      "testUtf8",
      keys.map((key) => [key]),
    );
    await until(() => entries.size === 0);
    await notify("testBarrier", [["ready"]]);
    const sent = payloads
      .slice(before)
      .map((payload) => ({ payload, message: JSON.parse(payload) }))
      .filter(({ message }) => message.k === "testUtf8");
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every(({ payload }) => Buffer.byteLength(payload) <= INVALIDATION_MAX_BYTES)).toBe(true);
    expect(
      sent
        .flatMap(({ message }) => message.a)
        .map(([key]: [string]) => key)
        .sort(),
    ).toEqual(keys.toSorted());
    expect(observed.filter(({ kind }) => kind === "testUtf8")).toHaveLength(0);
  });

  it("flushes every managed cache after terminating the listener and keeps listener lifetime independent of the pool", async () => {
    const server = refs.serverId;
    await getCachedUserRow(FIXTURE_IDS.userDiscId);
    await getCachedWhitelistStatus(FIXTURE_IDS.serverDiscId, "one");
    setChannelPromptCache(server, "one", null);
    setChannelLlmCache(server, "one", null);
    setChannelContextNoteCache(server, "one", null);
    setPersonaSpriteCache(refs.personaId, []);
    await getCachedActiveBlocksForPersona(server, refs.personaId);
    await getCachedActiveBlocksForUser(server, FIXTURE_IDS.userDiscId);
    await testSql`INSERT INTO persona_user_blocks (server_id, persona_id, user_disc_id, block_type, reason, expires_at) VALUES (${server}, ${refs.personaId}, ${FIXTURE_IDS.userDiscId}, 'mute', '_rt_reconnect', NOW() + INTERVAL '1 hour')`;
    await getCachedGuildMcpConfigs(server);
    await getCachedActivePreset(server);
    await getCachedPersonalSpotlightStatus(server, refs.userId, "one");
    await testSql`DELETE FROM server_natural_nudge_runtime_state WHERE server_id = ${server}`;
    await notify("naturalNudgeInactive", [[String(server)]]);
    expect(await isNaturalNudgeServerActive(server)).toBe(false);
    await readNaturalNudgeGate(FIXTURE_IDS.serverDiscId);
    const client = new Client({ intents: [] });
    const guild: Guild = Reflect.construct(Guild, [
      client,
      {
        id: "100000000000000000",
        name: "_rt_guild",
        unavailable: false,
        emojis: [{ id: "100000000000000001", name: "_rt_emoji", animated: false }],
      },
    ]);
    await testSql`INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name) VALUES (${server}, '100000000000000001', '_rt_emoji')`;
    await loadEmojiStickerCache(server, guild, true, false);
    expect(getEmojiStickerCacheStats().cacheSize).toBeGreaterThan(0);
    await testSql`INSERT INTO server_natural_nudge_runtime_state (server_id, last_direct_chat_at) VALUES (${server}, NOW())`;
    lastDbError.set(FIXTURE_IDS.serverDiscId, { message: "unavailable", timestamp: Date.now() });
    commitPersonaAppearance({
      channelId: "channel",
      personaId: refs.personaId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      genericAvatar: false,
    });
    const before = subscriptions;
    await testSql`SELECT pg_terminate_backend(${listenerPid})`;
    await until(() => subscriptions > before);
    expect(getUserCacheStats().cacheSize).toBe(0);
    expect(getWhitelistCacheStats().size).toBe(0);
    expect(cache.size).toBe(0);
    expect(lastDbError.size).toBe(0);
    expect(getChannelPromptCacheEntry(server, "one")).toBeUndefined();
    expect(getChannelLlmCacheEntry(server, "one")).toBeUndefined();
    expect(getChannelContextNoteCacheEntry(server, "one")).toBeUndefined();
    expect(getPersonaSpriteCacheEntry(refs.personaId)).toBeUndefined();
    expect(getPersonalSpotlightCacheStats().size).toBe(0);
    expect(getGuildMcpConfigCacheStats().cacheSize).toBe(0);
    expect(getStPresetCacheStats().size).toBe(0);
    expect(getEmojiStickerCacheStats().cacheSize).toBe(0);
    expect(getPersonaAppearance("channel", refs.personaId)).toBeUndefined();
    expect((await getCachedActiveBlocksForPersona(server, refs.personaId)).length).toBeGreaterThan(0);
    expect((await getCachedActiveBlocksForUser(server, FIXTURE_IDS.userDiscId)).length).toBeGreaterThan(0);
    expect(await isNaturalNudgeServerActive(server)).toBe(true);
    const load = spyOn(naturalNudgeRepository, "loadServerConfig");
    try {
      await readNaturalNudgeGate(FIXTURE_IDS.serverDiscId);
      expect(load).toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
    await testSql`SELECT pg_sleep(1.1)`;
    expect(subscriptions).toBe(before + 1);
    await notify("channelPrompt", [[String(server), "one"]]);
    await client.destroy();
  });
  it("reports a real publication failure after its SQL client closes", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    try {
      await writer.close();
      expect(peer.publish("user", [[FIXTURE_IDS.userDiscId]])).toBeUndefined();
      await until(() => metric.mock.calls.some(([name]) => name === "cache_invalidation_publish_failed"));
    } finally {
      metric.mockRestore();
    }
  });
});
