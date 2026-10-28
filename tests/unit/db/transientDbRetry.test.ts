import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { withTransientDbRetry } from "@/utils/db/client";
import * as dbClient from "@/utils/db/client";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { fireRowSchema } from "@/modules/natural-nudges/db/types";
import { log } from "@/utils/misc/logger";
import { useEnvSandbox } from "../../helpers/env";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { serverStmConfigSchema } from "@/types/db/schema";

useEnvSandbox(["POSTGRES_TRANSIENT_RETRY_DELAY_MS", "POSTGRES_TRANSIENT_RETRY_ATTEMPTS"]);

beforeAll(() => {
  process.env.POSTGRES_TRANSIENT_RETRY_DELAY_MS = "0";
  process.env.POSTGRES_TRANSIENT_RETRY_ATTEMPTS = "3";
});

it("recovers saved short-term memory settings after a connection lifetime timeout", async () => {
  const row = serverStmConfigSchema.parse({ server_id: 1, refresh_cadence: 9, render_mode: "supersede" });
  const thunk = failOnceThen("ERR_POSTGRES_LIFETIME_TIMEOUT", [row]);
  const query = spyOn(dbClient, "sql").mockImplementation(thunk.run as unknown as typeof dbClient.sql);
  try {
    expect(await shortTermMemoryRepository.getStmConfig(1)).toEqual(row);
    expect(thunk.calls()).toBe(2);
  } finally {
    query.mockRestore();
  }
});

describe("natural nudge database reads", () => {
  const at = new Date("2026-01-01T12:00:00Z");
  const cases = [
    {
      name: "daily counts",
      read: () => statRepository.getServerDailyHeatCounts({ serverId: 1, from: at }),
      rows: [{ bucket: "2026-01-01", total: "7" }],
      expected: new Map([["2026-01-01", 7]]),
    },
    {
      name: "persona counts",
      read: () => statRepository.getServerPersonaMessageCounts({ serverId: 1, from: at }),
      rows: [{ persona_lineage_id: "2", total: "7" }],
      expected: new Map([[2, 7]]),
    },
    {
      name: "active hours",
      read: () => statRepository.getServerActiveHourHistogram({ serverId: 1, from: at }),
      rows: [{ metric_key: "12", total: "7" }],
      expected: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 7 : 0)),
    },
    {
      name: "last activity",
      read: () => statRepository.getServerMetricLastAt({ serverId: 1, metric: "message_sent" }),
      rows: [{ last_at: at }],
      expected: at,
    },
    {
      name: "runtime state",
      read: () => naturalNudgeRepository.loadRuntimeState(1),
      rows: [{ server_id: 1, idle_nudge_jitter: 1.2, consecutive_failures: 2, stopped_at: null }],
      expected: { server_id: 1, idle_nudge_jitter: 1.2, consecutive_failures: 2, stopped_at: null },
    },
  ];

  it.each(cases)("recovers $name after connection retirement", async ({ read, rows, expected }) => {
    const thunk = failOnceThen("ERR_POSTGRES_LIFETIME_TIMEOUT", rows);
    const query = spyOn(dbClient, "sql").mockImplementation(thunk.run as unknown as typeof dbClient.sql);
    try {
      expect(await read()).toEqual(expected);
      expect(thunk.calls()).toBe(2);
    } finally {
      query.mockRestore();
    }
  });

  it("retries both idle history windows when one connection retires", async () => {
    const row = fireRowSchema.parse({
      fire_id: 1,
      server_id: 1,
      channel_disc_id: "123456789012345678",
      persona_id: 1,
      mode: "idle",
      category: "start_topic",
      idle_nudge_key: null,
      target_user_id: null,
      opener_message_disc_id: "123456789012345679",
      answered: null,
      fired_at: at,
    });
    const thunk = failOnceThen("ERR_POSTGRES_LIFETIME_TIMEOUT", [row]);
    const query = spyOn(dbClient, "sql").mockImplementation(thunk.run as unknown as typeof dbClient.sql);
    try {
      expect(await naturalNudgeRepository.loadFireHistory(1, at, 3)).toEqual({
        recent: [row],
        latestIdleNudges: [row],
      });
      expect(thunk.calls()).toBe(4);
    } finally {
      query.mockRestore();
    }
  });

  it.each(cases)("propagates exhausted $name reads instead of supplying empty activity", async ({ read }) => {
    const error = postgresError("ERR_POSTGRES_LIFETIME_TIMEOUT");
    const query = spyOn(dbClient, "sql").mockImplementation((async () => {
      throw error;
    }) as unknown as typeof dbClient.sql);
    const logged = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      await expect(read()).rejects.toBe(error);
      expect(query).toHaveBeenCalledTimes(3);
    } finally {
      query.mockRestore();
      logged.mockRestore();
    }
  });
});

function postgresError(code: string): Error & { code: string } {
  return Object.assign(new Error("Failed to read data"), { code });
}

/**
 * Builds a thunk that fails once with `code`, then succeeds, so a passing assertion on
 * the returned value proves a retry happened rather than the error propagating.
 */
function failOnceThen<T>(code: string, value: T): { run: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    run: async () => {
      calls++;
      if (calls === 1) throw postgresError(code);
      return value;
    },
    calls: () => calls,
  };
}

describe("withTransientDbRetry connection-retirement classification", () => {
  // Bun rejects in-flight queries from `#onClose` using whatever state its wire-protocol
  // reader stopped in, so one dead connection surfaces under several codes. Missing any
  // of them means a healthy query fails outright instead of retrying on a fresh socket.
  it.each([
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_LIFETIME_TIMEOUT",
    "ERR_POSTGRES_IDLE_TIMEOUT",
    "ERR_POSTGRES_INVALID_MESSAGE",
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
  ])("retries %s on a fresh connection", async (code) => {
    const thunk = failOnceThen(code, "recovered");

    expect(await withTransientDbRetry(thunk.run, `retry ${code}`)).toBe("recovered");
    expect(thunk.calls()).toBe(2);
  });

  it("does not retry a genuine query fault", async () => {
    const thunk = failOnceThen("23505", "unreachable");

    await expect(withTransientDbRetry(thunk.run, "unique violation")).rejects.toThrow("Failed to read data");
    expect(thunk.calls()).toBe(1);
  });

  it("does not retry an error carrying no driver code", async () => {
    let calls = 0;

    await expect(
      withTransientDbRetry(async () => {
        calls++;
        throw new Error("ERR_POSTGRES_INVALID_MESSAGE");
      }, "message-only error"),
    ).rejects.toThrow("ERR_POSTGRES_INVALID_MESSAGE");
    expect(calls).toBe(1);
  });
});
