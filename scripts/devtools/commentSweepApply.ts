import { isAbsolute, relative, resolve } from "node:path";
import {
  compareTypeScriptSources,
  type CommentSweepGateResult,
} from "./commentSweepGate";
import {
  createCommentSweepContextHash,
  stripCommentNumbering,
  stripRuleArtifact,
  type CommentSweepCandidateKind,
  type CommentSweepTier,
  type CommentSweepTierOneOperation,
} from "./commentSweepScan";

type CommentSweepVerdict = "delete" | "keep" | "rewrite";

interface CommentSweepLedgerRow {
  confidence?: number;
  context_hash: string;
  file: string;
  kind: CommentSweepCandidateKind;
  line: number;
  operation?: CommentSweepTierOneOperation;
  reason?: string;
  rewrite?: string;
  text: string;
  tier: CommentSweepTier;
  verdict?: CommentSweepVerdict;
}

export interface CommentSweepApplyOptions {
  dryRun?: boolean;
  ledgerPath: string;
  minConfidence: number;
  repoRoot?: string;
  tier?: CommentSweepTier;
}

export interface CommentSweepApplyResult {
  appliedEdits: number;
  changedFiles: number;
  confidenceSkipped: number;
  driftSkipped: number;
  gateFailures: number;
  keptRows: number;
}

/**
 * Applies an audited comment ledger bottom-up and gates every changed file.
 */
export async function applyCommentSweepLedger(
  options: CommentSweepApplyOptions,
): Promise<CommentSweepApplyResult> {
  if (
    !Number.isFinite(options.minConfidence) ||
    options.minConfidence < 0 ||
    options.minConfidence > 1
  ) {
    throw new Error("minConfidence must be between 0 and 1");
  }

  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const rows = await readLedger(options.ledgerPath);
  const selectedRows = options.tier
    ? rows.filter((row) => row.tier === options.tier)
    : rows;
  const rowsByFile = groupRowsByFile(selectedRows);
  const result: CommentSweepApplyResult = {
    appliedEdits: 0,
    changedFiles: 0,
    confidenceSkipped: 0,
    driftSkipped: 0,
    gateFailures: 0,
    keptRows: 0,
  };

  for (const [file, fileRows] of rowsByFile) {
    const absolutePath = resolveLedgerPath(repoRoot, file);
    const sourceFile = Bun.file(absolutePath);
    if (!(await sourceFile.exists())) {
      result.driftSkipped += fileRows.length;
      console.warn(`SKIP ${file}: file no longer exists.`);
      continue;
    }

    const original = await sourceFile.text();
    const newline = original.includes("\r\n") ? "\r\n" : "\n";
    const originalLines = original.split(/\r?\n/);
    const updatedLines = [...originalLines];
    let fileEdits = 0;

    for (const row of [...fileRows].sort((left, right) => right.line - left.line)) {
      if (!rowMatchesContext(row, originalLines)) {
        result.driftSkipped++;
        continue;
      }

      const action = selectAction(row, options.minConfidence);
      if (action === "keep") {
        result.keptRows++;
        continue;
      }
      if (action === "below-confidence") {
        result.confidenceSkipped++;
        continue;
      }

      const editResult = editCandidateLine(updatedLines, row, action);
      if (!editResult) {
        result.driftSkipped++;
        continue;
      }
      fileEdits++;
    }

    if (fileEdits === 0) {
      continue;
    }

    const updated = updatedLines.join(newline);
    const gateResult = compareTypeScriptSources(original, updated);
    if (gateResult.status !== "equal") {
      result.gateFailures++;
      printGateFailure(file, gateResult);
      continue;
    }

    if (!options.dryRun) {
      await Bun.write(absolutePath, updated);
    }
    result.appliedEdits += fileEdits;
    result.changedFiles++;
    console.log(
      `${options.dryRun ? "DRY-RUN" : "APPLY"} ${file}: ${fileEdits} edit(s), gate passed.`,
    );
  }

  return result;
}

async function readLedger(path: string): Promise<CommentSweepLedgerRow[]> {
  const body = await Bun.file(path).text();
  return body
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseLedgerRow(line, index + 1));
}

