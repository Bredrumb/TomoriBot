import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { ServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { computeEffectiveHeat, computeHeat, heatWindowStart } from "@/modules/natural-nudges/runtime/meters";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { MIN_IDLE_NUDGE_HEAT, NUDGE_DORMANCY_MS } from "@/modules/natural-nudges/runtime/tuning";

/** Heat and automatic channels move over days, so five minutes stale costs a few counted messages at most. */
const GATE_TTL_MS = 5 * 60 * 1000;

export interface NaturalNudgeGate {
  serverId: number;
  config: ServerNaturalNudgeConfig;
  channelIds: ReadonlySet<string>;
  heat: number;
}

interface GateEntry {
  expiresAt: number;
  eligible: boolean;
  /** Shared by every message that arrives while the first read is still loading. */
  gate: Promise<NaturalNudgeGate | null>;
  serverId: number | null;
}

const entries = new Map<string, GateEntry>();
// Dormant activity stays cached until a successful direct-chat write replaces it.
const activityEntries = new Map<number, Promise<Date | null>>();

export async function isNaturalNudgeServerActive(serverId: number, now = new Date()): Promise<boolean> {
  let activity = activityEntries.get(serverId);
  if (!activity) {
    activity = naturalNudgeRepository.loadLastDirectChatAt(serverId);
    activityEntries.set(serverId, activity);
    void activity.catch(() => {
      if (activityEntries.get(serverId) === activity) activityEntries.delete(serverId);
    });
  }
  const lastDirectChatAt = await activity;
  return lastDirectChatAt !== null && now.getTime() - lastDirectChatAt.getTime() < NUDGE_DORMANCY_MS;
}

export async function recordNaturalNudgeDirectChat(serverId: number): Promise<void> {
  try {
    const lastDirectChatAt = await naturalNudgeRepository.recordDirectChat(serverId);
    activityEntries.set(serverId, Promise.resolve(lastDirectChatAt));
    invalidateInactiveNaturalNudgeGates(serverId);
  } catch (error) {
    log.warn("Natural Nudges: could not record direct chat activity", error, { metadata: { serverId } });
  }
}

async function loadGate(guildId: string, now: Date, entry: GateEntry): Promise<NaturalNudgeGate | null> {
  const personas = await getCachedAllPersonas(guildId);
  const serverId = personas[0]?.server_id;
  if (serverId === undefined) return null;
  entry.serverId = serverId;
  if (!(await isNaturalNudgeServerActive(serverId, now))) {
    entry.expiresAt = Number.POSITIVE_INFINITY;
    return null;
  }
  const config = await naturalNudgeRepository.loadServerConfig(serverId);
  if (!config.active_nudges_enabled && !config.idle_nudges_enabled) {
    entry.expiresAt = Number.POSITIVE_INFINITY;
    return null;
  }
  const dailyCounts = await statRepository.getServerDailyHeatCounts({ serverId, from: heatWindowStart(now) });
  const measuredHeat = computeHeat(dailyCounts, now);
  const heat = computeEffectiveHeat(measuredHeat, config.heat_offset);
  if (measuredHeat < MIN_IDLE_NUDGE_HEAT || heat < MIN_IDLE_NUDGE_HEAT) {
    entry.expiresAt = Number.POSITIVE_INFINITY;
    return null;
  }
  const channelIds = await resolveEffectiveChannelIds(serverId, config, now);
  if (channelIds.length === 0) {
    entry.expiresAt = Number.POSITIVE_INFINITY;
    return null;
  }
  return {
    serverId,
    config,
    channelIds: new Set(channelIds),
    heat,
  };
}

/** Null for a guild with no workspace; a failed read is not cached, so the next message retries. */
export async function readNaturalNudgeGate(guildId: string): Promise<NaturalNudgeGate | null> {
  const now = new Date();
  const cached = entries.get(guildId);
  if (cached && cached.expiresAt > now.getTime()) {
    if (cached.serverId !== null && !(await isNaturalNudgeServerActive(cached.serverId, now))) {
      cached.expiresAt = Number.POSITIVE_INFINITY;
      cached.eligible = false;
      cached.gate = Promise.resolve(null);
    }
    return cached.gate;
  }
  const entry: GateEntry = {
    expiresAt: now.getTime() + GATE_TTL_MS,
    eligible: false,
    gate: Promise.resolve(null),
    serverId: null,
  };
  entry.gate = loadGate(guildId, now, entry).then(
    (gate) => {
      entry.eligible = gate !== null && entry.expiresAt !== Number.POSITIVE_INFINITY;
      entry.serverId = gate?.serverId ?? entry.serverId;
      return gate;
    },
    (error) => {
      if (entries.get(guildId) === entry) entries.delete(guildId);
      log.warn("Natural Nudges: could not read nudge eligibility", error, { metadata: { guildId } });
      return null;
    },
  );
  entries.set(guildId, entry);
  return entry.gate;
}

/** Call after a successful settings write; entries still loading are dropped too, since they may predate it. */
export function invalidateNaturalNudgeConfigCache(serverId: number): void {
  for (const [guildId, entry] of entries) {
    if (entry.serverId === serverId || entry.serverId === null) entries.delete(guildId);
  }
}

export function invalidateInactiveNaturalNudgeGates(serverId: number): void {
  for (const [guildId, entry] of entries) {
    if (!entry.eligible && (entry.serverId === serverId || entry.serverId === null)) entries.delete(guildId);
  }
}
