import { existsSync } from "node:fs";
import { join } from "node:path";
import { askSecret, confirm } from "../lib/prompt";
import { type PythonCommand, installPythonServer } from "../lib/pyenv";
import { readEnvValues, upsertEnvKeys } from "../lib/envFile";
import { log } from "@/utils/misc/logger";

export type SetupCategory = "database" | "aitools" | "voice" | "web" | "monitoring" | "integration";
export type SetupStatus = "installed" | "missing" | "unknown";
export type SetupRunResult = "done" | "guided" | "skipped";

export interface SetupContext {
  projectRoot: string;
  envPath: string;
  hasDocker: boolean;
  hasPsql: boolean;
  python?: PythonCommand;
}

export interface SetupModule {
  id: string;
  label: string;
  category: SetupCategory;
  summary: string;
  docPath?: string;
  detect?(ctx: SetupContext): Promise<SetupStatus>;
  run(ctx: SetupContext): Promise<SetupRunResult>;
}

interface VoiceServer {
  id: string;
  label: string;
  serverDir: string;
  launchFlag: string;
  docPath: string;
}

const CATEGORY_LABELS: Record<SetupCategory, string> = {
  database: "Database",
  aitools: "AI tools",
  voice: "Voice",
  web: "Web sidecars",
  monitoring: "Monitoring",
  integration: "Integrations",
};

const VOICE_SERVERS: VoiceServer[] = [
  {
    id: "voice-chatterbox",
    label: "Chatterbox TTS",
    serverDir: "servers/tts/chatterbox",
    launchFlag: "--chatterbox",
    docPath: "docs/integrations/voice/tts/",
  },
  {
    id: "voice-qwen3tts",
    label: "Qwen3-TTS",
    serverDir: "servers/tts/qwen3tts",
    launchFlag: "--qwen3tts",
    docPath: "docs/integrations/voice/tts/",
  },
  {
    id: "voice-irodoritts",
    label: "IrodoriTTS",
    serverDir: "servers/tts/irodoritts",
    launchFlag: "--irodoritts",
    docPath: "docs/integrations/voice/tts/",
  },
  {
    id: "voice-whisperx",
    label: "WhisperX STT",
    serverDir: "servers/stt",
    launchFlag: "--whisperx",
    docPath: "docs/integrations/voice/stt/",
  },
];

function buildDatabaseUrl(env: Record<string, string>, databaseOverride?: string): string | undefined {
  if (env.DATABASE_URL && !databaseOverride) return env.DATABASE_URL;
  if (env.POSTGRES_URL && !databaseOverride) return env.POSTGRES_URL;

  const password = env.POSTGRES_PASSWORD;
  if (!password) return undefined;

  const host = env.POSTGRES_HOST || "localhost";
  const port = env.POSTGRES_PORT || "5432";
  const user = env.POSTGRES_USER || "postgres";
  const database = databaseOverride ?? env.POSTGRES_DB ?? "tomodb";

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
  log.info("Then re-run this module or restart TomoriBot.");
}

function printPgCronGuide(): void {
  log.info("For native PostgreSQL, pg_cron also needs postgresql.conf changes before CREATE EXTENSION can work:");
  log.info("  shared_preload_libraries = 'pg_cron'");
  log.info("  cron.database_name = 'tomodb'");
  log.info("Restart PostgreSQL, then run:");
  log.info("  CREATE EXTENSION IF NOT EXISTS pg_cron;");
  log.info("Docker Compose users already get pg_cron wiring from docker-compose.yaml.");
}

function printMatrixGuide(): void {
  log.info("Matrix bridge setup is guided because it needs homeserver-side appservice registration:");
  log.info("  1. Generate or choose MATRIX_ACCESS_TOKEN and MATRIX_HS_TOKEN.");
  log.info("  2. Add the appservice registration to your Matrix homeserver.");
  log.info("  3. Set MATRIX_HOMESERVER_URL, MATRIX_BOT_USER_ID, MATRIX_SERVER_NAME, and token vars in .env.");
  log.info("Full guide: docs/integrations/matrix/bridge.md");
}

