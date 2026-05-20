/**
 * Runs `bun audit --audit-level=high` and exits non-zero only if high or
 * critical vulnerabilities are found. Low and moderate advisories are reported
 * but do not block the pipeline.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

async function runBunAudit(): Promise<{ output: string; exitCode: number }> {
  if (process.platform === "win32") {
    const tempDir = join(process.cwd(), ".temp");
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const outputPath = join(tempDir, `bun-audit-${process.pid}.txt`);
    const command = `${process.execPath} audit --audit-level=high > ${outputPath} 2>&1`;
    const proc = Bun.spawn(["cmd.exe", "/d", "/s", "/c", command], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    const output = readFileSync(outputPath, "utf-8");
    rmSync(outputPath, { force: true });
    return { output, exitCode };
  }

  const proc = Bun.spawn([process.execPath, "audit", "--audit-level=high"], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: stdout + stderr, exitCode };
}

const { output, exitCode } = await runBunAudit();
process.stdout.write(output);
process.exit(exitCode);
