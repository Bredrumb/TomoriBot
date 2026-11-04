import type { ClientOptions, REST } from "discord.js";
import { Routes } from "discord.js";
import { z } from "zod";
import { clusterLeaseRepository } from "@/utils/db/repositories/ClusterLeaseRepository";
import { coordinationClock, type CoordinationClock, type LeaseStore } from "@/utils/cluster/leaseKeeper";
import { clusterHolderId } from "@/utils/cluster/shardLeases";
import { log } from "@/utils/misc/logger";

const IDENTIFY_SPACING_MS = 5_500;
const IDENTIFY_MAX_ROUND_TRIP_MS = 500;
const IDENTIFY_POLL_MS = 250;
const SESSION_START_FLOOR = 20;
const gatewaySchema = z.object({
  session_start_limit: z.object({
    remaining: z.number().int().nonnegative(),
    reset_after: z.number().finite().nonnegative(),
    max_concurrency: z.number().int().positive(),
  }),
});

type IdentifyBuilder = NonNullable<NonNullable<ClientOptions["ws"]>["buildIdentifyThrottler"]>;
type GatewayRest = Pick<REST, "get">;

export async function waitForSessionStarts(
  rest: GatewayRest,
  required: number,
  signal: AbortSignal,
  clock: CoordinationClock = coordinationClock,
): Promise<void> {
  if (!Number.isSafeInteger(required) || required < 1) throw new Error("Invalid session start requirement");
  while (true) {
    signal.throwIfAborted();
    const { session_start_limit: limit } = gatewaySchema.parse(await rest.get(Routes.gatewayBot(), { signal }));
    signal.throwIfAborted();
    if (limit.remaining >= Math.max(SESSION_START_FLOOR, required)) return;
    log.warn("Discord session starts are low; waiting for the budget reset", undefined, {
      metadata: { remaining: limit.remaining, reset_after: limit.reset_after },
    });
    await clock.sleep(Math.max(1_000, limit.reset_after), signal);
  }
}

export class PostgresIdentifyThrottler {
  constructor(
    private readonly rest: GatewayRest,
    private readonly shutdownSignal: AbortSignal,
    private readonly repository: Pick<LeaseStore, "takeIfExpired"> = clusterLeaseRepository,
    private readonly holder: string = clusterHolderId,
    private readonly clock: CoordinationClock = coordinationClock,
  ) {}

  async waitForIdentify(_shardId: number, shardSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([this.shutdownSignal, shardSignal]);
    while (true) {
      await waitForSessionStarts(this.rest, 1, signal, this.clock);
      const sentAt = this.clock.now();
      const grant = await this.repository.takeIfExpired("discord-identify", this.holder, IDENTIFY_SPACING_MS, signal);
      signal.throwIfAborted();
      // A late grant consumes its slot because returning it could shorten Discord's five-second spacing.
      if (grant && this.clock.now() - sentAt <= IDENTIFY_MAX_ROUND_TRIP_MS) return;
      await this.clock.sleep(IDENTIFY_POLL_MS, signal);
    }
  }
}

export function buildIdentifyThrottler(shutdownSignal: AbortSignal): IdentifyBuilder {
  return (manager) => new PostgresIdentifyThrottler(manager.options.rest, shutdownSignal);
}
