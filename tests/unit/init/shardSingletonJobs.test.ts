import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ActivityType, Client, ClientUser, Guild, REST } from "discord.js";
import * as leases from "@/utils/cluster/shardLeases";
import * as ownership from "@/utils/discord/shardOwnership";
import { initializeStmJanitor, stopStmJanitor } from "@/timers/stmJanitor";
import { initializeMessageProxyIndexPruner, stopMessageProxyIndexPruner } from "@/timers/messageProxyIndexPruner";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { personaRepository, statRepository, llmModelRepo, configRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import * as commands from "@/utils/discord/commandLoader";
import * as identity from "@/utils/discord/guildIdentity";
import * as storage from "@/utils/storage/avatarStorage";
import * as database from "@/init/database";
import * as avatars from "@/utils/persona/presetAvatarReconciler";
import { initializePresetArtReconciliation, stopPresetArtReconciliation } from "@/init/timers";
import registerCommands from "@/events/clientReady/01_registercommands";
import syncCommandCatalog from "@/events/clientReady/04_syncCommandCatalog";
import status from "@/events/clientReady/status";
import { initLoaders } from "@/init/loaders";
import * as tools from "@/tools/toolInitializer";
import * as llmCache from "@/utils/cache/llmCache";
import * as capabilityCache from "@/utils/cache/openrouterCapabilityCache";
import * as videoCache from "@/utils/cache/openrouterVideoModelCache";
import * as imageCache from "@/utils/cache/openrouterImageModelCache";
import * as embeddingCache from "@/utils/cache/openrouterEmbeddingModelCache";
import * as mediaPricing from "@/utils/provider/openrouterMediaPricing";
import * as events from "@/handlers/eventHandler";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["NODE_ENV", "TOPGG_TOKEN", "DISCORD_TOKEN"]);
let primary = true;
let owned = true;
let topology = ownership.parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" });
let intervals: Array<() => unknown> = [];
let timeouts: Array<() => unknown> = [];
let client: Client;

beforeEach(() => {
  intervals = [];
  timeouts = [];
  primary = true;
  owned = true;
  topology = ownership.parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" });
  client = new Client({ intents: [] });
  client.user = Reflect.construct(ClientUser, [
    client,
    { id: "1200000000000000001", username: "Mirri", discriminator: "0", avatar: null },
  ]);
  spyOn(Date.prototype, "getMonth").mockReturnValue(0);
  spyOn(leases, "isPrimaryProcess").mockImplementation(() => primary);
  spyOn(leases, "hasShardLeaseOwnership").mockImplementation(() => owned);
  spyOn(ownership, "getShardTopology").mockImplementation(() => topology);
  spyOn(globalThis, "setInterval").mockImplementation(((callback: () => unknown) => {
    intervals.push(callback);
    return { unref: () => {} } as NodeJS.Timeout;
  }) as typeof setInterval);
  spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => unknown) => {
    timeouts.push(callback);
    return {} as NodeJS.Timeout;
  }) as typeof setTimeout);
});

