import { afterEach, describe, expect, it, mock } from "bun:test";
import { Status } from "discord.js";
import { HealthTracker } from "@/utils/misc/healthTracker";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ info: () => undefined, warn: () => undefined, error: () => undefined });
const trackers: HealthTracker[] = [];
afterEach(() => {
  for (const tracker of trackers) tracker.stopWatchdog();
  trackers.length = 0;
});

function gatewayFixture(ids = [0, 1, 2, 3]) {
  let now = 0;
  const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: ids.join(",") });
  const tracker = new HealthTracker(() => now);
  trackers.push(tracker);
  const client = {
    isReady: () => true,
    options: topology.getClientShardOptions(),
    ws: { shards: new Map(ids.map((id) => [id, { status: Status.Ready, ping: 50 }])) },
  };
  tracker.initialize(client, topology);
  return {
    tracker,
    client,
    topology,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("shard health", () => {
  it("reports a dead member despite healthy peers and ignores activity age", () => {
    const { tracker, client, advance } = gatewayFixture();
    expect(tracker.getHealthStatus().healthy).toBe(true);
    client.ws.shards.set(2, { status: Status.Disconnected, ping: 50 });
    const status = tracker.getHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.details.shards.find((shard) => shard.id === 2)?.ready).toBe(false);
    expect(status.details.websocketPing).toBe(50);
    client.ws.shards.delete(2);
    expect(tracker.getHealthStatus().details.shards.find((shard) => shard.id === 2)?.status).toBeNull();
    client.ws.shards.set(2, { status: Status.Ready, ping: 50 });
    advance(24 * 60 * 60 * 1000);
    expect(tracker.getHealthStatus().healthy).toBe(true);
  });

  it.each([-1, 5001, Number.NaN])("rejects one unhealthy shard ping (%s)", (ping) => {
    const { tracker, client } = gatewayFixture();
    client.ws.shards.set(3, { status: Status.Ready, ping });
    expect(tracker.getHealthStatus().healthy).toBe(false);
  });

  it("only watches configured shards and preserves failures on a different shard's resume", () => {
    const { tracker } = gatewayFixture([1, 3]);
    tracker.recordGatewayFailure(1);
    tracker.recordGatewayFailure(3);
    tracker.recordGatewayConnected(1);
    expect(tracker.getConnectionState().gatewayFailureCount).toBe(1);
    expect(tracker.getHealthStatus().details.shards.find((shard) => shard.id === 3)?.gatewayFailureCount).toBe(1);
    tracker.recordGatewayConnected(3);
    expect(tracker.getConnectionState().gatewayFailureCount).toBe(0);
    expect(tracker.getHealthStatus().healthy).toBe(true);
  });

  it("times out a never-ready shard from initialization and survives the ready callback reinitialization", async () => {
    const { tracker, client, topology, advance } = gatewayFixture();
    client.ws.shards.delete(3);
    const shutdown = mock(() => undefined);
    tracker.startWatchdog(shutdown);
    advance(299999);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
    tracker.initialize(client, topology);
    advance(1);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledWith({ shardIds: [3], notReadySince: 0 });
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("also times out startup before auto topology resolves", async () => {
    let now = 0;
    const tracker = new HealthTracker(() => now);
    trackers.push(tracker);
    const topology = parseShardTopology({});
    const client = { isReady: () => false, options: topology.getClientShardOptions(), ws: { shards: new Map() } };
    tracker.initialize(client, topology);
    const shutdown = mock(() => undefined);
    tracker.startWatchdog(shutdown);
    now = 300000;
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledWith({ shardIds: [], notReadySince: 0 });
    expect(tracker.getHealthStatus().healthy).toBe(false);
  });

  it("resolves every auto shard before all are ready", () => {
    const tracker = new HealthTracker();
    trackers.push(tracker);
    const topology = parseShardTopology({});
    const client = {
      isReady: () => false,
      options: { shards: [0, 1], shardCount: 2 },
      ws: { shards: new Map([[0, { status: Status.Ready, ping: 10 }]]) },
    };
    tracker.initialize(client, topology);
    const status = tracker.getHealthStatus();
    expect(status.details.shardCount).toBe(2);
    expect(status.details.shards.map((shard) => shard.id)).toEqual([0, 1]);
    expect(status.healthy).toBe(false);
  });

  it("resets only the recovered shard's not-ready timeout", async () => {
    const { tracker, client, advance } = gatewayFixture();
    tracker.getHealthStatus();
    const shutdown = mock(() => undefined);
    tracker.startWatchdog(shutdown);
    advance(1000);
    for (const id of [1, 2]) {
      client.ws.shards.set(id, { status: Status.Connecting, ping: -1 });
      tracker.recordGatewayDisconnected(id);
    }
    advance(299999);
    client.ws.shards.set(1, { status: Status.Ready, ping: 20 });
    tracker.recordGatewayConnected(1);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
    advance(1);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledWith({ shardIds: [2], notReadySince: 1000 });
  });

  it("allows a reconnect to recover before the deadline and starts a fresh outage window", async () => {
    const { tracker, client, advance } = gatewayFixture([1]);
    tracker.getHealthStatus();
    const shutdown = mock(() => undefined);
    tracker.startWatchdog(shutdown);
    advance(1000);
    client.ws.shards.set(1, { status: Status.Connecting, ping: -1 });
    tracker.recordGatewayDisconnected(1);
    advance(299999);
    client.ws.shards.set(1, { status: Status.Ready, ping: 20 });
    tracker.recordGatewayConnected(1);
    advance(600000);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
    expect(tracker.getHealthStatus().healthy).toBe(true);
    client.ws.shards.set(1, { status: Status.Connecting, ping: -1 });
    tracker.recordGatewayDisconnected(1);
    advance(299999);
    tracker.checkWatchdog();
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
  });
});
