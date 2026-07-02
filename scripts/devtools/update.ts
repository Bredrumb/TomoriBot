#!/usr/bin/env bun
import { config } from "dotenv";
import pc from "picocolors";
import { confirm, isNonInteractiveMode } from "../lib/prompt";
import { log } from "@/utils/misc/logger";

config({ quiet: true });

interface RunOptions {
  allowFailure?: boolean;
}

const ROOT = process.cwd();

function printHelp(): void {
  console.log(`
${pc.bold("bun run update")} - backup-first TomoriBot updater

${pc.bold("Usage:")}
  bun run update                  Backup, git pull, bun install
  bun run update --build          Also run bun run build after install
  bun run update --docker         Backup, git pull, docker compose build, docker compose up -d
  bun run update --skip-backup    Skip the manual backup step
  bun run update --yes            Do not prompt before starting

${pc.bold("Notes:")}
  Stop TomoriBot before updating so the backup and migrations have a quiet database.
  This command uses: git pull --rebase --autostash
`);
}

async function run(command: string, args: string[], options: RunOptions = {}): Promise<boolean> {
  const proc = Bun.spawn([command, ...args], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode === 0) {
    return true;
  }

  const rendered = `${command} ${args.join(" ")}`;
  if (options.allowFailure) {
    log.warn(`${rendered} exited with code ${exitCode}.`);
    return false;
  }
  throw new Error(`${rendered} exited with code ${exitCode}.`);
}

async function ensureGitRepository(): Promise<void> {
  const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (exitCode !== 0 || stdout.trim() !== "true") {
    throw new Error("This directory is not a Git worktree.");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args);

  if (flags.has("--help") || flags.has("-h")) {
    printHelp();
    return;
  }

  const skipBackup = flags.has("--skip-backup");
  const build = flags.has("--build");
  const docker = flags.has("--docker");

  log.section("TomoriBot Update");
  log.info("Stop the running bot before continuing. This avoids writes during backup/update.");
  log.info("Update command: git pull --rebase --autostash");

  if (!isNonInteractiveMode() && !(await confirm("Continue with update?", true))) {
    log.info("Update cancelled.");
    return;
  }

  await ensureGitRepository();

  if (skipBackup) {
    log.warn("Skipping backup because --skip-backup was provided.");
  } else {
    log.section("Backup");
    try {
      await run("bun", ["run", "backup"]);
    } catch (error) {
      log.error("Backup failed. Update aborted before changing code.", error);
      log.info("Fix the backup issue, or re-run with --skip-backup if you accept the risk.");
      process.exit(1);
    }
  }

  log.section("Pull latest code");
  await run("git", ["pull", "--rebase", "--autostash"]);

  if (docker) {
    log.section("Docker Compose update");
    await run("docker", ["compose", "build"]);
    await run("docker", ["compose", "up", "-d"]);
  } else {
    log.section("Install dependencies");
    await run("bun", ["install"]);

    if (build) {
      log.section("Build");
      await run("bun", ["run", "build"]);
    }
  }

  log.section("Update Complete");
  if (docker) {
    log.info("Docker Compose is running with the updated image.");
  } else {
    log.info("Restart TomoriBot with `bun run dev`, `bun run launch`, or your process manager.");
  }
}

main().catch((error) => {
  log.error("Update failed:", error);
  process.exit(1);
});
