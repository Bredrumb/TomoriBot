// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures are shell, Compose, and TypeScript source whose `${}` must stay literal text.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../../../scripts/devtools/envDoctor/analyze";
import { parseLiveEnvKeys } from "../../../scripts/devtools/envDoctor/declarations";
import { renderSummary, renderVariable } from "../../../scripts/devtools/envDoctor/render";
import { readLiveEnvKeys } from "../../../scripts/devtools/envDoctor/sources";
import type { EnvDoctorInput, EnvDoctorReport, VariableReport } from "../../../scripts/devtools/envDoctor/types";

function run(files: Record<string, string>, overrides: Partial<EnvDoctorInput> = {}): EnvDoctorReport {
  return analyze({
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    liveEnvKeys: null,
    liveEnvStatus: "fixture",
    unavailable: [],
    releaseSource: "checkout",
    ...overrides,
  });
}

function variable(report: EnvDoctorReport, name: string): VariableReport {
  const found = report.variables.find((entry) => entry.name === name);
  if (!found) throw new Error(`${name} missing from report`);
  return found;
}

function fallbacks(report: EnvDoctorReport, name: string): string[] {
  return variable(report, name).codeFallbacks.map((site) => site.value);
}

describe("env-doctor TypeScript reads", () => {
  it("recovers direct reads, literal fallbacks, boolean defaults, and constant fallbacks", () => {
    const report = run({
      ".env.optional.example": "ALPHA_TIMEOUT_MS=5000\nBETA_ENABLED=true\nGAMMA_MODE=fast\nOMEGA_UNUSED=1\n",
      "src/alpha.ts": [
        'const DEFAULT_GAMMA = "fast";',
        "/** OMEGA_UNUSED is only named in this comment. */",
        'export const timeout = Number.parseInt(process.env.ALPHA_TIMEOUT_MS || "5000", 10);',
        'export const enabled = process.env.BETA_ENABLED?.trim() !== "false";',
        "export const mode = process.env.GAMMA_MODE ?? DEFAULT_GAMMA;",
      ].join("\n"),
    });

    expect(fallbacks(report, "ALPHA_TIMEOUT_MS")).toEqual(["5000"]);
    expect(fallbacks(report, "BETA_ENABLED")).toEqual(["true"]);
    expect(fallbacks(report, "GAMMA_MODE")).toEqual(["fast"]);
    expect(variable(report, "OMEGA_UNUSED").classification.candidate).toBe("dead");
    expect(report.diagnostics.conflictingDefaults).toEqual([]);
  });

  it("follows string-key helpers across files, through wrappers, and not into same-named local parsers", () => {
    const report = run({
      "src/env.ts":
        "export function readIntEnv(name: string, fallback: number) { return Number(process.env[name] ?? fallback); }",
      "src/limits.ts": [
        'import { readIntEnv } from "./env";',
        'export const delta = readIntEnv("DELTA_LIMIT", 20);',
        "function limit(key: string) { return readIntEnv(key, 5); }",
        'export const epsilon = limit("EPSILON_LIMIT");',
      ].join("\n"),
      "src/local.ts": [
        "function readIntEnv(raw: string | undefined, fallback: number) { return raw ? Number(raw) : fallback; }",
        "export const zeta = readIntEnv(process.env.ZETA_COUNT, 7);",
      ].join("\n"),
    });

    expect(variable(report, "DELTA_LIMIT").consumers[0]).toMatchObject({ kind: "helper", helper: "readIntEnv" });
    expect(fallbacks(report, "DELTA_LIMIT")).toEqual(["20"]);
    expect(variable(report, "EPSILON_LIMIT").consumers[0]).toMatchObject({ kind: "helper", helper: "limit" });
    expect(variable(report, "ZETA_COUNT").consumers[0]).toMatchObject({ kind: "direct", helper: "readIntEnv" });
    expect(fallbacks(report, "ZETA_COUNT")).toEqual(["7"]);
    expect(report.diagnostics.unresolvedReads).toEqual([]);
  });

  it("reports ?? chains as aliases but not truthiness checks", () => {
    const report = run({
      "src/chain.ts": [
        'export const cycles = process.env.NEW_CYCLES ?? process.env.OLD_CYCLES ?? "3";',
        "export const configured = !!(process.env.DB_PASSWORD || process.env.DB_URL);",
      ].join("\n"),
    });

    expect(report.diagnostics.aliasGroups.map((group) => group.names)).toEqual([["NEW_CYCLES", "OLD_CYCLES"]]);
    expect(fallbacks(report, "OLD_CYCLES")).toEqual(["3"]);
  });
});

