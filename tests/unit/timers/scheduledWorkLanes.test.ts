import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ScheduledWorkContext } from "@/timers/scheduledWorkContext";
import {
  MAX_SCHEDULED_WORK_LANES,
  hasScheduledWorkLane,
  startScheduledWorkLanes,
  waitForScheduledWorkLanes,
  type ScheduledWorkTask,
} from "@/timers/scheduledWorkLanes";
import { log } from "@/utils/misc/logger";

const work: ScheduledWorkContext = { signal: new AbortController().signal, hasOwnership: () => true };
const gates: Array<PromiseWithResolvers<void>> = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function heldGate(): PromiseWithResolvers<void> {
  const gate = Promise.withResolvers<void>();
  gates.push(gate);
  return gate;
}

function task(serverId: number, dueAt: number, events: string[], gate?: PromiseWithResolvers<void>): ScheduledWorkTask {
  return {
    serverId,
    dueAt,
    run: async () => {
      events.push(`start:${serverId}:${dueAt}`);
      await gate?.promise;
      events.push(`end:${serverId}:${dueAt}`);
    },
  };
}

afterEach(async () => {
  for (const gate of gates.splice(0)) gate.resolve();
  await waitForScheduledWorkLanes();
});

describe("scheduled work lanes", () => {
  it("starts another server's due work while one server's turn never settles", async () => {
    const events: string[] = [];
    startScheduledWorkLanes([task(1, 1, events, heldGate()), task(2, 2, events)], work, () => {});
    await flush();
    expect(events).toContain("start:1:1");
    expect(events).toContain("end:2:2");
  });

  it("dispatches a server that comes due while another server's lane is still running", async () => {
    const events: string[] = [];
    startScheduledWorkLanes([task(1, 1, events, heldGate())], work, () => {});
    await flush();
    startScheduledWorkLanes([task(1, 5, events), task(2, 6, events)], work, () => {});
    await flush();
    expect(events).toContain("end:2:6");
    expect(events).not.toContain("start:1:5");
    expect(hasScheduledWorkLane(1)).toBe(true);
  });

  it("runs one server's tasks in due order, one at a time", async () => {
    const events: string[] = [];
    const first = heldGate();
    startScheduledWorkLanes([task(1, 20, events), task(1, 10, events, first)], work, () => {});
    await flush();
    expect(events).toEqual(["start:1:10"]);
    first.resolve();
    await waitForScheduledWorkLanes();
    expect(events).toEqual(["start:1:10", "end:1:10", "start:1:20", "end:1:20"]);
  });

  it("holds servers past the cap until a lane settles, then starts the earliest due", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    try {
      const events: string[] = [];
      const gateFor = new Map<number, PromiseWithResolvers<void>>();
      const servers = Array.from({ length: MAX_SCHEDULED_WORK_LANES + 2 }, (_, index) => index + 1);
      for (const serverId of servers) gateFor.set(serverId, heldGate());
      let settled = 0;
      const onSettled = () => {
        settled++;
      };
      startScheduledWorkLanes(
        servers.map((serverId) => task(serverId, serverId, events, gateFor.get(serverId))),
        work,
        onSettled,
      );
      const late = MAX_SCHEDULED_WORK_LANES + 1;
      const later = MAX_SCHEDULED_WORK_LANES + 2;
      expect(hasScheduledWorkLane(late)).toBe(false);
      expect(metric).toHaveBeenCalledWith("scheduled_work_lanes_full", {
        lanes: MAX_SCHEDULED_WORK_LANES,
        waiting: 2,
      });

      gateFor.get(1)?.resolve();
      await flush();
      expect(hasScheduledWorkLane(1)).toBe(false);
      expect(settled).toBe(1);

      startScheduledWorkLanes(
        [task(later, later, events), task(late, late, events, gateFor.get(late))],
        work,
        onSettled,
      );
      expect(hasScheduledWorkLane(late)).toBe(true);
      expect(hasScheduledWorkLane(later)).toBe(false);
    } finally {
      metric.mockRestore();
    }
  });
});
