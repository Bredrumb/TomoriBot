#!/usr/bin/env bun
import { analyze } from "./envDoctor/analyze";
import { renderSummary, renderVariable } from "./envDoctor/render";
import { loadCheckout } from "./envDoctor/sources";

interface CliOptions {
  json: boolean;
  all: boolean;
  names: string[];
  limit: number;
  includeRelease: boolean;
  includeLiveEnv: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    all: false,
    names: [],
    limit: 40,
    includeRelease: true,
    includeLiveEnv: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--no-release") options.includeRelease = false;
    else if (arg === "--no-live-env") options.includeLiveEnv = false;
    else if (arg === "--var") options.names.push(argv[++index] ?? "");
    else if (arg === "--limit") options.limit = Number.parseInt(argv[++index] ?? "", 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error("--limit takes a non-negative integer");
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const input = loadCheckout(process.cwd(), { includeRelease: options.includeRelease });
  const report = analyze(
    options.includeLiveEnv ? input : { ...input, liveEnvKeys: null, liveEnvStatus: "skipped by --no-live-env" },
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (options.names.length > 0) {
    for (const name of options.names) {
      const variable = report.variables.find((entry) => entry.name === name);
      process.stdout.write(`${variable ? renderVariable(variable) : `${name}: not found in any scanned file`}\n\n`);
    }
    return;
  }
  if (options.all) {
    for (const variable of report.variables) process.stdout.write(`${renderVariable(variable)}\n\n`);
  }
  process.stdout.write(`${renderSummary(report, { limit: options.limit })}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`env-doctor: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