describe("env-doctor other languages", () => {
  it("reads Python getenv, environ, nested defaults, and same-file helpers", () => {
    const report = run({
      "servers/tts/demo/server.py": [
        "import os",
        "def _env_bool(name: str, default: bool) -> bool:",
        '  return os.getenv(name, str(default)).lower() in {"1", "true"}',
        'PORT = int(os.getenv("PY_PORT", os.getenv("PY_SHARED_PORT", "8015")))',
        'REQUIRED = os.environ["PY_REQUIRED"]',
        'FLAG = _env_bool("PY_FLAG", True)',
        '# os.getenv("PY_COMMENTED") is a comment',
      ].join("\n"),
    });

    expect(fallbacks(report, "PY_PORT")).toEqual(["8015"]);
    expect(fallbacks(report, "PY_SHARED_PORT")).toEqual(["8015"]);
    expect(variable(report, "PY_REQUIRED").consumers[0].kind).toBe("direct");
    expect(variable(report, "PY_FLAG").consumers[0]).toMatchObject({ kind: "helper", helper: "_env_bool" });
    expect(report.variables.some((entry) => entry.name === "PY_COMMENTED")).toBe(false);
    expect(report.diagnostics.aliasGroups.map((group) => group.names)).toEqual([["PY_PORT", "PY_SHARED_PORT"]]);
    expect(report.diagnostics.unresolvedReads).toEqual([]);
  });

  it("separates shell env reads from script variables and scans Compose layers", () => {
    const report = run({
      "servers/demo/install.sh": [
        'SCRIPT_DIR="$(pwd)"',
        'echo "$SCRIPT_DIR"',
        'MODEL="${SH_MODEL:-base}"',
        'REF="${SH_REF:-${SH_SHARED_REF:-main}}"',
        "echo '$SH_QUOTED'",
      ].join("\n"),
      "docker-compose.yaml": [
        "services:",
        "  app:",
        "    build:",
        "      context: .",
        "      dockerfile: Dockerfile",
        "    environment:",
        "      RUN_MODE: development",
        "      APP_PASSWORD: ${APP_PASSWORD:-compose-fallback-pass}",
        "  search:",
        "    image: vendor/search:latest",
        "    environment:",
        "      - VENDOR_SETTING=on",
      ].join("\n"),
    });

    expect(fallbacks(report, "SH_MODEL")).toEqual(["base"]);
    expect(fallbacks(report, "SH_REF")).toEqual(["main"]);
    expect(report.variables.some((entry) => entry.name === "SCRIPT_DIR" || entry.name === "SH_QUOTED")).toBe(false);
    expect(report.diagnostics.aliasGroups.map((group) => group.names)).toContainEqual(["SH_REF", "SH_SHARED_REF"]);
    expect(variable(report, "RUN_MODE").declarations[0]).toMatchObject({
      layer: "compose-environment",
      service: "app",
    });
    expect(variable(report, "VENDOR_SETTING").classification.reasons[0]).toContain("third-party container");
    expect(variable(report, "APP_PASSWORD").consumers.some((site) => site.kind === "interpolation")).toBe(true);
  });
});

