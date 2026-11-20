import { type ClientOptions, Status } from "discord.js";
import { getShardTopology, type ShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";

const MAX_PING_LATENCY_MS = 5000;
const NOT_READY_TIMEOUT_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 10_000;

interface GatewayHealthClient {
  isReady(): boolean;
  options: Pick<ClientOptions, "shards" | "shardCount">;
  ws: { shards: ReadonlyMap<number, { status: Status; ping: number }> };
}

interface ShardConnectionState {
  gatewayFailureCount: number;
  lastGatewayFailureAt: number | null;
  notReadySince: number | null;
}

export interface ShardHealth {
  id: number;
  status: Status | null;
  ready: boolean;
  ping: number | null;
  gatewayFailureCount: number;
  lastGatewayFailureAt: string | null;
  notReadySince: string | null;
}

interface ShardWatchdogTimeout {
  shardIds: readonly number[];
  notReadySince: number;
}

type WatchdogShutdown = (timeout: ShardWatchdogTimeout) => void | Promise<void>;

export class HealthTracker {
  private lastActivityTimestamp: number;
  private initializedAt: number;
  private client: GatewayHealthClient | null = null;
  private topology: ShardTopology | null = null;
  private readonly connections = new Map<number, ShardConnectionState>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private shutdown: WatchdogShutdown | null = null;
  private watchdogTriggered = false;

  constructor(private readonly now: () => number = Date.now) {
    this.initializedAt = this.now();
    this.lastActivityTimestamp = this.initializedAt;
  }

  initialize(client: GatewayHealthClient, topology: ShardTopology = getShardTopology()): void {
    if (this.client === client) return;
    this.stopWatchdog();
    this.client = client;
    this.topology = topology;
    this.initializedAt = this.now();
    this.lastActivityTimestamp = this.initializedAt;
    this.connections.clear();
    this.watchdogTriggered = false;
    log.info("Health tracker initialized");
  }

  recordActivity(): void {
    this.lastActivityTimestamp = this.now();
  }

  private connection(shardId: number): ShardConnectionState {
    let state = this.connections.get(shardId);
    if (!state) {
      state = { gatewayFailureCount: 0, lastGatewayFailureAt: null, notReadySince: this.initializedAt };
      this.connections.set(shardId, state);
    }
    return state;
  }

  private shardHealth(): ShardHealth[] {
    if (!this.client || !this.topology) return [];
    const { shards, shardCount } = this.client.options;
    // discord.js replaces auto with the gateway ID array before connecting any shard.
    if (this.topology.totalShardCount === null && Array.isArray(shards) && shardCount !== undefined) {
      this.topology.resolveGatewayShardCount(shardCount);
    }
    return (this.topology.ownedShardIds ?? []).map((id) => {
      const shard = this.client?.ws.shards.get(id);
      const state = this.connection(id);
      const ready = shard?.status === Status.Ready;
      if (ready) state.notReadySince = null;
      else state.notReadySince ??= this.now();
      return {
        id,
        status: shard?.status ?? null,
        ready,
        ping: shard && Number.isFinite(shard.ping) ? shard.ping : null,
        gatewayFailureCount: state.gatewayFailureCount,
        lastGatewayFailureAt:
          state.lastGatewayFailureAt === null ? null : new Date(state.lastGatewayFailureAt).toISOString(),
        notReadySince: state.notReadySince === null ? null : new Date(state.notReadySince).toISOString(),
      };
    });
  }

  getHealthStatus(): HealthStatus {
    const shards = this.shardHealth();
    const pings = shards.flatMap((shard) => (shard.ping === null ? [] : [shard.ping]));
    const details = {
      clientReady: this.client?.isReady() ?? false,
      timeSinceLastActivity: this.getTimeSinceLastActivity(),
      websocketPing: pings.length ? Math.max(...pings) : null,
      shards,
      shardCount: this.topology?.totalShardCount ?? null,
    };
    if (!this.client) return { healthy: false, reason: "Client not initialized", details };
    const notReady = shards.filter((shard) => !shard.ready);
    if (notReady.length || shards.length === 0 || !details.clientReady) {
      return { healthy: false, reason: "Discord client not ready", details };
    }
    const unhealthyPing = shards.find(
      (shard) => shard.ping === null || shard.ping < 0 || shard.ping > MAX_PING_LATENCY_MS,
    );
    if (unhealthyPing) {
      return { healthy: false, reason: `WebSocket ping unhealthy on shard ${unhealthyPing.id}`, details };
    }
    return { healthy: true, reason: "All systems operational", details };
  }

  getTimeSinceLastActivity(): number {
    return this.now() - this.lastActivityTimestamp;
  }

  recordGatewayFailure(shardId: number): void {
    const state = this.connection(shardId);
    state.gatewayFailureCount++;
    state.lastGatewayFailureAt = this.now();
  }

  recordGatewayConnected(shardId: number): void {
    this.shardHealth();
    const state = this.connection(shardId);
    state.gatewayFailureCount = 0;
    state.lastGatewayFailureAt = null;
    state.notReadySince = null;
  }

  recordGatewayDisconnected(shardId: number): void {
    this.connection(shardId).notReadySince ??= this.now();
  }

  getWebSocketPing(): number {
    return this.getHealthStatus().details.websocketPing ?? -1;
  }

  getConnectionState(): { gatewayFailureCount: number; lastGatewayFailureAt: string | null } {
    const states = [...this.connections.values()];
    const failures = states.flatMap((state) =>
      state.lastGatewayFailureAt === null ? [] : [state.lastGatewayFailureAt],
    );
    return {
      gatewayFailureCount: states.reduce((sum, state) => sum + state.gatewayFailureCount, 0),
      lastGatewayFailureAt: failures.length ? new Date(Math.max(...failures)).toISOString() : null,
    };
  }

  startWatchdog(shutdown: WatchdogShutdown): void {
    if (this.watchdog !== null) return;
    if (!this.client) throw new Error("Initialize health tracking before starting the shard watchdog");
    this.shutdown = shutdown;
    this.watchdog = setInterval(() => this.checkWatchdog(), WATCHDOG_INTERVAL_MS);
    this.watchdog.unref();
  }

  checkWatchdog(): void {
    if (!this.shutdown || this.watchdogTriggered) return;
    const shards = this.shardHealth();
    const expired = shards.filter((shard) => {
      const since = this.connection(shard.id).notReadySince;
      return !shard.ready && since !== null && this.now() - since >= NOT_READY_TIMEOUT_MS;
    });
    if (!expired.length && (shards.length || this.now() - this.initializedAt < NOT_READY_TIMEOUT_MS)) return;
    const timeout = {
      shardIds: expired.map((shard) => shard.id),
      notReadySince: expired.length
        ? Math.min(...expired.map((shard) => this.connection(shard.id).notReadySince ?? this.initializedAt))
        : this.initializedAt,
    };
    this.watchdogTriggered = true;
    const shutdown = this.shutdown;
    log.warn("Discord shard readiness watchdog requested shutdown", undefined, { metadata: { ...timeout } });
    void Promise.resolve()
      .then(() => shutdown(timeout))
      .catch((error) => log.error("Shard watchdog shutdown failed", error));
  }

  stopWatchdog(): void {
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    this.shutdown = null;
  }
}

interface HealthStatus {
  healthy: boolean;
  reason: string;
  details: {
    clientReady: boolean;
    timeSinceLastActivity: number;
    websocketPing: number | null;
    shards: ShardHealth[];
    shardCount: number | null;
  };
}

export const healthTracker = new HealthTracker();
