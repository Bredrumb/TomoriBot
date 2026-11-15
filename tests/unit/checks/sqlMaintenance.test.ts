import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("SQL maintenance preview binds execution to a committed file, matching hash, image, and recovery request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-sql-request-"));
  try {
    const root = path.resolve(import.meta.dir, "..", "..", "..");
    await mkdir(path.join(directory, "deploy/azure/maintenance"), { recursive: true });
    await mkdir(path.join(directory, "src/utils/db"), { recursive: true });
    await copyFile(
      path.join(root, "deploy/azure/sql-maintenance.ts"),
      path.join(directory, "deploy/azure/sql-maintenance.ts"),
    );
    await copyFile(path.join(root, "src/utils/db/sqlSplitter.ts"), path.join(directory, "src/utils/db/sqlSplitter.ts"));
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    const file = "deploy/azure/maintenance/sample.sql";
    const source = "SELECT 'synthetic-private-content';";
    await writeFile(path.join(directory, file), source);
    for (const args of [
      ["init", "-q"],
      ["add", "."],
      ["-c", "user.name=Mirri", "-c", "user.email=mirri@example.invalid", "commit", "-qm", "operation"],
    ]) {
      const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "ignore", stderr: "ignore" });
      expect(await proc.exited).toBe(0);
    }
    const sha = createHash("sha256").update(source).digest("hex");
    const output = path.join(directory, "outputs");
    const run = async (overrides: Record<string, string>) => {
      await writeFile(output, "");
      const proc = Bun.spawn(["bun", "run", "deploy/azure/sql-maintenance.ts", "prepare"], {
        cwd: directory,
        env: {
          ...process.env,
          SQL_PATH: file,
          SQL_MODE: "preview",
          SQL_SHA256: sha,
          GITHUB_SHA: "c".repeat(40),
          MAINTENANCE_COMMIT: "c".repeat(40),
          EXPECTED_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
          CREATE_DB_BACKUP: "true",
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: "",
          ...overrides,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(stdout + stderr).not.toContain("synthetic-private-content");
      return { code, outputs: await readFile(output, "utf8") };
    };
    const preview = await run({});
    expect(preview.code).toBe(0);
    expect(preview.outputs).toContain(`sql_sha256=${sha}`);
    const invalidRequests: Array<Record<string, string>> = [
      { SQL_MODE: "execute", SQL_SHA256: "b".repeat(64) },
      { SQL_MODE: "execute", MAINTENANCE_COMMIT: "d".repeat(40) },
      { SQL_MODE: "execute", CREATE_DB_BACKUP: "false" },
      { SQL_MODE: "execute", EXPECTED_IMAGE_DIGEST: "latest" },
      { SQL_PATH: "../../package.json" },
      { SQL_MODE: "unknown" },
    ];
    for (const overrides of invalidRequests) {
      expect((await run(overrides)).code).toBe(1);
    }
    expect((await run({ SQL_MODE: "execute" })).code).toBe(0);
    await writeFile(path.join(directory, file), "x".repeat(65 * 1024));
    expect((await run({})).code).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