function parseLedgerRow(line: string, lineNumber: number): CommentSweepLedgerRow {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Ledger line ${lineNumber} is not JSON: ${message}`);
  }

  if (!isRecord(value)) {
    throw new Error(`Ledger line ${lineNumber} must be an object`);
  }

  const file = requireString(value, "file", lineNumber);
  const text = requireString(value, "text", lineNumber);
  const contextHash = requireString(value, "context_hash", lineNumber);
  const sourceLine = requireNumber(value, "line", lineNumber);
  if (!Number.isInteger(sourceLine) || sourceLine < 1) {
    throw new Error(`Ledger line ${lineNumber} field "line" must be a positive integer`);
  }
  if (!/^[a-f0-9]{64}$/i.test(contextHash)) {
    throw new Error(`Ledger line ${lineNumber} has an invalid context_hash`);
  }
  const kind = value.kind;
  if (kind !== "line" && kind !== "jsdoc-tag") {
    throw new Error(`Ledger line ${lineNumber} has an invalid kind`);
  }

  const parsedTier = parseTier(value.tier);
  if (value.tier !== undefined && !parsedTier) {
    throw new Error(`Ledger line ${lineNumber} has an invalid tier`);
  }
  const tier = parsedTier ?? inferTier(kind, text, value.operation);
  const operation = parseOperation(value.operation, lineNumber);
  const verdict = parseVerdict(value.verdict, lineNumber);
  const confidence =
    value.confidence === undefined
      ? undefined
      : requireNumber(value, "confidence", lineNumber);
  if (
    confidence !== undefined &&
    (confidence < 0 || confidence > 1)
  ) {
    throw new Error(`Ledger line ${lineNumber} confidence must be between 0 and 1`);
  }
  const rewrite =
    value.rewrite === undefined
      ? undefined
      : requireString(value, "rewrite", lineNumber);
  const reason =
    value.reason === undefined
      ? undefined
      : requireString(value, "reason", lineNumber);

  if (tier === "1" && !operation) {
    throw new Error(`Ledger line ${lineNumber} is Tier 1 without an operation`);
  }
  if (tier !== "1" && !verdict) {
    throw new Error(`Ledger line ${lineNumber} has no verdict`);
  }
  if (verdict === "rewrite" && !rewrite) {
    throw new Error(`Ledger line ${lineNumber} is a rewrite without rewrite text`);
  }
  if (rewrite?.includes("\n") || rewrite?.includes("\r")) {
    throw new Error(`Ledger line ${lineNumber} rewrite must be a single line`);
  }

  return {
    confidence,
    context_hash: contextHash,
    file,
    kind,
    line: sourceLine,
    operation,
    reason,
    rewrite,
    text,
    tier,
    verdict,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  line: number,
): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`Ledger line ${line} field "${key}" must be a string`);
  }
  return field;
}

function requireNumber(
  value: Record<string, unknown>,
  key: string,
  line: number,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Ledger line ${line} field "${key}" must be a number`);
  }
  return field;
}

function parseTier(value: unknown): CommentSweepTier | undefined {
  return value === "1" || value === "2" || value === "2b" || value === "2c"
    ? value
    : undefined;
}

function inferTier(
  kind: CommentSweepCandidateKind,
  text: string,
  operation: unknown,
): CommentSweepTier {
  if (operation !== undefined) {
    return "1";
  }
  if (kind === "jsdoc-tag") {
    return "2b";
  }
  return /—|–| -- /.test(text) ? "2c" : "2";
}

function parseOperation(
  value: unknown,
  line: number,
): CommentSweepTierOneOperation | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "delete-commented-code" ||
    value === "normalize-block" ||
    value === "strip-numbering" ||
    value === "strip-rule"
  ) {
    return value;
  }
  throw new Error(`Ledger line ${line} has an invalid Tier 1 operation`);
}

function parseVerdict(
  value: unknown,
  line: number,
): CommentSweepVerdict | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "delete" || value === "keep" || value === "rewrite") {
    return value;
  }
  throw new Error(`Ledger line ${line} has an invalid verdict`);
}

function groupRowsByFile(
  rows: CommentSweepLedgerRow[],
): Map<string, CommentSweepLedgerRow[]> {
  const grouped = new Map<string, CommentSweepLedgerRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.file) ?? [];
    existing.push(row);
    grouped.set(row.file, existing);
  }
  return grouped;
}

