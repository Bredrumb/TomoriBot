import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const deployScriptPath = path.join(import.meta.dir, "..", "..", "..", "deploy", "azure", "run-command-deploy.sh");
const migrationScriptPath = path.join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "deploy",
  "azure",
  "check-pending-migrations.sh",
);

const gitPath = Bun.which("git");
// Git for Windows puts git.exe in cmd\ or mingw64\bin\; a PATH lookup could find WSL's bash, which rejects /c/ paths.
const bash =
  process.platform === "win32" && gitPath
    ? ([
        path.resolve(path.dirname(gitPath), "..", "bin", "bash.exe"),
        path.resolve(path.dirname(gitPath), "..", "..", "bin", "bash.exe"),
      ].find((candidate) => existsSync(candidate)) ?? "bash.exe")
    : "bash";
const bashFile = (filePath: string) =>
  process.platform === "win32"
    ? filePath.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : filePath;

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "migration preflight rejects missing recovery authorization and preserves initial bootstrap and lookup failures",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-migration-preflight-"));
    try {
      await mkdir(path.join(directory, "scripts", "checks"), { recursive: true });
      await mkdir(path.join(directory, "src", "db", "migrations"), { recursive: true });
      await copyFile(
        path.join(import.meta.dir, "..", "..", "..", "scripts", "checks", "checkPendingMigrations.ts"),
        path.join(directory, "scripts", "checks", "checkPendingMigrations.ts"),
      );
      await writeFile(
        path.join(directory, "src", "reader.ts"),
        'export const query = "SELECT profile_note FROM users";\n',
      );
      const git = async (args: string[]) => {
        const proc = Bun.spawn(["git", ...args], {
          cwd: directory,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Mirri",
            GIT_AUTHOR_EMAIL: "mirri@example.invalid",
            GIT_COMMITTER_NAME: "Mirri",
            GIT_COMMITTER_EMAIL: "mirri@example.invalid",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, , exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect(exitCode).toBe(0);
        return stdout.trim();
      };
      await git(["init", "-q"]);
      await git(["add", "."]);
      await git(["commit", "-qm", "deployed"]);
      const deployedRef = await git(["rev-parse", "HEAD"]);
      await writeFile(
        path.join(directory, "src", "db", "migrations", "001_change.sql"),
        "ALTER TABLE users DROP COLUMN profile_note;\n",
      );
      await git(["add", "."]);
      await git(["commit", "-qm", "pending migration"]);
      const outputPath = path.join(directory, "outputs");
      const cases = [
        { server: "existing", ref: deployedRef, recovery: "false", exitCode: 1, initial: false, downtime: true },
        { server: "existing", ref: deployedRef, recovery: "true", exitCode: 0, initial: false, downtime: true },
        { server: "existing", ref: "", recovery: "false", exitCode: 1, initial: false, downtime: true },
        { server: "existing", ref: "", recovery: "true", exitCode: 0, initial: false, downtime: true },
        { server: "missing", ref: deployedRef, recovery: "false", exitCode: 0, initial: true, downtime: false },
        { server: "unavailable", ref: deployedRef, recovery: "true", exitCode: 4, initial: null, downtime: false },
      ];
      for (const entry of cases) {
        await writeFile(outputPath, "");
        const wrapper = `
          az() {
            case "$PREFLIGHT_SERVER" in
              existing) echo fixture-server ;;
              missing) echo ResourceNotFound >&2; return 3 ;;
              unavailable) echo AuthorizationFailed >&2; return 4 ;;
            esac
          }
          gh() { printf '%s\\n' "$PREFLIGHT_DEPLOYED_REF"; }
          source "$PREFLIGHT_SCRIPT"
        `;
        const proc = Bun.spawn([bash, "-c", wrapper], {
          cwd: directory,
          env: {
            ...process.env,
            PREFLIGHT_SERVER: entry.server,
            PREFLIGHT_DEPLOYED_REF: entry.ref,
            PREFLIGHT_SCRIPT: bashFile(migrationScriptPath),
            RECOVERY_POINT_OPT_IN: entry.recovery,
            GITHUB_OUTPUT: outputPath.replaceAll("\\", "/"),
            GITHUB_REPOSITORY: "example/tomoribot",
            GITHUB_REF_NAME: "release",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, , exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect({ ...entry, actualExitCode: exitCode }).toEqual({ ...entry, actualExitCode: entry.exitCode });
        const outputs = await readFile(outputPath, "utf8");
        expect(outputs.includes("is_initial_bootstrap=true")).toBe(entry.initial === true);
        expect(outputs.includes("is_initial_bootstrap=false")).toBe(entry.initial === false);
        expect(outputs.includes("downtime_required=true")).toBe(entry.downtime);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "deploy verification uses a fresh window only when Compose reuses the running container",
  async () => {
    const script = (await readFile(deployScriptPath, "utf8")).replaceAll("\r\n", "\n");
    const start = script.indexOf("previous_container_id=$(");
    const end = script.indexOf('if ! docker exec "$container_id" bun -e', start);
    if (start < 0 || end < 0) throw new Error("Container identity block was not found");
    const wrapper = `
      set -euo pipefail
      previous_id=${"a".repeat(64)}
      current_id="$previous_id"
      if [ "$CHECK_MODE" = replaced ]; then current_id=${"b".repeat(64)}; fi
      compose_env=()
      compose_services=(tomoribot)
      tomoribotImage=test-image
      env() { "$@"; }
      date() { echo fresh-window; }
      docker() {
        case "$1" in
          ps)
            if [[ "$*" == *--no-trunc* ]]; then echo "$previous_id"; else printf '%.12s\\n' "$previous_id"; fi
            ;;
          compose)
            if [ "$4" = ps ]; then echo "$current_id"; fi
            ;;
          inspect)
            case "$*" in
              *State.StartedAt*) echo container-start ;;
              *RestartCount*) echo 0 ;;
              *Config.User*) echo 1001:1001 ;;
              *Image*) echo image-id ;;
            esac
            ;;
          image) echo image-id ;;
          exec) echo 1001 ;;
        esac
      }
      ${script.slice(start, end)}
      printf '%s' "$verification_since"
    `;
    for (const mode of ["reused", "replaced"]) {
      const proc = Bun.spawn([bash, "-c", wrapper], {
        env: { ...process.env, CHECK_MODE: mode },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect({ mode, exitCode, stderr }).toEqual({ mode, exitCode: 0, stderr: "" });
      expect(stdout).toBe(mode === "reused" ? "fresh-window" : "container-start");
    }
  },
);

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "Burstable recovery point requires a usable restore window",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-recovery-point-"));
    try {
      const script = await readFile(path.join(path.dirname(deployScriptPath), "prepare-recovery-point.sh"), "utf8");
      const scriptPath = path.join(directory, "checkpoint.sh");
      const fixturePath = path.join(directory, "server.json");
      const summaryPath = path.join(directory, "summary.md");
      await writeFile(scriptPath, script);

      const run = async (server: {
        state: string;
        backup: { backupRetentionDays: number; earliestRestoreDate: string };
      }) => {
        await writeFile(fixturePath, JSON.stringify({ sku: { tier: "Burstable" }, ...server }));
        await writeFile(summaryPath, "");
        const proc = Bun.spawn([bash, "-c", 'az() { cat "$CHECKPOINT_FIXTURE"; }; source "$CHECKPOINT_SCRIPT"'], {
          env: {
            ...process.env,
            CHECKPOINT_FIXTURE: bashFile(fixturePath),
            CHECKPOINT_SCRIPT: bashFile(scriptPath),
            GITHUB_STEP_SUMMARY: bashFile(summaryPath),
            GITHUB_RUN_ID: "123",
            GITHUB_RUN_ATTEMPT: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { exitCode, output: `${stdout}\n${stderr}`, summary: await readFile(summaryPath, "utf8") };
      };

      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const valid = await run({ state: "Ready", backup: { backupRetentionDays: 7, earliestRestoreDate: yesterday } });
      expect(valid.exitCode).toBe(0);
      expect(valid.summary).toContain(
        "az postgres flexible-server restore --resource-group tomoribot-rg --name tomoribot-pitr-123-1",
      );
      expect(valid.summary).toContain("--restore-time '");

      const stopped = await run({
        state: "Stopped",
        backup: { backupRetentionDays: 7, earliestRestoreDate: yesterday },
      });
      expect(stopped.exitCode).toBe(1);
      expect(stopped.summary).toBe("");

      const expired = await run({ state: "Ready", backup: { backupRetentionDays: 7, earliestRestoreDate: tomorrow } });
      expect(expired.exitCode).toBe(1);
      expect(expired.output).toContain("earliest restore point is later");

      const disabled = await run({
        state: "Ready",
        backup: { backupRetentionDays: 0, earliestRestoreDate: yesterday },
      });
      expect(disabled.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32" && !existsSync(bash))(
  "deploy verification fails on repository errors and post-start error storms without printing records",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-deploy-verify-"));
    try {
      const deployScript = await readFile(deployScriptPath, "utf8");
      const start = deployScript.indexOf("# Exercise the repository queries");
      const end = deployScript.indexOf("assert_file() {", start);
      if (start < 0 || end < 0) throw new Error("Deploy verification block was not found");
      const checkPath = path.join(directory, "verify.sh");
      await writeFile(checkPath, deployScript.slice(start, end).replaceAll("\r\n", "\n"));

      const run = async (mode: string) => {
        const wrapper = `
          set -euo pipefail
          container_id=test-container
          stage_dir="$CHECK_TEMP"
          started_at=$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%S.%NZ)
          verification_since="$started_at"
          restart_count=0
          docker() {
            case "$1" in
              exec)
                if [[ "$*" == *error_logs* ]]; then
                  case "$CHECK_MODE" in
                    db_error) echo 1 ;;
                    db_storm) echo 1000 ;;
                    *) echo 0 ;;
                  esac
                elif [ "$CHECK_MODE" = user_error ]; then
                  echo 'SMOKE_FAILED:user_repository'
                  return 1
                elif [ "$CHECK_MODE" = endpoint_error ]; then
                  echo 'SMOKE_FAILED:custom_endpoint_repository'
                  return 1
                else
                  echo SMOKE_OK
                fi
                ;;
              inspect)
                case "$3" in
                  *State.Running*) echo true ;;
                  *State.StartedAt*) echo "$started_at" ;;
                  *RestartCount*) echo 0 ;;
                esac
                ;;
              logs)
                case "$CHECK_MODE" in
                  container_error) echo '{"level":50,"msg":"private user data"}' ;;
                  container_storm) for _ in $(seq 1000); do echo '{"level":50,"msg":"private user data"}'; done ;;
                esac
                ;;
            esac
          }
          curl() { return 0; }
          source "$CHECK_SCRIPT"
        `;
        const proc = Bun.spawn([bash, "-c", wrapper], {
          env: {
            ...process.env,
            CHECK_TEMP: bashFile(directory),
            CHECK_SCRIPT: bashFile(checkPath),
            CHECK_MODE: mode,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { exitCode, output: `${stdout}\n${stderr}` };
      };

      expect((await run("clean")).exitCode).toBe(0);
      const user = await run("user_error");
      expect(user.exitCode).toBe(1);
      expect(user.output).toContain("UserRepository smoke check failed.");
      const endpoint = await run("endpoint_error");
      expect(endpoint.exitCode).toBe(1);
      expect(endpoint.output).toContain("Custom endpoint repository smoke check failed.");
      expect((await run("db_error")).exitCode).toBe(0);
      expect((await run("container_error")).exitCode).toBe(0);
      const database = await run("db_storm");
      expect(database.exitCode).toBe(1);
      expect(database.output).toContain("Post-start error storm: 1000 error_logs row(s)");
      const container = await run("container_storm");
      expect(container.exitCode).toBe(1);
      expect(container.output).toContain("Post-start error storm: 1000 container error log(s)");
      expect(container.output).not.toContain("private user data");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
