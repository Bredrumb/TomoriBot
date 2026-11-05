import { isDraining } from "@/utils/misc/shutdownState";

export interface ScheduledWorkContext {
  signal: AbortSignal;
  ownerSignal?: AbortSignal;
  hasOwnership: () => boolean;
}

export function canRunScheduledWork(work?: ScheduledWorkContext): boolean {
  return !isDraining() && (!work || (!work.signal.aborted && work.hasOwnership()));
}

export function assertScheduledWorkActive(work?: ScheduledWorkContext): void {
  if (!canRunScheduledWork(work)) throw new DOMException("Scheduled work cancelled", "AbortError");
}

export function canSettleScheduledWork(work?: ScheduledWorkContext): boolean {
  return !work || (!(work.ownerSignal ?? work.signal).aborted && work.hasOwnership());
}