afterEach(async () => {
  stopStmJanitor();
  stopMessageProxyIndexPruner();
  stopPresetArtReconciliation();
  mock.restore();
  await client.destroy();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

describe("singleton job dispatch", () => {
  test("janitors check primary at each dispatch and again between database operations", async () => {
    const stm = spyOn(shortTermMemoryRepository, "purgeStaleEntries").mockResolvedValue(0);
    const oauth = spyOn(oauthStateRepository, "purgeFinishedStates").mockResolvedValue({ purgedStates: 0 });
    const proxy = spyOn(messageProxyRepository, "pruneMessageIndexOlderThanDays").mockResolvedValue(0);
    initializeStmJanitor();
    initializeMessageProxyIndexPruner();
    await flush();
    await timeouts[0]();
    await flush();
    expect(stm).toHaveBeenCalledTimes(1);
    expect(oauth).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledTimes(1);
    primary = false;
    for (const tick of intervals) tick();
    await flush();
    expect(stm).toHaveBeenCalledTimes(1);
    expect(oauth).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledTimes(1);
    primary = true;
    stm.mockImplementation(async () => {
      primary = false;
      return 0;
    });
    intervals[0]();
    await flush();
    expect(stm).toHaveBeenCalledTimes(2);
    expect(oauth).toHaveBeenCalledTimes(1);
  });

  test("command registration and catalog writes require a live primary after loading", async () => {
    process.env.DISCORD_TOKEN = "fixture-token";
    const load = spyOn(commands, "loadCommandData").mockResolvedValue({
      registrationData: [{ name: "help", description: "fixture" }],
      executionMap: new Map(),
      autocompleteMap: new Map(),
      cooldownMap: new Map(),
    });
    const put = spyOn(REST.prototype, "put").mockResolvedValue([]);
    const sync = spyOn(statRepository, "syncCommandCatalog").mockResolvedValue(undefined);
    primary = false;
    await registerCommands(client);
    await syncCommandCatalog(client);
    expect(put).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    primary = true;
    await registerCommands(client);
    await syncCommandCatalog(client);
    expect(put).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    load.mockImplementation(async () => {
      primary = false;
      return {
        registrationData: [{ name: "help", description: "fixture" }],
        executionMap: new Map(),
        autocompleteMap: new Map(),
        cooldownMap: new Map(),
      };
    });
    await registerCommands(client);
    primary = true;
    await syncCommandCatalog(client);
    expect(put).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  test("loaders retain local catalogs on secondaries and gate pricing at write time", async () => {
    primary = false;
    const initializeTools = spyOn(tools, "initializeTools").mockResolvedValue(undefined);
    const llm = spyOn(llmCache, "initializeLLMCache").mockResolvedValue(undefined);
    const capability = spyOn(capabilityCache, "initializeOpenRouterCapabilityCache").mockResolvedValue(undefined);
    const video = spyOn(videoCache, "initializeOpenRouterVideoModelCache").mockResolvedValue(undefined);
    const image = spyOn(imageCache, "initializeOpenRouterImageModelCache").mockResolvedValue(undefined);
    const embedding = spyOn(embeddingCache, "initializeOpenRouterEmbeddingModelCache").mockResolvedValue(undefined);
    spyOn(mediaPricing, "warmOpenRouterMediaPricing").mockResolvedValue(undefined);
    spyOn(configRepository, "loadAllPresets").mockResolvedValue([]);
    const routing = spyOn(events, "default").mockResolvedValue(undefined);
    const pricingWrite = spyOn(llmModelRepo, "syncOpenrouterPrices").mockResolvedValue(0);
    await initLoaders(client);
    for (const loader of [initializeTools, llm, capability, video, image, embedding, routing]) {
      expect(loader).toHaveBeenCalledTimes(1);
    }
    expect(pricingWrite).not.toHaveBeenCalled();
    const rates = new Map([["provider/model", { promptPricePerMillion: 2, completionPricePerMillion: 4 }]]);
    const pricing = spyOn(capabilityCache, "getAllOpenRouterPricing").mockReturnValue(rates);
    primary = true;
    await initLoaders(client);
    expect(pricingWrite).toHaveBeenCalledWith(
      new Map([["provider/model", { inputPerMillion: 2, outputPerMillion: 4 }]]),
    );
    pricing.mockImplementation(() => {
      primary = false;
      return rates;
    });
    primary = true;
    await initLoaders(client);
    expect(pricingWrite).toHaveBeenCalledTimes(1);
  });

  test("only the primary seeds art while every owner repeats fan-out after shared seeding", async () => {
    const seed = spyOn(database, "seedStorageBackedCatalogs").mockResolvedValue(undefined);
    const fanout = spyOn(avatars, "reconcilePresetMainAvatars").mockResolvedValue(undefined);
    primary = false;
    initializePresetArtReconciliation(client);
    await flush();
    expect(seed).not.toHaveBeenCalled();
    expect(fanout).toHaveBeenCalledTimes(1);
    intervals[0]();
    await flush();
    expect(fanout).toHaveBeenCalledTimes(2);
    primary = true;
    intervals[0]();
    await flush();
    expect(seed).toHaveBeenCalledTimes(1);
    expect(fanout).toHaveBeenCalledTimes(3);
    primary = false;
    owned = false;
    intervals[0]();
    await flush();
    expect(seed).toHaveBeenCalledTimes(1);
    expect(fanout).toHaveBeenCalledTimes(3);
  });

  test("avatar fan-out skips foreign and uncached guilds without stamping them", async () => {
    const base = (1400000000000000000n >> 24n) << 24n;
    const guildId = (base + (1n << 22n)).toString();
    const missingId = base.toString();
    const foreignId = (base + (2n << 22n)).toString();
    for (const id of [guildId, foreignId])
      client.guilds.cache.set(id, Reflect.construct(Guild, [client, { id, name: "fixture" }]));
    spyOn(personaRepository, "loadUnsyncedMainPointers").mockResolvedValue([
      {
        server_disc_id: foreignId,
        persona_id: 1,
        preset_avatar_shared_url: "https://storage.example/avatar.png",
        preset_avatar_hash: "hash",
      },
      {
        server_disc_id: missingId,
        persona_id: 2,
        preset_avatar_shared_url: "https://storage.example/avatar.png",
        preset_avatar_hash: "hash",
      },
      {
        server_disc_id: guildId,
        persona_id: 3,
        preset_avatar_shared_url: "https://storage.example/avatar.png",
        preset_avatar_hash: "hash",
      },
    ]);
    spyOn(storage, "loadStoredPersonaAvatarBuffer").mockResolvedValue(Buffer.from("image"));
    spyOn(personaRepository, "isPersonaPointer").mockResolvedValue(true);
    const patch = spyOn(identity, "setGuildBotAvatar").mockResolvedValue({ success: true });
    const stamp = spyOn(personaRepository, "stampPointerAvatarHash").mockResolvedValue(undefined);
    await avatars.reconcilePresetMainAvatars(client);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe(guildId);
    expect(stamp).toHaveBeenCalledWith(3, "hash");
    topology = ownership.parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "2,3" });
    await avatars.reconcilePresetMainAvatars(client);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][0]).toBe(foreignId);
    expect(stamp).toHaveBeenCalledWith(1, "hash");
    topology = ownership.parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,1" });
    spyOn(personaRepository, "isPersonaPointer").mockImplementation(async () => {
      owned = false;
      return true;
    });
    await avatars.reconcilePresetMainAvatars(client);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(stamp).toHaveBeenCalledTimes(2);
  });

  test("status waits for complete totals and only a live primary posts Top.gg", async () => {
    process.env.NODE_ENV = "production";
    process.env.TOPGG_TOKEN = "fixture-token";
    spyOn(Math, "random").mockReturnValue(0.99);
    const count = spyOn(metricSampleRepository, "getClusterGuildCount").mockResolvedValue(null);
    if (!client.user) throw new Error("Missing fixture user");
    const activity = spyOn(client.user, "setActivity").mockReturnValue(client.user.presence);
    const post = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await status(client);
    expect(activity.mock.calls.at(-1)?.[0]).toMatchObject({ type: ActivityType.Playing });
    expect(post).not.toHaveBeenCalled();
    count.mockResolvedValue(1750);
    primary = false;
    intervals[0]();
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(activity.mock.calls.at(-1)?.[0]).toMatchObject({ name: expect.stringContaining("1750") });
    primary = true;
    intervals[0]();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ server_count: 1750 });
    intervals[0]();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a single process posts its joined guild cache count without needing samples", async () => {
    topology = ownership.parseShardTopology({ SHARD_COUNT: "1" });
    const id = "1200000000000000001";
    client.guilds.cache.set(id, Reflect.construct(Guild, [client, { id, name: "fixture" }]));
    process.env.NODE_ENV = "production";
    process.env.TOPGG_TOKEN = "fixture-token";
    const count = spyOn(metricSampleRepository, "getClusterGuildCount");
    if (!client.user) throw new Error("Missing fixture user");
    spyOn(client.user, "setActivity").mockReturnValue(client.user.presence);
    const post = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await status(client);
    expect(count).not.toHaveBeenCalled();
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ server_count: 1 });
  });
});
