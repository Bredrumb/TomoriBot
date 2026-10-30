import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, LimitedCollection, type Client, type Message } from "discord.js";
import {
  acquireChannelLockForTurn,
  channelLocks,
  clearChannelProcessingQueue,
  clearQueuedNudgeWork,
  forceKillChannelStream,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
  releaseStaleChannelLockIfExpired,
  runWithChannelLock,
} from "@/utils/chat/channelQueue";
import {
  readChannelHistory,
  recordHistoryWindowChange,
  setHistoryWindowGatewayConnected,
} from "@/utils/chat/historyWindow";
import { recordPersonaDelivery } from "@/utils/discord/webhook/personaPost";
import { createChatLatencyInvocation, runWithChatTurnLatency } from "@/utils/chat/turnLatency";
import type { RunnableChatAdmission } from "@/utils/chat/types";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { log } from "@/utils/misc/logger";

const CHANNEL_ID = "history-window-channel";

function createHistoryFixture(count = 80) {
  const cache = new LimitedCollection<string, Message>({ maxSize: 50 });
  const rest = new Map<string, Message>();
  const fetch = mock(async ({ limit }: { limit: number }) => {
    const result = new Collection([...rest].sort(([left], [right]) => Number(right) - Number(left)).slice(0, limit));
    for (const [id, message] of result) {
      const cached = cache.get(id);
      if (cached) {
        Object.assign(cached, message);
        result.set(id, cached);
      }
    }
    return result;
  });
  const client = { user: { id: "fixture-bot" } } as Client;
  const channel = { id: CHANNEL_ID, messages: { cache, fetch } } as unknown as Message["channel"];
  const message = (id: number, content = String(id)) =>
    ({
      id: String(id),
      channelId: CHANNEL_ID,
      channel,
      client,
      content,
      partial: false,
      author: { id: "fixture-juno", username: "Juno", bot: false },
      webhookId: null,
    }) as unknown as Message;
  for (let id = 1; id <= count; id++) rest.set(String(id), message(id));
  const entry = getOrCreateChannelLockEntry(CHANNEL_ID, "fixture-guild");
  const acquire = (id = "80") =>
    acquireChannelLockForTurn(entry, {
      messageId: id,
      userDiscId: "fixture-juno",
      isPersonaJob: false,
      isCommandTriggered: false,
    });
  acquire();
  const release = (processQueuedMessage: (queued: { message: Message }) => Promise<void> = async () => {}) =>
    releaseChannelLockAndReplayQueue({
      channelId: CHANNEL_ID,
      lockEntry: entry,
      completedMessageId: entry.currentMessageId ?? "80",
      handleStopResponse: async () => {},
      processQueuedMessage,
    });
  return { channel, cache, rest, fetch, entry, message, acquire, release, client };
}

