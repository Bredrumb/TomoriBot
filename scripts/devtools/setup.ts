#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { config } from "dotenv";
import { isPlaceholder, readEnvValues, seedFromExample, upsertEnvKeys } from "../lib/envFile";
import { ask, askSecret, confirm, isNonInteractiveMode, multiSelectMenu, selectMenu } from "../lib/prompt";
import { detectPython, type PythonCommand } from "../lib/pyenv";
import {
  SETUP_MODULES,
  type SetupCategory,
  type SetupContext,
  getCategoryLabel,
  getModulesByCategory,
  getSetupCategories,
} from "../setup/registry";
import { log } from "@/utils/misc/logger";

config({ quiet: true });

interface CommandProbe {
  available: boolean;
  output?: string;
}

interface PrereqScan {
  hasNode: boolean;
  nodeMajor?: number;
  hasPsql: boolean;
  hasDocker: boolean;
  python?: PythonCommand;
}

interface DatabaseConfigResult {
  values: Record<string, string>;
  startDockerDatabase: boolean;
}

interface PostgresConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

type EnvConfigureMode = "fill" | "reconfigure" | "keep";

const ROOT = process.cwd();
const ENV_PATH = join(ROOT, ".env");
const ENV_EXAMPLE_PATH = join(ROOT, ".env.example");
function printHelp(): void {
  console.log(`
${pc.bold("bun run setup")} - interactive TomoriBot setup wizard

${pc.bold("Usage:")}
  bun run setup              Open the interactive setup menu
  bun run setup --base       Run Base Install only
  bun run setup --module id  Run a single optional setup module
  bun run setup --defaults   Accept safe defaults for Base Install; fails when required values have no default

${pc.bold("Examples:")}
  bun run setup
  bun run setup --base
  bun run setup --defaults
  bun run setup --module tokenizers
`);
}

async function commandProbe(command: string, args: string[]): Promise<CommandProbe> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const output = `${stdout}${stderr}`.trim();
    return {
      available: exitCode === 0,
      output,
    };
  } catch {
    return { available: false };
  }
}

async function runInherited(command: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}`);
  }
}

function parseNodeMajor(output: string | undefined): number | undefined {
  const match = output?.match(/v?(\d+)\./);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

async function scanPrereqs(): Promise<PrereqScan> {
  log.section("Prerequisite scan");

  const [nodeProbe, psqlProbe, dockerProbe, python] = await Promise.all([
    commandProbe("node", ["--version"]),
    commandProbe("psql", ["--version"]),
    commandProbe("docker", ["--version"]),
    detectPython(),
  ]);

  const nodeMajor = parseNodeMajor(nodeProbe.output);
  if (nodeProbe.available && nodeMajor && nodeMajor >= 20) {
    log.success(`Node.js ${nodeProbe.output ?? ""}`.trim());
  } else if (nodeProbe.available) {
    log.warn(`Node.js ${nodeProbe.output ?? ""} detected, but v20+ is recommended for MCP tooling.`);
  } else {
    log.warn("Node.js was not found. Install Node.js v20+ for MCP tooling.");
  }

  if (psqlProbe.available) {
    log.success(`psql ${psqlProbe.output ?? ""}`.trim());
  } else {
    log.warn("psql was not found. Database auto-provisioning and backups need PostgreSQL client tools.");
  }

  if (dockerProbe.available) {
    log.success(`Docker ${dockerProbe.output ?? ""}`.trim());
  } else {
    log.warn("Docker was not found. Docker database/sidecar setup will be guided only.");
  }

  if (python) {
    log.success(`Python detected: ${python.displayName}`);
  } else {
    log.warn("Python 3 was not found. Python-based MCP/voice modules will be guided only.");
  }

  return {
    hasNode: nodeProbe.available,
    nodeMajor,
    hasPsql: psqlProbe.available,
    hasDocker: dockerProbe.available,
    python,
  };
}

function buildContext(scan: PrereqScan): SetupContext {
  return {
    projectRoot: ROOT,
    envPath: ENV_PATH,
    hasDocker: scan.hasDocker,
    hasPsql: scan.hasPsql,
    python: scan.python,
  };
}

function generateSecret(length = 32): string {
  return randomBytes(Math.ceil((length * 3) / 4)).toString("base64url").slice(0, length);
}

function validateNonPlaceholder(label: string): (value: string) => string | null {
  return (value) => {
    if (isPlaceholder(value)) {
      return `${label} cannot be blank or left as a placeholder.`;
    }
    return null;
  };
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPostgresUrl(connection: PostgresConnection): string {
  const user = encodeURIComponent(connection.user);
  const auth =
    connection.password.trim().length > 0 ? `${user}:${encodeURIComponent(connection.password)}` : user;
  return `postgresql://${auth}@${connection.host}:${connection.port}/${connection.database}`;
}

