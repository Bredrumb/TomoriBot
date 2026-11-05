import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { z } from "zod";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { serverScheduleRepository } from "@/utils/db/repositories/ServerScheduleRepository";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const eventSchema = z.object({
  type: z.enum(["acquiring", "ready", "turn_started", "turn_done", "guarded", "delivery", "scheduled", "failure"]),
  guildId: z.string(),
  holder: z.string().optional(),
  accepted: z.number().optional(),
});
type WorkerEvent = z.infer<typeof eventSchema>;

function worker(shard: number) {
  const events: WorkerEvent[] = [];
  const waiters = new Set<() => void>();
  const child = Bun.spawn([process.execPath, "--no-env-file", "tests/fixtures/shardRuntimeWorker.ts", String(shard)], {
    cwd: process.cwd(),
    env: { ...process.env, RUN_ENV: "development" },
    stdout: "pipe",
    stderr: "pipe",
    ipc(input) {
      events.push(eventSchema.parse(input));
      for (const notify of waiters) notify();
    },
  });
  const output = new Response(child.stdout).text();
  function wait(type: WorkerEvent["type"], after = 0): Promise<WorkerEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`Worker ${shard} did not report ${type}`));
      }, 50_000);
      const check = () => {
        const event = events.slice(after).find((entry) => entry.type === type);
        if (event) {
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(event);
        }
      };
      waiters.add(check);
      check();
      void child.exited.then(async (code) => {
        if (!waiters.delete(check)) return;
        clearTimeout(timeout);
        reject(new Error(`Worker ${shard} exited ${code}: ${await new Response(child.stderr).text()}`));
      });
    });
  }
  return { child, events, wait, output, command: (action: string) => child.send({ action }) };
}

describe.skipIf(!DB_TESTS_AVAILABLE)("sharded runtime with separate processes", () => {
  let refs: FixtureRefs;
  const servers: Array<{ server_id: number; server_disc_id: string }> = [];
  const guildIds = ["1200000000004194304", "1200000000000000000"];
  const channelIds = ["1400000000000000000", "1400000000004194304"];
  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`UPDATE servers SET server_disc_id = '1600000000000000000' WHERE server_id = ${refs.serverId}`;
    for (const guildId of guildIds) {
      const [server] = await testSql<
        { server_id: number; server_disc_id: string }[]
      >`INSERT INTO servers (server_disc_id) VALUES (${guildId}) RETURNING server_id, server_disc_id`;
      servers.push(server);
      await testSql`INSERT INTO guild_mcp_servers (server_id, name, url, server_type) VALUES (${server.server_id}, 'fixture', 'https://example.invalid/mcp', 'http')`;
    }
  });
  afterAll(async () => {
    for (const server of servers) await testSql`DELETE FROM servers WHERE server_id = ${server.server_id}`;
    await testSql`DELETE FROM cluster_leases`;
    await testSql`DELETE FROM servers WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  it("loads only each owner's enabled MCP registrations", async () => {
    for (const shard of [0, 1]) {
      const rows = await toolRepository.loadAllEnabledMcpServers(
        parseShardTopology({ SHARD_COUNT: "2", SHARD_IDS: String(shard) }),
      );
      expect(rows.map((row) => row.server_id)).toEqual([servers[shard].server_id]);
    }
  });

  // Separate processes and real expiry are required to exercise a killed holder without running its cleanup.
  it("keeps another owner's turns and schedules live through a mid-turn kill, then bounds restart by the lease", async () => {
    const processes: ReturnType<typeof worker>[] = [];
    let passed = false;
    const addReminder = async (shard: number) => {
      const result = await serverScheduleRepository.addReminder({
        server_id: servers[shard].server_id,
        channel_disc_id: channelIds[shard],
        user_discord_id: "1300000000000000000",
        user_nickname: "Juno",
        reminder_purpose: "Water the plants",
        reminder_time: new Date(Date.now() - 1000),
        created_by_user_id: refs.userId,
      });
      if (!result?.reminder_id) throw new Error("Reminder fixture insertion failed");
      return result.reminder_id;
    };
    try {
      const first = worker(0);
      const survivor = worker(1);
      processes.push(first, survivor);
      const [firstReady, survivorReady] = await Promise.all([first.wait("ready"), survivor.wait("ready")]);
      expect(firstReady.holder).not.toBe(survivorReady.holder);
      const reminderIds = await Promise.all([addReminder(0), addReminder(1)]);
      for (const processWorker of processes) processWorker.command("schedule");
      await Promise.all(processes.map((processWorker) => processWorker.wait("scheduled")));
      for (const processWorker of processes) {
        expect(processWorker.events.filter((event) => event.type === "delivery")).toHaveLength(1);
        const count = processWorker.events.length;
        processWorker.command("schedule");
        await processWorker.wait("scheduled", count);
        expect(processWorker.events.filter((event) => event.type === "delivery")).toHaveLength(1);
        processWorker.command("foreign");
        expect((await processWorker.wait("guarded")).accepted).toBe(0);
      }
      const [remaining] =
        await testSql`SELECT COUNT(*)::int AS count FROM reminders WHERE reminder_id = ANY(${testSql.array(reminderIds, "INT")})`;
      expect(remaining.count).toBe(0);
      first.command("hold");
      await first.wait("turn_started");
      const [predecessor] =
        await testSql`SELECT holder, token::text, expires_at FROM cluster_leases WHERE name = 'shard:0'`;
      first.child.kill("SIGKILL");
      await first.child.exited;
      survivor.command("turn");
      await survivor.wait("turn_done");
      expect(first.events.some((event) => event.type === "turn_done")).toBe(false);
      const pendingId = await addReminder(0);
      const restartAt = performance.now();
      const replacement = worker(0);
      processes.push(replacement);
      await replacement.wait("acquiring");
      const [stillHeld] =
        await testSql`SELECT holder, expires_at > clock_timestamp() AS live FROM cluster_leases WHERE name = 'shard:0'`;
      expect(stillHeld).toMatchObject({ holder: predecessor.holder, live: true });
      expect(replacement.events.some((event) => event.type === "ready")).toBe(false);
      const replaced = await replacement.wait("ready");
      expect(performance.now() - restartAt).toBeLessThan(40_000);
      const [elapsed] = await testSql`SELECT clock_timestamp() >= ${predecessor.expires_at} AS expired`;
      expect(elapsed.expired).toBe(true);
      const [claim] = await testSql`SELECT holder, token::text FROM cluster_leases WHERE name = 'shard:0'`;
      expect(claim.holder).toBe(replaced.holder);
      expect(BigInt(claim.token)).toBeGreaterThan(BigInt(predecessor.token));
      replacement.command("schedule");
      await replacement.wait("scheduled");
      expect(replacement.events.filter((event) => event.type === "delivery")).toHaveLength(1);
      const pending = await testSql`SELECT reminder_id FROM reminders WHERE reminder_id = ${pendingId}`;
      expect(pending).toHaveLength(0);
      expect(survivor.events.some((event) => event.type === "failure")).toBe(false);
      passed = true;
    } finally {
      await Promise.all(
        processes.map(async (processWorker) => {
          if (!processWorker.child.killed && processWorker.child.exitCode === null) processWorker.command("stop");
          const deadline = setTimeout(() => processWorker.child.kill("SIGKILL"), 5000);
          try {
            await processWorker.child.exited;
            if (!passed) console.log(await processWorker.output);
          } finally {
            clearTimeout(deadline);
          }
        }),
      );
    }
  }, 120_000);
});