describe("busy channel history window", () => {
  afterEach(() => {
    channelLocks.delete(CHANNEL_ID);
    setHistoryWindowGatewayConnected(0, true);
  });

  it("merges uncached webhook deliveries with intervening user messages in snowflake order and trims", async () => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    for (const id of [81, 83]) {
      const delivered = { ...fixture.message(id), webhookId: "fixture-webhook" } as Message;
      recordPersonaDelivery(
        {
          messageId: delivered.id,
          channelId: CHANNEL_ID,
          route: "webhook",
          webhookId: delivered.webhookId,
          identity: { username: "Mirri" },
          speaker: null,
        },
        delivered,
      );
      fixture.rest.set(delivered.id, delivered);
    }
    fixture.cache.set("82", fixture.message(82));
    fixture.rest.set("82", fixture.cache.get("82") as Message);
    const cached = fixture.message(80, "cached revision");
    fixture.cache.set(cached.id, cached);
    fixture.rest.set(cached.id, cached);
    const reused = await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(reused.map((message) => message.id)).toEqual(Array.from({ length: 80 }, (_, index) => String(index + 4)));
    expect(reused.find((message) => message.id === "80")).toBe(cached);
    expect(fixture.cache.has("81")).toBe(false);
    expect(fixture.cache.has("83")).toBe(false);
    const fresh = await readChannelHistory(fixture.channel, 80, false);
    expect(reused).toEqual(fresh);
    expect(fixture.entry.historyWindow?.messages).toHaveLength(80);
  });

  it("drops deleted IDs and refills older history when a full window shrinks", async () => {
    const fixture = createHistoryFixture(90);
    await readChannelHistory(fixture.channel, 80, false);
    fixture.rest.delete("80");
    recordHistoryWindowChange(CHANNEL_ID, "80", "deleted");
    const result = await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(80);
    expect(result.some((message) => message.id === "80")).toBe(false);
    expect(result[0]?.id).toBe("10");
  });

  it.each(["edit", "reaction"])("refetches an uncached %s but reuses a cached change", async () => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    const cached = fixture.message(80, "changed");
    fixture.cache.set(cached.id, cached);
    recordHistoryWindowChange(CHANNEL_ID, cached.id, "changed");
    expect((await readChannelHistory(fixture.channel, 80, true)).at(-1)).toBe(cached);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    const uncached = fixture.message(1, "changed outside the cache");
    fixture.rest.set(uncached.id, uncached);
    recordHistoryWindowChange(CHANNEL_ID, uncached.id, "changed");
    expect((await readChannelHistory(fixture.channel, 80, true))[0]).toBe(uncached);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches after an edit during REST even when stale REST data overwrites the cached edit", async () => {
    const fixture = createHistoryFixture();
    const cached = fixture.rest.get("80") as Message;
    fixture.cache.set(cached.id, cached);
    const pendingRest = Promise.withResolvers<Collection<string, Message>>();
    fixture.fetch.mockImplementationOnce(() => pendingRest.promise);
    const pending = readChannelHistory(fixture.channel, 80, false);
    cached.content = "gateway edit";
    recordHistoryWindowChange(CHANNEL_ID, cached.id, "changed");
    const current = fixture.message(80, cached.content);
    fixture.rest.set(current.id, current);
    cached.content = "stale REST content";
    pendingRest.resolve(new Collection([[cached.id, cached]]));
    const result = await pending;
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(result.at(-1)?.content).toBe(current.content);
  });

  it.each(["raised-limit", "gap", "reconnect", "disconnect", "overflow"])("uses REST for %s", async (reason) => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    let limit = 80;
    if (reason === "raised-limit") limit = 100;
    if (reason === "gap") {
      for (let id = 100; id < 150; id++) {
        const message = fixture.message(id);
        fixture.cache.set(message.id, message);
        fixture.rest.set(message.id, message);
      }
    }
    if (reason === "reconnect") setHistoryWindowGatewayConnected(0, true);
    if (reason === "disconnect") setHistoryWindowGatewayConnected(0, false);
    if (reason === "overflow") {
      for (let id = 1; id <= 101; id++) recordHistoryWindowChange(CHANNEL_ID, String(id), "changed");
    }
    await readChannelHistory(fixture.channel, limit, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    if (reason === "disconnect") {
      expect(fixture.entry.historyWindow).toBeUndefined();
      await readChannelHistory(fixture.channel, limit, true);
      expect(fixture.fetch).toHaveBeenCalledTimes(3);
    }
  });

  it("refetches when a smaller turn limit discarded history needed by a later larger limit", async () => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    expect(await readChannelHistory(fixture.channel, 20, true)).toHaveLength(20);
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports the actual history source in each turn metric", async () => {
    const fixture = createHistoryFixture();
    const metrics = spyOn(log, "metric").mockImplementation(() => {});
    try {
      for (const allowReuse of [false, true]) {
        await runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, () =>
          readChannelHistory(fixture.channel, 80, allowReuse),
        );
      }
      expect(
        metrics.mock.calls.filter(([name]) => name === "chat_turn_latency").map(([, fields]) => fields?.history),
      ).toEqual(["rest", "reused"]);
    } finally {
      metrics.mockRestore();
    }
  });

  it("drops the window on idle release, and an idle trigger fetches", async () => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    fixture.release();
    expect(fixture.entry.historyWindow).toBeUndefined();
    fixture.acquire();
    await readChannelHistory(fixture.channel, 80, false);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["user", "persona"])("reuses the window through a queued %s handoff", async (kind) => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    const queued = fixture.message(81);
    fixture.cache.set(queued.id, queued);
    fixture.entry.messageQueue.push({ message: queued, isPersonaJob: kind === "persona" });
    const finished = Promise.withResolvers<void>();
    fixture.release(async ({ message }) => {
      try {
        const incoming = normalizeChatInvocation({ client: fixture.client, message, isFromQueue: true });
        const admission = { incoming, message, serverDiscId: "fixture-guild" } as RunnableChatAdmission;
        await runWithChannelLock(
          admission,
          async () => {
            expect((await readChannelHistory(fixture.channel, 80, true)).at(-1)?.id).toBe(queued.id);
            expect(fixture.fetch).toHaveBeenCalledTimes(1);
          },
          { handleStopResponse: async () => {}, processQueuedMessage: async () => {} },
        );
        expect(fixture.entry.historyWindow).toBeUndefined();
        finished.resolve();
      } catch (error) {
        finished.reject(error);
      }
    });
    await finished.promise;
  });

  it.each([
    "rejected",
    "failed",
  ])("frees history when a queued replay is %s before lock acquisition", async (outcome) => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    fixture.entry.messageQueue.push({ message: fixture.message(81) }, { message: fixture.message(82) });
    const finished = Promise.withResolvers<void>();
    fixture.release(async () => {
      finished.resolve();
      if (outcome === "failed") throw new Error("fixture admission failed");
    });
    await finished.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fixture.entry.historyWindow).toBeUndefined();
  });

  it.each(["kill", "clear", "stale", "discard"])("frees history on %s", async (path) => {
    const fixture = createHistoryFixture();
    await readChannelHistory(fixture.channel, 80, false);
    if (path === "kill") forceKillChannelStream(CHANNEL_ID);
    if (path === "clear") clearChannelProcessingQueue(CHANNEL_ID);
    if (path === "stale") {
      fixture.entry.lastProgressAt = 0;
      expect(releaseStaleChannelLockIfExpired(CHANNEL_ID, fixture.entry)).toBe(true);
    }
    if (path === "discard") {
      fixture.entry.isLocked = false;
      fixture.entry.messageQueue.push({
        message: fixture.message(81),
        naturalNudge: { targetUserDiscId: "fixture-juno", toolNames: [] },
      });
      clearQueuedNudgeWork(CHANNEL_ID);
    }
    expect(fixture.entry.historyWindow).toBeUndefined();
  });

  it("does not restore a window after kill or idle release during a pending fetch", async () => {
    for (const kill of [true, false]) {
      const fixture = createHistoryFixture();
      const pendingRest = Promise.withResolvers<Collection<string, Message>>();
      fixture.fetch.mockImplementationOnce(() => pendingRest.promise);
      const pending = readChannelHistory(fixture.channel, 80, false);
      if (kill) forceKillChannelStream(CHANNEL_ID);
      else fixture.release();
      pendingRest.resolve(new Collection(fixture.rest));
      await pending;
      expect(fixture.entry.historyWindow).toBeUndefined();
    }
  });

  it("invalidates the new turn's window when an abandoned REST read finishes late", async () => {
    const fixture = createHistoryFixture();
    const pendingRest = Promise.withResolvers<Collection<string, Message>>();
    fixture.fetch.mockImplementationOnce(() => pendingRest.promise);
    const oldRead = readChannelHistory(fixture.channel, 80, false);
    forceKillChannelStream(CHANNEL_ID);
    fixture.acquire("81");
    await readChannelHistory(fixture.channel, 80, false);
    expect(fixture.entry.historyWindow?.messages).toHaveLength(80);
    pendingRest.resolve(new Collection(fixture.rest));
    await oldRead;
    expect(fixture.entry.historyWindow).toBeUndefined();
    await readChannelHistory(fixture.channel, 80, true);
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
  });
});