function buildProvisioningSql(appUser: string, appPassword: string, appDatabase: string): {
  roleSql: string;
  databaseExistsSql: string;
  createDatabaseSql: string;
} {
  return {
    roleSql: [
      "DO $tomori_setup$",
      "BEGIN",
      `  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${quoteSqlLiteral(appUser)}) THEN`,
      `    CREATE ROLE ${quoteSqlIdentifier(appUser)} WITH LOGIN SUPERUSER PASSWORD ${quoteSqlLiteral(appPassword)};`,
      "  ELSE",
      `    ALTER ROLE ${quoteSqlIdentifier(appUser)} WITH LOGIN SUPERUSER PASSWORD ${quoteSqlLiteral(appPassword)};`,
      "  END IF;",
      "END",
      "$tomori_setup$;",
    ].join("\n"),
    databaseExistsSql: `SELECT 1 FROM pg_database WHERE datname = ${quoteSqlLiteral(appDatabase)};`,
    createDatabaseSql: `CREATE DATABASE ${quoteSqlIdentifier(appDatabase)} OWNER ${quoteSqlIdentifier(appUser)};`,
  };
}

async function runPsql(connection: PostgresConnection, sql: string, stdout: "inherit" | "pipe" = "inherit"): Promise<{
  exitCode: number;
  output: string;
}> {
  const outputArgs = stdout === "pipe" ? ["-t", "-A"] : [];
  const proc = Bun.spawn(["psql", buildPostgresUrl(connection), "-v", "ON_ERROR_STOP=1", ...outputArgs, "-c", sql], {
    cwd: ROOT,
    stdout,
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  const output = stdout === "pipe" ? await new Response(proc.stdout).text() : "";
  return { exitCode, output };
}

async function provisionNativeDatabase(app: PostgresConnection, hasPsql: boolean): Promise<void> {
  const sql = buildProvisioningSql(app.user, app.password, app.database);

  if (!hasPsql) {
    log.warn("psql is missing, so automatic database provisioning is not available.");
    log.info("Run this SQL as a local PostgreSQL admin:");
    log.info(sql.roleSql);
    log.info(sql.createDatabaseSql);
    return;
  }

  const shouldProvision = await confirm(
    "Create/update the local PostgreSQL app user as SUPERUSER and create the database automatically?",
    true,
  );
  if (!shouldProvision) {
    log.info("Run this SQL as a local PostgreSQL admin:");
    log.info(sql.roleSql);
    log.info(sql.createDatabaseSql);
    return;
  }

  log.info("This is intended for local/dev self-hosting. Do not use a superuser app role on shared production DBs.");
  const adminUser = await ask("PostgreSQL admin user", {
    default: "postgres",
    validate: validateNonPlaceholder("Admin user"),
  });
  const adminPassword = await askSecret("PostgreSQL admin password (blank is OK for trust auth)", {
    default: "",
  });
  const maintenanceDb = await ask("Maintenance database", {
    default: "postgres",
    validate: validateNonPlaceholder("Maintenance database"),
  });

  const adminConnection: PostgresConnection = {
    host: app.host,
    port: app.port,
    user: adminUser,
    password: adminPassword,
    database: maintenanceDb,
  };

  const roleResult = await runPsql(adminConnection, sql.roleSql);
  if (roleResult.exitCode !== 0) {
    log.warn("Could not create/update the PostgreSQL user automatically.");
    log.info("Run this SQL as a local PostgreSQL admin:");
    log.info(sql.roleSql);
    log.info(sql.createDatabaseSql);
    return;
  }

  const existsResult = await runPsql(adminConnection, sql.databaseExistsSql, "pipe");
  if (existsResult.exitCode !== 0) {
    log.warn("Could not check whether the database already exists.");
    log.info("Run this SQL as a local PostgreSQL admin if needed:");
    log.info(sql.createDatabaseSql);
    return;
  }

  if (existsResult.output.trim() === "1") {
    log.success(`Database "${app.database}" already exists.`);
    return;
  }

  const dbResult = await runPsql(adminConnection, sql.createDatabaseSql);
  if (dbResult.exitCode === 0) {
    log.success(`Database "${app.database}" created.`);
    return;
  }

  log.warn("Could not create the database automatically.");
  log.info("Run this SQL as a local PostgreSQL admin:");
  log.info(sql.createDatabaseSql);
}

async function chooseEnvMode(envAlreadyExisted: boolean): Promise<EnvConfigureMode> {
  if (!envAlreadyExisted) {
    return "fill";
  }

  const selected = await selectMenu<EnvConfigureMode>("Existing .env found", [
    {
      id: "fill",
      label: "Fill missing required values",
      description: "Keep real values and replace blanks/placeholders.",
    },
    {
      id: "reconfigure",
      label: "Reconfigure required values",
      description: "Prompt for Discord token and database settings again.",
    },
    {
      id: "keep",
      label: "Keep .env as-is",
      description: "Skip required value prompts.",
    },
  ]);

  return selected.id;
}

async function configureDiscordToken(env: Record<string, string>, mode: EnvConfigureMode): Promise<Record<string, string>> {
  if (mode === "keep" || (mode === "fill" && !isPlaceholder(env.DISCORD_TOKEN))) {
    return {};
  }

  log.info("Create/copy your bot token from https://discord.com/developers/applications");
  log.info("Enable these Privileged Gateway Intents for the bot: GuildMembers, MessageContent, GuildPresences.");
  const token = await askSecret("Discord bot token", {
    default: isPlaceholder(env.DISCORD_TOKEN) ? undefined : env.DISCORD_TOKEN,
    validate: (value) => {
      if (isPlaceholder(value)) return "Discord token cannot be blank or left as a placeholder.";
      if (value.trim().length < 30) return "Discord token looks too short.";
      return null;
    },
  });

  return { DISCORD_TOKEN: token.trim() };
}

async function configureCryptoSecret(env: Record<string, string>, mode: EnvConfigureMode): Promise<Record<string, string>> {
  if (isPlaceholder(env.CRYPTO_SECRET)) {
    const secret = generateSecret();
    log.success("Generated a 32-character CRYPTO_SECRET.");
    return { CRYPTO_SECRET: secret };
  }

  if (mode !== "reconfigure") {
    return {};
  }

  const rotate = await confirm(
    "Generate a new CRYPTO_SECRET? Existing encrypted API keys need the old secret to decrypt.",
    false,
  );
  if (!rotate) {
    log.info("Keeping existing CRYPTO_SECRET.");
    return {};
  }

  const secret = generateSecret();
  log.success("Generated a new 32-character CRYPTO_SECRET.");
  return { CRYPTO_SECRET: secret };
}

function needsDatabaseConfig(env: Record<string, string>, mode: EnvConfigureMode): boolean {
  if (mode === "keep") return false;
  if (mode === "reconfigure") return true;
  return ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"].some((key) =>
    isPlaceholder(env[key]),
  );
}

async function configureNativeDatabase(env: Record<string, string>, scan: PrereqScan): Promise<DatabaseConfigResult> {
  const host = await ask("PostgreSQL host", {
    default: isPlaceholder(env.POSTGRES_HOST) ? "localhost" : env.POSTGRES_HOST,
    validate: validateNonPlaceholder("PostgreSQL host"),
  });
  const port = await ask("PostgreSQL port", {
    default: isPlaceholder(env.POSTGRES_PORT) ? "5432" : env.POSTGRES_PORT,
    validate: (value) => (/^\d+$/.test(value.trim()) ? null : "Port must be a number."),
  });
  const user = await ask("TomoriBot database user", {
    default: isPlaceholder(env.POSTGRES_USER) ? "tomori" : env.POSTGRES_USER,
    validate: validateNonPlaceholder("Database user"),
  });
  const password = await askSecret("TomoriBot database password", {
    default: isPlaceholder(env.POSTGRES_PASSWORD) ? generateSecret(24) : env.POSTGRES_PASSWORD,
    validate: validateNonPlaceholder("Database password"),
  });
  const database = await ask("TomoriBot database name", {
    default: isPlaceholder(env.POSTGRES_DB) ? "tomodb" : env.POSTGRES_DB,
    validate: validateNonPlaceholder("Database name"),
  });

  await provisionNativeDatabase(
    {
      host,
      port,
      user,
      password,
      database,
    },
    scan.hasPsql,
  );

  return {
    values: {
      POSTGRES_HOST: host,
      POSTGRES_PORT: port,
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: database,
    },
    startDockerDatabase: false,
  };
}

async function configureDockerDatabase(env: Record<string, string>): Promise<DatabaseConfigResult> {
  const password = await askSecret("PostgreSQL password for the local Docker database", {
    default: isPlaceholder(env.POSTGRES_PASSWORD) ? generateSecret(24) : env.POSTGRES_PASSWORD,
    validate: validateNonPlaceholder("Docker PostgreSQL password"),
  });

  return {
    values: {
      POSTGRES_HOST: "localhost",
      POSTGRES_PORT: "15432",
      POSTGRES_USER: "tomori",
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: "tomodb",
    },
    startDockerDatabase: true,
  };
}

async function configureDatabase(env: Record<string, string>, mode: EnvConfigureMode, scan: PrereqScan): Promise<DatabaseConfigResult> {
  if (!needsDatabaseConfig(env, mode)) {
    return { values: {}, startDockerDatabase: false };
  }

  const selected = await selectMenu<"native" | "docker">("Database setup", [
    {
      id: "native",
      label: "Use installed PostgreSQL",
      description: "Configure local/native PostgreSQL and optionally auto-create the user/database.",
    },
    {
      id: "docker",
      label: "Use Docker Compose database",
      description: scan.hasDocker ? "Use the repo's postgres service on localhost:15432." : "Docker was not detected.",
      disabled: !scan.hasDocker,
    },
  ]);

  return selected.id === "docker" ? configureDockerDatabase(env) : configureNativeDatabase(env, scan);
}

async function maybeStartDockerDatabase(scan: PrereqScan): Promise<void> {
  if (!scan.hasDocker) {
    return;
  }
  if (!(await confirm("Start the Docker Compose PostgreSQL database now?", true))) {
    log.info("Start it later with: docker compose up -d postgres");
    return;
  }
  await runInherited("docker", ["compose", "up", "-d", "postgres"]);
}

async function runBunInstall(): Promise<void> {
  if (!(await confirm("Run bun install now?", true))) {
    log.info("Skipped dependency install. Run `bun install` before starting TomoriBot.");
    return;
  }
  await runInherited("bun", ["install"]);
}

async function maybeRunTokenizers(ctx: SetupContext): Promise<void> {
  if (!(await confirm("Download tokenizer assets for model-aware logit bias now?", false))) {
    return;
  }
  const tokenizers = SETUP_MODULES.find((module) => module.id === "tokenizers");
  if (!tokenizers) {
    throw new Error("Tokenizer setup module is missing.");
  }
  await tokenizers.run(ctx);
}

async function runBaseInstall(scan: PrereqScan): Promise<void> {
  log.section("Base Install");

  const envAlreadyExisted = existsSync(ENV_PATH);
  if (seedFromExample(ENV_EXAMPLE_PATH, ENV_PATH)) {
    log.success("Created .env from .env.example.");
  }

  const mode = await chooseEnvMode(envAlreadyExisted);
  const env = readEnvValues(ENV_PATH);
  const envUpdates: Record<string, string> = {};

  Object.assign(envUpdates, await configureCryptoSecret(env, mode));
  Object.assign(envUpdates, await configureDiscordToken({ ...env, ...envUpdates }, mode));
  const database = await configureDatabase({ ...env, ...envUpdates }, mode, scan);
  Object.assign(envUpdates, database.values);

  if (Object.keys(envUpdates).length > 0) {
    upsertEnvKeys(ENV_PATH, envUpdates, { overwrite: mode === "reconfigure" });
    log.success("Updated .env.");
  } else {
    log.info(".env unchanged.");
  }

  if (database.startDockerDatabase) {
    await maybeStartDockerDatabase(scan);
  }

  await runBunInstall();
  await maybeRunTokenizers(buildContext(scan));

  log.section("Base Install Complete");
  log.info("Next steps:");
  log.info("  1. Start TomoriBot with `bun run dev` or `bun run launch`.");
  log.info("  2. When Discord shows the bot online, run `/config setup` in your server.");
}

async function runCategory(category: SetupCategory, ctx: SetupContext): Promise<void> {
  const modules = getModulesByCategory(category);
  const choices = await multiSelectMenu(
    `${getCategoryLabel(category)} setup modules`,
    modules.map((module) => ({
      id: module.id,
      label: module.label,
      description: module.summary,
    })),
  );

  for (const choice of choices) {
    const module = modules.find((candidate) => candidate.id === choice.id);
    if (!module) {
      throw new Error(`Unknown setup module: ${choice.id}`);
    }

    log.section(module.label);
    const result = await module.run(ctx);
    if (result === "done") {
      log.success(`${module.label} complete.`);
    } else if (result === "guided") {
      log.info(`${module.label} needs the guided step(s) shown above.`);
    } else {
      log.info(`${module.label} skipped.`);
    }
  }
}

async function runInteractiveMenu(scan: PrereqScan): Promise<void> {
  const ctx = buildContext(scan);

  while (true) {
    const categories = getSetupCategories();
    const selected = await selectMenu<string>("TomoriBot setup", [
      {
        id: "base",
        label: "Base Install",
        description: "Required .env, Discord token, database, dependencies.",
      },
      ...categories.map((category) => ({
        id: category,
        label: getCategoryLabel(category),
        description: "Optional setup modules.",
      })),
      {
        id: "exit",
        label: "Exit",
      },
    ]);

    if (selected.id === "exit") {
      return;
    }

    if (selected.id === "base") {
      await runBaseInstall(scan);
      continue;
    }

    await runCategory(selected.id as SetupCategory, ctx);
  }
}

async function runSingleModule(moduleId: string, scan: PrereqScan): Promise<void> {
  const module = SETUP_MODULES.find((candidate) => candidate.id === moduleId);
  if (!module) {
    throw new Error(`Unknown setup module "${moduleId}". Available: ${SETUP_MODULES.map((m) => m.id).join(", ")}`);
  }
  await module.run(buildContext(scan));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));

  if (flags.has("--help") || flags.has("-h")) {
    printHelp();
    return;
  }

  console.log(pc.bold("\nTomoriBot Setup Wizard\n"));
  const scan = await scanPrereqs();

  const moduleIndex = args.indexOf("--module");
  if (moduleIndex !== -1) {
    const moduleId = args[moduleIndex + 1];
    if (!moduleId) {
      throw new Error("Provide a module id after --module.");
    }
    await runSingleModule(moduleId, scan);
    return;
  }

  if (flags.has("--base") || isNonInteractiveMode()) {
    await runBaseInstall(scan);
    return;
  }

  await runInteractiveMenu(scan);
}

main().catch((error) => {
  log.error("Setup failed:", error);
  process.exit(1);
});
