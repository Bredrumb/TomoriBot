import { describe, expect, it } from "bun:test";
import { sql } from "@/utils/db/client";
import { ownedServersOnly } from "@/utils/db/repositories/shardFilter";
import {
  findProcessWideMutations,
  findUnrestoredMutations,
  reachesTestDatabase,
  usesModuleMocks,
} from "../../../scripts/checks/lib/testIsolation";
import { useEnvSandbox } from "../../helpers/env";

// Detectors are shared via testIsolation.ts because runTests.ts batches files into shared Bun processes and runs unit
// lanes concurrently with the DB lane.

// Checks tests under this path quote the forbidden markers they test, so the directory is excluded to prevent
// self-flagging.
const SCAN_EXEMPT_DIRECTORY = "tests/unit/checks/";

async function discoverTestFiles(): Promise<string[]> {
  const glob = new Bun.Glob("**/*.test.ts");
  const files: string[] = [];
  for await (const relative of glob.scan({ cwd: "tests" })) {
    files.push(`tests/${relative.replaceAll("\\", "/")}`);
  }
  return files.sort();
}

async function readScannableFiles(): Promise<Array<[string, string]>> {
  const files = (await discoverTestFiles()).filter((file) => !file.startsWith(SCAN_EXEMPT_DIRECTORY));
  return Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as [string, string]));
}

describe("test isolation hygiene", () => {
  useEnvSandbox(["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_PASSWORD"]);

  it("keeps database credentials and background telemetry writes out of unit processes", () => {
    for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PASSWORD", "TEST_DB_READY"]) {
      expect(process.env[name] === undefined, name).toBe(true);
    }
    expect(process.env.STAT_TRACKING_ENABLED).toBe("false");
  });

  it("rejects unconfigured sql queries without opening a socket or creating unhandled fragment rejections", async () => {
    let connections = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data() {},
      },
    });
    try {
      delete process.env.POSTGRES_PASSWORD;
      process.env.POSTGRES_HOST = "127.0.0.1";
      process.env.POSTGRES_PORT = String(listener.port);

      expect(typeof sql.array).toBe("function");
      const standaloneFragment = ownedServersOnly();
      expect(typeof standaloneFragment.then).toBe("function");
      await expect((async () => await sql`SELECT 1 WHERE ${ownedServersOnly()}`)()).rejects.toThrow();
      await expect(sql`SELECT 1`.execute()).rejects.toThrow();
      await expect((async () => await sql.unsafe("SELECT 1"))()).rejects.toThrow();
      await expect(sql.begin(async () => undefined)).rejects.toThrow();
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
      expect(connections).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      listener.stop(true);
    }
  });

  it("keeps database-touching tests out of the concurrently-running unit lanes", async () => {
    const offenders = (await readScannableFiles())
      .filter(([file]) => file.startsWith("tests/unit/"))
      .filter(([, source]) => reachesTestDatabase(source))
      .map(([file]) => file);

    // Unit-lane tests run concurrently with the DB lane, so DB tests must live in serial tests/regression/db/
    // instead of sharing fixed-id fixtures.
    expect(offenders).toEqual([]);
  });

  it("requires process-wide mutations to be undone in an afterEach/afterAll hook", async () => {
    const offenders = (await readScannableFiles())
      .map(([file, source]) => [file, findUnrestoredMutations(source)] as const)
      .filter(([, unrestored]) => unrestored.length > 0)
      .map(([file, unrestored]) => `${file} -> ${unrestored.join(", ")}`);

    // Process-wide mutations persist across batched files, so any unrestored one silently breaks sibling tests
    // unless undone in afterEach/afterAll.
    expect(offenders).toEqual([]);
  });
});

