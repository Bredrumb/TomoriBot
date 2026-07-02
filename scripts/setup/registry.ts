import { askSecret, confirm } from "../lib/prompt";
import { type PythonCommand } from "../lib/pyenv";
import { readEnvValues } from "../lib/envFile";
import { log } from "../lib/cliLogger";

export type SetupRunResult = "done" | "guided" | "skipped";

export interface SetupContext {
  projectRoot: string;
  envPath: string;
  hasPsql: boolean;
  python?: PythonCommand;
}

export interface SetupModule {
  id: string;
  label: string;
  run(ctx: SetupContext): Promise<SetupRunResult>;
}

const FULL_INSTALL_MODULE_IDS = ["pgvector", "pg-cron", "tokenizers", "mcp-fetch"];

function buildDatabaseUrl(env: Record<string, string>): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;

  const password = env.POSTGRES_PASSWORD;
  if (!password) return undefined;

  const host = env.POSTGRES_HOST || "localhost";
  const port = env.POSTGRES_PORT || "5432";
  const user = env.POSTGRES_USER || "postgres";
  const database = env.POSTGRES_DB ?? "tomodb";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function runCommand(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}`);
  }
}

async function psqlCommand(ctx: SetupContext, sql: string): Promise<boolean> {
  if (!ctx.hasPsql) return false;
  const env = readEnvValues(ctx.envPath);
  const databaseUrl = buildDatabaseUrl(env);
  if (!databaseUrl) return false;

  const proc = Bun.spawn(["psql", databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    cwd: ctx.projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.exited) === 0;
}

function printPgvectorInstallGuide(): void {
  log.info("If PostgreSQL says vector is unavailable, install pgvector first:");
  log.info("  Windows: use a PostgreSQL package/distribution that includes pgvector, or build pgvector for your version.");
  log.info("  macOS:   brew install pgvector");
  log.info("  Ubuntu:  sudo apt-get install postgresql-16-pgvector");
  log.info("Then re-run Full Install or restart TomoriBot.");
}

function printPgCronGuide(): void {
  log.info("For native PostgreSQL, pg_cron also needs postgresql.conf changes before CREATE EXTENSION can work:");
  log.info("  shared_preload_libraries = 'pg_cron'");
  log.info("  cron.database_name = 'tomodb'");
  log.info("Restart PostgreSQL, then run:");
  log.info("  CREATE EXTENSION IF NOT EXISTS pg_cron;");
  log.info("Docker Compose users already get pg_cron wiring from docker-compose.yaml.");
}

export const SETUP_MODULES: SetupModule[] = [
  {
    id: "pgvector",
    label: "pgvector",
    async run(ctx) {
      log.section("pgvector");
      const ok = await psqlCommand(ctx, "CREATE EXTENSION IF NOT EXISTS vector;");
      if (ok) {
        log.success("pgvector extension is enabled for this database.");
        return "done";
      }

      log.warn("Could not enable pgvector automatically.");
      log.info("SQL to run after pgvector is installed:");
      log.info("  CREATE EXTENSION IF NOT EXISTS vector;");
      printPgvectorInstallGuide();
      return "guided";
    },
  },
  {
    id: "pg-cron",
    label: "pg_cron",
    async run(ctx) {
      log.section("pg_cron");
      const ok = await psqlCommand(ctx, "CREATE EXTENSION IF NOT EXISTS pg_cron;");
      if (ok) {
        log.success("pg_cron extension is enabled.");
        log.info("TomoriBot will verify/schedule its cleanup job on startup.");
        return "done";
      }

      log.warn("Could not enable pg_cron automatically.");
      printPgCronGuide();
      return "guided";
    },
  },
  {
    id: "tokenizers",
    label: "Tokenizer assets",
    async run(ctx) {
      log.section("Tokenizer assets");
      const useToken = await confirm("Do you want to provide a temporary HuggingFace token for gated tokenizers?", false);
      const extraEnv: Record<string, string> = {};
      if (useToken) {
        extraEnv.HF_TOKEN = await askSecret("HF_TOKEN", {
          validate: (value) => (value.trim().length > 0 ? null : "HF_TOKEN cannot be blank."),
        });
      }
      await runCommand("bun", ["run", "setup:tokenizers"], ctx.projectRoot, extraEnv);
      return "done";
    },
  },
  {
    id: "mcp-fetch",
    label: "URL Fetch MCP package",
    async run(ctx) {
      log.section("URL Fetch MCP");
      const python = ctx.python;
      if (!python) {
        log.warn("Python 3 was not detected.");
        log.info("Install Python 3, then run:");
        log.info("  python -m pip install mcp-server-fetch");
        return "guided";
      }

      try {
        await runCommand(python.command, [...python.args, "-m", "pip", "install", "mcp-server-fetch"], ctx.projectRoot);
        return "done";
      } catch (error) {
        log.warn(`pip install failed: ${error instanceof Error ? error.message : String(error)}`);
        log.info("If Linux reports an externally managed environment, try:");
        log.info("  python -m pip install --break-system-packages mcp-server-fetch");
        return "guided";
      }
    },
  },
];

export function getFullInstallModules(): SetupModule[] {
  return FULL_INSTALL_MODULE_IDS.map((id) => {
    const module = SETUP_MODULES.find((candidate) => candidate.id === id);
    if (!module) {
      throw new Error(`Full Install module is missing: ${id}`);
    }
    return module;
  });
}