describe("env-doctor matching and diagnostics", () => {
  it("never lets one name stand in for another it prefixes", () => {
    const report = run({
      ".env.optional.example": "MAX_CHUNKS=150\nMAX_CHUNKS_PER_SERVER=1000\nWORKFLOW_PATH_ANIMA=/tmp/a.json\n",
      "src/env.ts": "export function readEnv(name: string) { return process.env[name]; }",
      "src/limits.ts": [
        'import { readEnv } from "./env";',
        'export const perServer = readEnv("MAX_CHUNKS_PER_SERVER");',
        "export const workflow = (label: string) => readEnv(`WORKFLOW_PATH_${label}`);",
      ].join("\n"),
      "docs/en/limits.md": "Set `MAX_CHUNKS_PER_SERVER` to cap storage.",
    });

    expect(variable(report, "MAX_CHUNKS").classification.candidate).toBe("dead");
    expect(variable(report, "MAX_CHUNKS").docsMentions).toEqual([]);
    expect(variable(report, "MAX_CHUNKS_PER_SERVER").docsMentions).toEqual(["docs/en/limits.md"]);
    expect(variable(report, "WORKFLOW_PATH_ANIMA").dynamicMatches[0]?.prefix).toBe("WORKFLOW_PATH_");
    expect(report.diagnostics.declaredUnread).toEqual(["MAX_CHUNKS"]);
  });

  it("flags conflicting defaults but treats 0/false and empty fallbacks as equivalent", () => {
    const report = run({
      ".env.optional.example": "KAPPA_LOOKBACK=3\n# Toggle (default: false)\nLAMBDA_HALF=false\nMU_LIMIT=10\n",
      "src/kappa.ts": [
        "export const lookback = Number(process.env.KAPPA_LOOKBACK ?? 5);",
        'export const limit = Number.parseInt(process.env.MU_LIMIT ?? "", 10);',
      ].join("\n"),
      "servers/demo/server.py": 'import os\nHALF = os.getenv("LAMBDA_HALF", "0").lower() in {"1"}\n',
    });

    expect(report.diagnostics.conflictingDefaults.map((conflict) => conflict.name)).toEqual(["KAPPA_LOOKBACK"]);
    expect(report.diagnostics.conflictingDefaults[0].values.map((entry) => entry.value)).toEqual(["3", "5"]);
  });

  it("refuses a dead verdict when a surface is unavailable or a dynamic read is unexplained", () => {
    const files = {
      ".env.optional.example": "NU_UNREAD=1\nTOMORIBOT_PIDS_LIMIT=256\nXI_HARNESS=1\n",
      "tests/setup.ts": "export const harness = process.env.XI_HARNESS;",
    };
    const unavailable = run(files, {
      releaseSource: null,
      unavailable: [{ surface: "release deployment files", reason: "fixture" }],
    });
    expect(variable(unavailable, "NU_UNREAD").classification).toMatchObject({
      candidate: "undecided",
      confidence: "low",
    });
    expect(variable(unavailable, "NU_UNREAD").classification.reasons).toContain(
      "release-only deployment files were unavailable",
    );
    expect(variable(unavailable, "TOMORIBOT_PIDS_LIMIT").exception).toContain("release");
    expect(variable(unavailable, "XI_HARNESS").classification.candidate).not.toBe("dead");

    const dynamic = run({
      ...files,
      "src/dynamic.ts": "export const read = (key: string[]) => key.map((k) => process.env[k]);",
    });
    expect(dynamic.diagnostics.unresolvedReads).toHaveLength(1);
    expect(variable(dynamic, "NU_UNREAD").classification.candidate).toBe("undecided");

    const clean = run(files);
    expect(variable(clean, "NU_UNREAD").classification.candidate).toBe("dead");
    expect(clean.diagnostics.exceptionDrift).toContain(
      "TOMORIBOT_PIDS_LIMIT is listed in RELEASE_ONLY_CONSUMERS but no release file reads it",
    );
  });
});

describe("env-doctor secret handling", () => {
  it("keeps live .env values out of memory and redacts every secret-named value in all outputs", () => {
    expect(parseLiveEnvKeys('# comment\nDISCORD_TOKEN=live-token-value\nexport RUN_ENV="production"\n')).toEqual([
      "DISCORD_TOKEN",
      "RUN_ENV",
    ]);

    const directory = mkdtempSync(join(tmpdir(), "env-doctor-"));
    try {
      writeFileSync(join(directory, ".env"), "OMICRON_TOKEN=live-token-value\n");
      const live = readLiveEnvKeys(join(directory, ".env"));
      expect(live.keys).toEqual(["OMICRON_TOKEN"]);
      expect(live.status).not.toContain("live-token-value");
      expect(readLiveEnvKeys(directory).keys).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    const report = run(
      {
        ".env.optional.example":
          "# Service key (default: example-placeholder-key)\nPI_API_KEY=example-placeholder-key\n",
        "src/pi.ts": 'export const key = process.env.PI_API_KEY ?? "code-fallback-key";',
        "docker-compose.yaml":
          "services:\n  app:\n    build: .\n    environment:\n      PI_API_KEY: ${PI_API_KEY:-compose-fallback-key}\n",
      },
      { liveEnvKeys: ["PI_API_KEY", "RHO_UNKNOWN"] },
    );
    const outputs = [
      JSON.stringify(report),
      renderSummary(report, { limit: 0 }),
      ...report.variables.map(renderVariable),
    ].join("\n");

    for (const leaked of ["example-placeholder-key", "code-fallback-key", "compose-fallback-key", "live-token-value"]) {
      expect(outputs).not.toContain(leaked);
    }
    expect(report.diagnostics.conflictingDefaults.map((conflict) => conflict.name)).toEqual(["PI_API_KEY"]);
    expect(report.diagnostics.liveEnvUnconsumed).toEqual(["RHO_UNKNOWN"]);
  });
});
