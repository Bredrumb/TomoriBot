import { randomUUID } from "node:crypto";
import { getShardTopology, type ShardTopology } from "@/utils/discord/shardOwnership";
import { LeaseKeeper, type LeaseCallbacks, type LeaseStore, type CoordinationClock } from "@/utils/cluster/leaseKeeper";

export const clusterHolderId = randomUUID();

export class ShardLeaseCoordinator {
  private readonly keeper: LeaseKeeper | null;
  private readonly localWork = new AbortController();

  constructor(
    private readonly topology: ShardTopology,
    callbacks: LeaseCallbacks,
    repository?: LeaseStore,
    clock?: CoordinationClock,
    holder = randomUUID(),
  ) {
    this.keeper = topology.ownsAllShards()
      ? null
      : new LeaseKeeper(
          topology.getResolvedTopology().ownedShardIds.map((id) => `shard:${id}`),
          holder,
          callbacks,
          repository,
          clock,
        );
  }

  async acquire(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return this.keeper ? this.keeper.acquire(signal) : !this.localWork.signal.aborted;
  }

  hasOwnership(): boolean {
    return this.keeper ? this.keeper.isValid() : !this.localWork.signal.aborted;
  }

  isPrimaryProcess(): boolean {
    return this.topology.selectsShardZero() && this.hasOwnership();
  }

  get workSignal(): AbortSignal {
    return this.keeper?.workSignal ?? this.localWork.signal;
  }

  async stop(): Promise<void> {
    this.localWork.abort();
    await this.keeper?.stop();
  }
}

let coordinator: ShardLeaseCoordinator | undefined;

export async function acquireShardLeases(callbacks: LeaseCallbacks, signal: AbortSignal): Promise<boolean> {
  coordinator ??= new ShardLeaseCoordinator(getShardTopology(), callbacks, undefined, undefined, clusterHolderId);
  return coordinator.acquire(signal);
}

export function hasShardLeaseOwnership(): boolean {
  return coordinator?.hasOwnership() ?? getShardTopology().ownsAllShards();
}

export function isPrimaryProcess(): boolean {
  return coordinator?.isPrimaryProcess() ?? getShardTopology().ownsAllShards();
}

export function getOwnerWorkSignal(): AbortSignal {
  if (!coordinator) throw new Error("Shard coordination has not initialized");
  return coordinator.workSignal;
}

export async function releaseShardLeases(): Promise<void> {
  await coordinator?.stop();
}
