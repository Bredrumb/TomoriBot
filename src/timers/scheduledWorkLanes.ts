import { canRunScheduledWork, type ScheduledWorkContext } from "@/timers/scheduledWorkContext";
import { log } from "@/utils/misc/logger";

// Caps concurrent server lanes so synchronized due times cannot starve live chat, tuned via `scheduled_work_lanes_full`.
export const MAX_SCHEDULED_WORK_LANES = 16;

export interface ScheduledWorkTask {
  serverId: number;
  dueAt: number;
  run: () => Promise<void>;
}

// Module scope because a shard-lease swap replaces the coordinator while an old lane may still be settling.
const lanes = new Map<number, Promise<void>>();

export function hasScheduledWorkLane(serverId: number): boolean {
  return lanes.has(serverId);
}

export function getScheduledWorkLaneServerIds(): number[] {
  return [...lanes.keys()];
}

export function isScheduledWorkLaneCapacityFull(): boolean {
  return lanes.size >= MAX_SCHEDULED_WORK_LANES;
}

export function startScheduledWorkLanes(
  tasks: readonly ScheduledWorkTask[],
  work: ScheduledWorkContext,
  onLaneSettled: () => void,
): void {
  const queues = new Map<number, ScheduledWorkTask[]>();
  for (const task of [...tasks].sort((left, right) => left.dueAt - right.dueAt)) {
    const queue = queues.get(task.serverId);
    if (queue) queue.push(task);
    else queues.set(task.serverId, [task]);
  }

  let waiting = 0;
  for (const [serverId, queue] of queues) {
    if (lanes.has(serverId)) continue;
    if (isScheduledWorkLaneCapacityFull()) {
      waiting++;
      continue;
    }
    const lane = Promise.resolve()
      .then(() => runLane(serverId, queue, work))
      .finally(() => {
        lanes.delete(serverId);
        onLaneSettled();
      });
    lanes.set(serverId, lane);
  }

  if (waiting > 0) log.metric("scheduled_work_lanes_full", { lanes: MAX_SCHEDULED_WORK_LANES, waiting });
}

export async function waitForScheduledWorkLanes(signal?: AbortSignal): Promise<void> {
  const aborted =
    signal && new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  while (lanes.size > 0 && !signal?.aborted) {
    const settled = Promise.all(lanes.values());
    await (aborted ? Promise.race([settled, aborted]) : settled);
  }
}

async function runLane(serverId: number, queue: readonly ScheduledWorkTask[], work: ScheduledWorkContext) {
  try {
    for (const task of queue) {
      if (!canRunScheduledWork(work)) return;
      await task.run();
    }
  } catch (error) {
    if (canRunScheduledWork(work))
      await log.error("Scheduled work lane stopped on an unexpected error", error, { serverId });
  }
}
