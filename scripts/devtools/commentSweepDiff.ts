import { isAbsolute, resolve } from "node:path";

interface LedgerRow {
  confidence?: number;
  context_hash: string;
  file: string;
  line: number;
  reason?: string;
  text: string;
  tier: string;
  verdict?: string;
}

export interface DiffOptions {
  aggressivePath: string;
  applyPath: string;
  contestedPath: string;
  conservativePath: string;
  repoRoot?: string;
}

export interface DiffResult {
  agreedDelete: number;
  agreedKeep: number;
  aggressiveOnlyDelete: number;
  conservativeOnlyDelete: number;
  unmatched: number;
}

/**
 * Splits two independently judged ledgers into an apply set and a contested set.
 *
 * Only rows both rubrics marked `delete` reach the apply ledger, and each carries the
 * lower of the two confidences so a threshold still means what it meant on one run.
 * Every disagreement is written to the contested ledger instead, never dropped: a row the
 * aggressive rubric alone wants deleted is precisely the marginal call that needs a human.
 */
export async function diffCommentSweepLedgers(
  options: DiffOptions,
): Promise<DiffResult> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const conservative = await readLedger(
    resolvePath(repoRoot, options.conservativePath),
  );
  const aggressive = await readLedger(
    resolvePath(repoRoot, options.aggressivePath),
  );

  const result: DiffResult = {
    agreedDelete: 0,
    agreedKeep: 0,
    aggressiveOnlyDelete: 0,
    conservativeOnlyDelete: 0,
    unmatched: 0,
  };
  const applyRows: string[] = [];
  const contestedRows: string[] = [];

  for (const [key, safe] of conservative) {
    const bold = aggressive.get(key);
    if (!bold) {
      result.unmatched += 1;
      continue;
    }
    // A drifted pair cannot be reconciled: the two runs judged different code.
    if (safe.context_hash !== bold.context_hash) {
      result.unmatched += 1;
      continue;
    }

    const safeDelete = safe.verdict === "delete";
    const boldDelete = bold.verdict === "delete";

    if (safeDelete && boldDelete) {
      result.agreedDelete += 1;
      applyRows.push(
        JSON.stringify({
          ...safe,
          confidence: Math.min(safe.confidence ?? 0, bold.confidence ?? 0),
          reason: safe.reason,
        }),
      );
      continue;
    }
    if (!safeDelete && !boldDelete) {
      result.agreedKeep += 1;
      continue;
    }

    if (boldDelete) {
      result.aggressiveOnlyDelete += 1;
    } else {
      result.conservativeOnlyDelete += 1;
    }
    contestedRows.push(
      JSON.stringify({
        aggressive_confidence: bold.confidence,
        aggressive_reason: bold.reason,
        aggressive_verdict: bold.verdict,
        conservative_confidence: safe.confidence,
        conservative_reason: safe.reason,
        conservative_verdict: safe.verdict,
        context_hash: safe.context_hash,
        file: safe.file,
        kind: (safe as { kind?: string }).kind,
        line: safe.line,
        text: safe.text,
        tier: safe.tier,
      }),
    );
  }

  await Bun.write(
    resolvePath(repoRoot, options.applyPath),
    `${applyRows.join("\n")}\n`,
  );
  await Bun.write(
    resolvePath(repoRoot, options.contestedPath),
    `${contestedRows.join("\n")}\n`,
  );

  return result;
}

async function readLedger(path: string): Promise<Map<string, LedgerRow>> {
  const rows = new Map<string, LedgerRow>();
  const text = await Bun.file(path).text();
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line) as LedgerRow;
    rows.set(`${row.file}\0${row.line}\0${row.tier}`, row);
  }
  return rows;
}

function resolvePath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function parseCliArgs(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      values[args[index].slice(2)] = args[++index] ?? "";
    }
  }
  return values;
}

if (import.meta.main) {
  const values = parseCliArgs(Bun.argv.slice(2));
  for (const required of ["conservative", "aggressive", "apply", "contested"]) {
    if (!values[required]) {
      throw new Error(`--${required} is required`);
    }
  }

  const result = await diffCommentSweepLedgers({
    aggressivePath: values.aggressive,
    applyPath: values.apply,
    contestedPath: values.contested,
    conservativePath: values.conservative,
  });

  const judged =
    result.agreedDelete +
    result.agreedKeep +
    result.aggressiveOnlyDelete +
    result.conservativeOnlyDelete;
  const contested = result.aggressiveOnlyDelete + result.conservativeOnlyDelete;

  console.log(`Judged by both rubrics: ${judged}`);
  console.log(`  agreed delete  ${result.agreedDelete}  -> ${values.apply}`);
  console.log(`  agreed keep    ${result.agreedKeep}`);
  console.log(
    `  contested      ${contested}  -> ${values.contested}  (${((contested / judged) * 100).toFixed(1)}%)`,
  );
  console.log(`      aggressive-only delete  ${result.aggressiveOnlyDelete}`);
  console.log(`      conservative-only delete ${result.conservativeOnlyDelete}`);
  if (result.unmatched > 0) {
    console.log(`Unmatched or drifted rows skipped: ${result.unmatched}`);
  }
}