function resolveLedgerPath(repoRoot: string, ledgerPath: string): string {
  if (isAbsolute(ledgerPath)) {
    throw new Error(`Ledger path must be repository-relative: ${ledgerPath}`);
  }

  const absolutePath = resolve(repoRoot, ledgerPath);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Ledger path escapes the repository: ${ledgerPath}`);
  }
  if (!/\.tsx?$/i.test(absolutePath)) {
    throw new Error(`Ledger path is not TypeScript: ${ledgerPath}`);
  }
  return absolutePath;
}

function rowMatchesContext(
  row: CommentSweepLedgerRow,
  originalLines: string[],
): boolean {
  if (row.line < 1 || row.line > originalLines.length) {
    return false;
  }
  if (
    createCommentSweepContextHash(originalLines, row.line) !== row.context_hash
  ) {
    return false;
  }
  return originalLines[row.line - 1].includes(row.text);
}

function selectAction(
  row: CommentSweepLedgerRow,
  minConfidence: number,
):
  | CommentSweepTierOneOperation
  | "below-confidence"
  | "delete"
  | "keep"
  | "rewrite" {
  if (row.tier === "1") {
    return row.operation ?? "keep";
  }
  if (row.verdict === "keep") {
    return "keep";
  }
  if ((row.confidence ?? 0) < minConfidence) {
    return "below-confidence";
  }
  return row.verdict ?? "keep";
}

function editCandidateLine(
  lines: string[],
  row: CommentSweepLedgerRow,
  action:
    | CommentSweepTierOneOperation
    | "delete"
    | "rewrite",
): boolean {
  const index = row.line - 1;
  const sourceLine = lines[index];
  if (sourceLine === undefined) {
    return false;
  }
  const textIndex = sourceLine.indexOf(row.text);
  if (textIndex === -1) {
    return false;
  }

  if (action === "delete" || action.startsWith("delete-")) {
    deleteCommentText(lines, index, textIndex, row.text.length);
    return true;
  }

  const replacement =
    action === "rewrite"
      ? row.rewrite?.trimStart()
      : createTierOneReplacement(row.text, action);
  if (replacement === undefined) {
    return false;
  }
  if (replacement.trim() === "//" || replacement.trim() === "*") {
    deleteCommentText(lines, index, textIndex, row.text.length);
    return true;
  }

  lines[index] =
    sourceLine.slice(0, textIndex) +
    replacement +
    sourceLine.slice(textIndex + row.text.length);
  return true;
}

function deleteCommentText(
  lines: string[],
  lineIndex: number,
  textIndex: number,
  textLength: number,
): void {
  const sourceLine = lines[lineIndex];
  const before = sourceLine.slice(0, textIndex);
  const after = sourceLine.slice(textIndex + textLength);

  if (before.trim().length === 0 && after.trim().length === 0) {
    lines.splice(lineIndex, 1);
    return;
  }

  lines[lineIndex] = before.replace(/[ \t]+$/, "") + after;
}

function createTierOneReplacement(
  text: string,
  operation: CommentSweepTierOneOperation,
): string | undefined {
  if (operation === "strip-numbering") {
    return stripCommentNumbering(text);
  }

  if (operation === "strip-rule") {
    return stripRuleArtifact(text);
  }

  if (operation === "normalize-block") {
    const match = text.match(/^\/\*\s*(.*?)\s*\*\/$/);
    return match ? `// ${match[1]}`.trimEnd() : undefined;
  }

  return undefined;
}

function printGateFailure(file: string, result: CommentSweepGateResult): void {
  if (result.status === "parse-error") {
    console.error(
      `GATE FAIL ${file}: ${result.side} parse failed: ${result.message}`,
    );
    return;
  }
  if (result.status === "different") {
    console.error(
      [
        `GATE FAIL ${file}:${result.difference.line}:${result.difference.column}`,
        `  before | ${result.difference.beforeExcerpt}`,
        `  after  | ${result.difference.afterExcerpt}`,
      ].join("\n"),
    );
  }
}

function parseCliArgs(args: string[]): CommentSweepApplyOptions {
  let ledgerPath: string | undefined;
  let minConfidence: number | undefined;
  let tier: CommentSweepTier | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--ledger") {
      ledgerPath = args[++index];
      continue;
    }
    if (argument === "--min-conf") {
      minConfidence = Number(args[++index]);
      continue;
    }
    if (argument === "--tier") {
      tier = parseTier(args[++index]);
      if (!tier) {
        throw new Error("--tier must be one of 1, 2, 2b, or 2c");
      }
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!ledgerPath) {
    throw new Error("--ledger is required");
  }
  if (minConfidence === undefined || Number.isNaN(minConfidence)) {
    throw new Error("--min-conf is required and must be numeric");
  }

  return { dryRun, ledgerPath, minConfidence, tier };
}

async function main(): Promise<number> {
  const options = parseCliArgs(Bun.argv.slice(2));
  const result = await applyCommentSweepLedger(options);
  console.log(
    [
      `Files changed: ${result.changedFiles}`,
      `edits applied: ${result.appliedEdits}`,
      `context drift skipped: ${result.driftSkipped}`,
      `below confidence: ${result.confidenceSkipped}`,
      `kept: ${result.keptRows}`,
      `gate failures: ${result.gateFailures}`,
    ].join("; "),
  );
  return result.gateFailures === 0 ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Comment sweep apply failed: ${message}`);
    return 1;
  });
  process.exit(exitCode);
}
