import { spawn } from "bun";

const proc = spawn(["bunx", "--bun", "knip", "--config", "scripts/knip.json", ...process.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await proc.exited;
if (exitCode !== 0) {
  console.error(
    "Before removing an unused export, check its callers on release with `git grep <symbol> release -- src tests`. " +
      "If release uses it, keep the export and add a JSDoc @public tag naming its release caller.",
  );
}
process.exit(exitCode);
