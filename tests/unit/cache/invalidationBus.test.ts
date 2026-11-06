import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";
import {
  InvalidationBus,
  type InvalidationTransport,
  INVALIDATION_MAX_BYTES,
  invalidationDatabaseId,
  invalidationKey,
} from "@/utils/cache/invalidationBus";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";

const subset = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "1,3" });
const buses: InvalidationBus[] = [];

function fixture() {
  const bus = new InvalidationBus();
  buses.push(bus);
  let receive = (_payload: string) => {};
  let subscribed = () => {};
  const unlisten = mock(async () => {});
  const notify = mock(async (_channel: string, _payload: string) => {});
  const transport: InvalidationTransport = {
    listen: mock(async (_channel, onReceive, onSubscribe) => {
      receive = onReceive;
      subscribed = onSubscribe;
      subscribed();
      return { unlisten };
    }),
    notify,
  };
  const evict = mock((_args: [number, string?]) => {});
  const flush = mock(() => {});
  bus.register(
    "scope",
    z.union([z.tuple([invalidationDatabaseId]), z.tuple([invalidationDatabaseId, invalidationKey])]),
    evict,
    flush,
  );
  return {
    bus,
    transport,
    notify,
    unlisten,
    evict,
    flush,
    receive: (payload: string) => receive(payload),
    reconnect: () => subscribed(),
  };
}

function wire(args: unknown = [["42"]], overrides = {}) {
  return JSON.stringify({ v: 1, s: crypto.randomUUID(), k: "scope", a: args, ...overrides });
}

afterEach(async () => {
  await Promise.all(buses.splice(0).map((bus) => bus.stop()));
  mock.restore();
});

describe("derived cache invalidation transport", () => {
  it("opens no listener and publishes nothing when the process owns all shards", async () => {
    const f = fixture();
    await f.bus.start(f.transport, parseShardTopology({ SHARD_COUNT: "4" }));
    f.bus.publish("scope", [["42"]]);
    expect(f.transport.listen).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.flush).not.toHaveBeenCalled();
  });

  it("flushes before start resolves, decodes keys, suppresses nested publications and ignores its own sender", async () => {
    const f = fixture();
    f.evict.mockImplementation(() => f.bus.publish("scope", [["42"]]));
    await f.bus.start(f.transport, subset);
    expect(f.flush).toHaveBeenCalledTimes(1);
    f.receive(wire([["42", "channel"]]));
    expect(f.evict).toHaveBeenCalledWith([42, "channel"]);
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.bus.publish("scope", [["42"]])).toBeUndefined();
    await f.bus.stop();
    const payload = f.notify.mock.calls[0][1];
    f.receive(payload);
    expect(f.evict).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid envelopes, numeric keys, tuple arity and unknown kinds without leaking input", async () => {
    const f = fixture();
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    await f.bus.start(f.transport, subset);
    const invalid = [
      "private-invalid-json",
      wire([["42"]], { v: 2 }),
      wire([["42"]], { s: "same-label" }),
      wire([["42"]], { k: "private-unknown-kind" }),
      wire([]),
      wire([[42]]),
      wire([["42", ""]]),
      wire([["0"]]),
      wire([["-1"]]),
      wire([["1.5"]]),
      wire([["9007199254740992"]]),
      wire([["42", "x".repeat(129)]]),
      wire([["42", "channel", "extra"]]),
      wire([["42"]], { extra: true }),
      "x".repeat(INVALIDATION_MAX_BYTES + 1),
    ];
    for (const payload of invalid) f.receive(payload);
    expect(f.evict).not.toHaveBeenCalled();
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify([warn.mock.calls, metric.mock.calls])).not.toContain("private-");
    f.receive(wire());
    expect(f.evict).toHaveBeenCalledWith([42]);
  });

  it("chunks a single-use UTF-8 iterable by bytes and batches keys without dropping any", async () => {
    const f = fixture();
    await f.bus.start(f.transport, subset);
    let yielded = 0;
    function* tuples(): Generator<[string, string]> {
      for (let index = 0; index < 200; index++) {
        yielded++;
        yield [String(index + 1), "界".repeat(100)];
      }
    }
    f.bus.publish("scope", tuples());
    await f.bus.stop();
    const messages = f.notify.mock.calls.map(([, payload]) => payload);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.length).toBeLessThan(200);
    expect(yielded).toBe(200);
    expect(messages.every((payload) => Buffer.byteLength(payload) <= INVALIDATION_MAX_BYTES)).toBe(true);
    expect(messages.flatMap((payload) => JSON.parse(payload).a).map(([id]: [string]) => Number(id))).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
  });

  it("contains publication and eviction failures, and continues flushing every registered cache", async () => {
    const f = fixture();
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    await f.bus.start(f.transport, subset);
    f.notify.mockRejectedValue(new Error("private-provider-body"));
    f.evict.mockImplementation(() => {
      throw new Error("private-handler-body");
    });
    f.receive(wire());
    f.bus.publish("scope", [["42"]]);
    await f.bus.stop();
    expect(metric.mock.calls.map(([name]) => name)).toContain("cache_invalidation_publish_failed");
    expect(metric.mock.calls.map(([name]) => name)).toContain("cache_invalidation_handler_failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-");
    const second = fixture();
    await second.bus.start(second.transport, subset);
    const laterFlush = mock(() => {});
    second.bus.register("later", z.tuple([invalidationKey]), () => {}, laterFlush);
    second.flush.mockImplementation(() => {
      throw new Error("private-flush-body");
    });
    expect(() => second.reconnect()).not.toThrow();
    expect(laterFlush).toHaveBeenCalledTimes(1);
  });

  it("fails startup on subscription or initial flush failure and permits retry", async () => {
    const f = fixture();
    f.flush.mockImplementationOnce(() => {
      throw new Error("private-flush-body");
    });
    await expect(f.bus.start(f.transport, subset)).rejects.toThrow();
    expect(f.unlisten).toHaveBeenCalledTimes(1);
    await f.bus.start(f.transport, subset);
    expect(f.flush).toHaveBeenCalledTimes(2);
    await f.bus.stop();
    spyOn(f.transport, "listen").mockRejectedValueOnce(new Error("private-subscription-body"));
    await expect(f.bus.start(f.transport, subset)).rejects.toThrow();
    const starting = f.bus.start(f.transport, subset);
    expect(f.bus.start(f.transport, subset)).toBe(starting);
    await starting;
  });
});