function createVoiceModule(server: VoiceServer): SetupModule {
  return {
    id: server.id,
    label: server.label,
    category: "voice",
    summary: `Install the local Python environment for ${server.label}.`,
    docPath: server.docPath,
    async detect(ctx) {
      const pythonPath = join(ctx.projectRoot, server.serverDir, ".venv");
      return existsSync(pythonPath) ? "installed" : "missing";
    },
    async run(ctx) {
      const serverDir = join(ctx.projectRoot, server.serverDir);
      const result = await installPythonServer({
        serverDir,
        label: server.label,
        python: ctx.python,
      });
      log.success(`${server.label} ${result === "already-installed" ? "was already installed" : "environment installed"}.`);
      log.info(`Start it with: bun run launch ${server.launchFlag}`);
      log.info("Then register the endpoint in Discord with /provider custom-endpoint add.");
      return "done";
    },
  };
}

export const SETUP_MODULES: SetupModule[] = [
  {
    id: "pgvector",
    label: "pgvector",
    category: "database",
    summary: "Enable vector search support for document/RAG memory when pgvector is installed.",
    docPath: "docs/user-guides/safe-migration.md",
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
    category: "database",
    summary: "Try to enable optional scheduled cooldown cleanup support.",
    docPath: "docs/subsystems/cooldowns.md",
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
    category: "aitools",
    summary: "Download local tokenizer assets for model-aware logit bias.",
    docPath: "docs/subsystems/logit-bias.md",
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
    label: "MCP Fetch Python package",
    category: "aitools",
    summary: "Install mcp-server-fetch for the bundled fetch_url fallback.",
    docPath: "src/tools/mcpServers/fetch/docs.md",
    async run(ctx) {
      log.section("MCP Fetch");
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
  ...VOICE_SERVERS.map(createVoiceModule),
  {
    id: "web-searxng",
    label: "SearXNG sidecar",
    category: "web",
    summary: "Configure the local SearXNG search sidecar.",
    docPath: "docs/user-guides/setup-searxng.md",
    async run(ctx) {
      upsertEnvKeys(ctx.envPath, { SEARXNG_BASE_URL: "http://localhost:8080/" }, { overwrite: true });
      log.success("Set SEARXNG_BASE_URL=http://localhost:8080/ in .env.");
      log.info("Start it with: bun run launch --searxng");
      log.info("Guide: docs/user-guides/setup-searxng.md");
      return "guided";
    },
  },
  {
    id: "web-crawl4ai",
    label: "Crawl4AI sidecar",
    category: "web",
    summary: "Configure the local Crawl4AI browser-rendered fetch sidecar.",
    docPath: "docs/user-guides/setup-crawl4ai.md",
    async run(ctx) {
      upsertEnvKeys(ctx.envPath, { CRAWL4AI_BASE_URL: "http://localhost:11235/" }, { overwrite: true });
      log.success("Set CRAWL4AI_BASE_URL=http://localhost:11235/ in .env.");
      log.info("Start it with: bun run launch --crawl4ai");
      log.info("Guide: docs/user-guides/setup-crawl4ai.md");
      return "guided";
    },
  },
  {
    id: "monitoring-grafana",
    label: "Local Grafana monitoring",
    category: "monitoring",
    summary: "Set a Grafana admin password and print the compose startup command.",
    docPath: "docs/user-guides/local-monitoring.md",
    async run(ctx) {
      const password = await askSecret("Grafana admin password", {
        default: "admin",
        validate: (value) => (value.trim().length > 0 ? null : "Password cannot be blank."),
      });
      upsertEnvKeys(ctx.envPath, { GRAFANA_PASSWORD: password }, { overwrite: true });
      log.success("Updated GRAFANA_PASSWORD in .env.");
      log.info("Start monitoring with:");
      log.info("  docker compose -f docker-compose.yaml -f docker-compose.monitor.yaml up -d");
      log.info("Guide: docs/user-guides/local-monitoring.md");
      return "guided";
    },
  },
  {
    id: "matrix-bridge",
    label: "Matrix bridge",
    category: "integration",
    summary: "Print the Matrix appservice setup checklist.",
    docPath: "docs/integrations/matrix/bridge.md",
    async run() {
      printMatrixGuide();
      return "guided";
    },
  },
];

export function getSetupCategories(): SetupCategory[] {
  return [...new Set(SETUP_MODULES.map((module) => module.category))];
}

export function getCategoryLabel(category: SetupCategory): string {
  return CATEGORY_LABELS[category];
}

export function getModulesByCategory(category: SetupCategory): SetupModule[] {
  return SETUP_MODULES.filter((module) => module.category === category);
}
