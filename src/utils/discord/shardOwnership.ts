export interface ShardEnvironment {
  SHARD_COUNT?: string;
  SHARD_IDS?: string;
}

export class ShardTopology {
  private resolvedTotal: number | null;
  private resolvedIds: readonly number[] | null;

  constructor(
    readonly shardCount: number | "auto",
    ids: readonly number[] | null,
  ) {
    this.resolvedTotal = shardCount === "auto" ? null : shardCount;
    this.resolvedIds = ids === null ? null : Object.freeze([...ids]);
  }

  get totalShardCount(): number | null {
    return this.resolvedTotal;
  }

  get ownedShardIds(): readonly number[] | null {
    return this.resolvedIds;
  }

  get processLabel(): string {
    return this.ownsAllShards()
      ? "all"
      : `shards:${this.shardCount}:${this.getResolvedTopology().ownedShardIds.join(",")}`;
  }

  getResolvedTopology(): { totalShardCount: number; ownedShardIds: readonly number[] } {
    if (this.resolvedTotal === null || this.resolvedIds === null) {
      throw new Error("Gateway shard count has not resolved yet");
    }
    return { totalShardCount: this.resolvedTotal, ownedShardIds: this.resolvedIds };
  }

  getClientShardOptions(): { shards: "auto" } | { shards: number[]; shardCount: number } {
    if (this.shardCount === "auto") return { shards: "auto" };
    return { shards: [...this.getResolvedTopology().ownedShardIds], shardCount: this.shardCount };
  }

  resolveGatewayShardCount(total: number): void {
    if (!Number.isSafeInteger(total) || total < 1) throw new Error("Invalid gateway shard count");
    if (this.resolvedTotal !== null && this.resolvedTotal !== total) {
      throw new Error("Gateway shard count disagrees with initialized topology");
    }
    if (this.resolvedTotal !== null) return;
    this.resolvedTotal = total;
    this.resolvedIds = Object.freeze(Array.from({ length: total }, (_, id) => id));
  }

  ownsAllShards(): boolean {
    return this.shardCount === "auto" || this.resolvedIds?.length === this.resolvedTotal;
  }

  selectsShardZero(): boolean {
    return this.ownsAllShards() || this.resolvedIds?.includes(0) === true;
  }

  shardForServer(serverDiscId: string, isDm: boolean): number {
    if (isDm) return 0;
    if (this.resolvedTotal === null) throw new Error("Gateway shard count has not resolved yet");
    return Number((BigInt(serverDiscId) >> 22n) % BigInt(this.resolvedTotal));
  }

  ownsServer(serverDiscId: string, isDm: boolean): boolean {
    if (this.ownsAllShards()) return true;
    return this.resolvedIds?.includes(this.shardForServer(serverDiscId, isDm)) === true;
  }
}

export function parseShardTopology(env: ShardEnvironment): ShardTopology {
  const value = env.SHARD_COUNT?.trim();
  const count = value === undefined || value === "" || value === "auto" ? "auto" : Number(value);
  if (count !== "auto" && (!/^\d+$/.test(value ?? "") || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error("SHARD_COUNT must be a positive integer or auto");
  }
  if (env.SHARD_IDS === undefined) {
    return new ShardTopology(count, count === "auto" ? null : Array.from({ length: count }, (_, id) => id));
  }
  if (count === "auto") throw new Error("SHARD_IDS requires an explicit SHARD_COUNT");
  const parts = env.SHARD_IDS.split(",").map((part) => part.trim());
  const ids = parts.map(Number);
  if (
    parts.some((part) => !/^\d+$/.test(part)) ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 0 || id >= count) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("SHARD_IDS must be a nonempty list of unique integers within SHARD_COUNT");
  }
  return new ShardTopology(
    count,
    ids.sort((a, b) => a - b),
  );
}

let topology: ShardTopology | undefined;

export function initializeShardTopology(
  env: ShardEnvironment = { SHARD_COUNT: process.env.SHARD_COUNT, SHARD_IDS: process.env.SHARD_IDS },
): ShardTopology {
  topology ??= parseShardTopology(env);
  return topology;
}

export function getShardTopology(): ShardTopology {
  if (!topology) throw new Error("Shard topology must be initialized after secrets load");
  return topology;
}