describe("testIsolation detectors", () => {
  // Assemble markers from fragments so this file contains no literal occurrence for the test-source scanners
  // above to flag.
  const MOCK_CALL = `mock${"."}module("@/x", () => ({}))`;
  const SCOPED_MOCK_CALL = `createScopedModuleMocker(mock, { "@/x": realX })`;
  const DB_IMPORT = `import { testSql } from "./setup${"/"}testDb"`;

  it("detects module mocks", () => {
    expect(usesModuleMocks(MOCK_CALL)).toBe(true);
    expect(usesModuleMocks(SCOPED_MOCK_CALL)).toBe(true);
    expect(usesModuleMocks("const spy = spyOn(obj, 'method');")).toBe(false);
  });

  it("ignores module-mock markers in comments", () => {
    expect(usesModuleMocks(`/** ${MOCK_CALL} */\nconst value = 1;`)).toBe(false);
    expect(usesModuleMocks(`// ${SCOPED_MOCK_CALL}\nconst value = 1;`)).toBe(false);
  });

  it("detects reachability of the fixture database", () => {
    expect(reachesTestDatabase(DB_IMPORT)).toBe(true);
    expect(reachesTestDatabase(`import { resolveTls } from "@/utils/db/client"`)).toBe(false);
  });

  it("finds assignments but ignores comparisons", () => {
    expect(findProcessWideMutations("globalThis.fetch = stub;")).toEqual(["globalThis.fetch"]);
    expect(findProcessWideMutations("if (globalThis.fetch === original) return;")).toEqual([]);
    expect(findProcessWideMutations('const ttl = process.env.TTL || "10";')).toEqual([]);
  });

  it("finds the fake clock", () => {
    expect(findProcessWideMutations("setSystemTime(new Date(0));")).toEqual(["setSystemTime"]);
  });

  it("treats a mutation restored in a hook as clean", () => {
    const source = `
      const originalFetch = globalThis.fetch;
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });
      it("works", () => { globalThis.fetch = stub; });
    `;
    expect(findUnrestoredMutations(source)).toEqual([]);
  });

  it("flags a mutation with no restore hook at all", () => {
    const source = `it("leaks", () => { globalThis.fetch = stub; });`;
    expect(findUnrestoredMutations(source)).toEqual(["globalThis.fetch"]);
  });

  it("flags a mutation whose restore hook undoes something else", () => {
    const source = `
      afterEach(() => { clearCache(); });
      it("leaks", () => { globalThis.fetch = stub; });
    `;
    expect(findUnrestoredMutations(source)).toEqual(["globalThis.fetch"]);
  });

  it("flags a bracket-form env write with no restore", () => {
    expect(findUnrestoredMutations(`it("leaks", () => { process.env[RUN_ENV_NAME] = "production"; });`)).toEqual([
      "process.env[RUN_ENV_NAME]",
    ]);
    expect(findProcessWideMutations(`process.env["RUN_ENV"] = "production";`)).toEqual(["process.env.RUN_ENV"]);
  });

  it("flags env deletes and Object.assign onto process.env with no restore", () => {
    expect(findUnrestoredMutations(`it("leaks", () => { delete process.env.RUN_ENV; });`)).toEqual([
      "process.env.RUN_ENV",
    ]);
    expect(findUnrestoredMutations(`it("leaks", () => { delete process.env[name]; });`)).toEqual(["process.env[name]"]);
    expect(findUnrestoredMutations(`it("leaks", () => { Object.assign(process.env, secrets); });`)).toEqual([
      "Object.assign(process.env",
    ]);
  });

  it("treats a full env sandbox as a restore for every env mutation but nothing else", () => {
    const source = `useFullEnvSandbox();\nObject.assign(process.env, secrets);\ndelete process.env.RUN_ENV;\nglobalThis.fetch = stub;`;
    expect(findUnrestoredMutations(source)).toEqual(["globalThis.fetch"]);
  });

  it("treats an env sandbox as a restore only for the names it lists", () => {
    const sandbox = `useEnvSandbox(["RUN_ENV"]);\n`;
    expect(findUnrestoredMutations(`${sandbox}process.env.RUN_ENV = "production";`)).toEqual([]);
    expect(findUnrestoredMutations(`${sandbox}process.env[RUN_ENV_NAME] = "production";`)).toEqual([]);
    expect(findUnrestoredMutations(`${sandbox}process.env.LOG_LEVEL = "debug";`)).toEqual(["process.env.LOG_LEVEL"]);
    expect(findUnrestoredMutations(`// useEnvSandbox(["LOG_LEVEL"])\nprocess.env.LOG_LEVEL = "debug";`)).toEqual([
      "process.env.LOG_LEVEL",
    ]);
  });

  it("exempts files that already run in their own process", () => {
    // Mock users run in private processes, so module-scope mutations like toolLoop.test.ts's process.env
    // writes cannot reach sibling files.
    const source = `${MOCK_CALL}\nprocess.env.BOT_MAX_ITERATIONS = "10";`;
    expect(findUnrestoredMutations(source)).toEqual([]);
  });
});
