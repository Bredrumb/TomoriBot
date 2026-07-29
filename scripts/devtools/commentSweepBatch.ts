import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CommentSweepCandidate,
  CommentSweepCandidateKind,
  CommentSweepTier,
} from "./commentSweepScan";

const DEFAULT_PROMPTS_PATH = "plans/comment-sweep/prompts/judge.md";
const DEFAULT_CONTEXT_LINES = 8;
const DEFAULT_BATCH_SIZE = 500;
const ID_LENGTH = 10;

const JSDOC_OPEN_PATTERN = /\/\*\*/;
const JSDOC_CLOSE_PATTERN = /\*\//;

export type CommentSweepBlock = "B" | "B2" | "C" | "D" | "E";

interface BatchGroup {
  id: string;
  members: CommentSweepCandidate[];
  prompt: string;
}

export interface RenderOptions {
  block: CommentSweepBlock;
  contextLines?: number;
  ledgerPath: string;
  outDir: string;
  promptsPath?: string;
  repoRoot?: string;
  size?: number;
}

export interface RenderResult {
  batches: number;
  driftSkipped: number;
  groups: number;
  rows: number;
}

export interface CollectOptions {
  manifestPath: string;
  outPath: string;
  responsePath: string;
}

export interface CollectResult {
  rowsWritten: number;
}

export interface CollectDirOptions {
  batchDir: string;
  outPath: string;
  responseDir: string;
}

export interface CollectDirResult {
  accepted: string[];
  missing: string[];
  rejected: Array<{ batch: string; reason: string }>;
  rowsWritten: number;
}

interface ManifestFile {
  block: CommentSweepBlock;
  groups: BatchGroup[];
}

/**
 * Renders a candidate ledger into self-contained judge prompts plus their manifests.
 *
 * Each emitted row carries an opaque id the judge must echo back. Rows whose source text
 * no longer matches the file are dropped here rather than at apply time, so no judgment
 * is spent on a comment that has already drifted.
 */
export async function renderCommentSweepBatches(
  options: RenderOptions,
): Promise<RenderResult> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const size = options.size ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("--size must be a positive integer");
  }

  const preamble = await extractBlock(
    resolvePath(repoRoot, options.promptsPath ?? DEFAULT_PROMPTS_PATH),
    "A",
  );
  const rubric = await extractBlock(
    resolvePath(repoRoot, options.promptsPath ?? DEFAULT_PROMPTS_PATH),
    options.block,
  );

  const candidates = await readCandidates(
    resolvePath(repoRoot, options.ledgerPath),
  );
  const sourceCache = new Map<string, string[]>();
  // Rows outside this block's population are not drift, and conflating the two hides a
  // real drift signal behind a large, expected filter count.
  const inScope = candidates.filter((candidate) =>
    options.block === "E"
      ? candidate.manual_review === "jsdoc-ordered-list"
      : !candidate.manual_review,
  );
  const groups =
    options.block === "E"
      ? await buildListGroups(repoRoot, inScope, sourceCache)
      : await buildRowGroups(repoRoot, inScope, contextLines, sourceCache);

  const driftSkipped =
    inScope.length - groups.reduce((sum, g) => sum + g.members.length, 0);
  assertUniqueIds(groups);

  const outDir = resolvePath(repoRoot, options.outDir);
  await mkdir(outDir, { recursive: true });

  const batches = chunk(groups, size);
  for (const [index, batch] of batches.entries()) {
    const label = String(index + 1).padStart(3, "0");
    await Bun.write(
      join(outDir, `${label}.md`),
      renderPrompt(preamble, rubric, options.block, batch),
    );
    const manifest: ManifestFile = { block: options.block, groups: batch };
    await Bun.write(
      join(outDir, `${label}.manifest.json`),
      `${JSON.stringify(manifest)}\n`,
    );
  }

  return {
    batches: batches.length,
    driftSkipped,
    groups: groups.length,
    rows: groups.reduce((sum, g) => sum + g.members.length, 0),
  };
}

/**
 * Converts one judge response into ledger rows, rejecting the batch on any id mismatch.
 *
 * A returned id set that is not an exact round-trip of the sent set means the judge
 * skipped, merged, invented, or truncated rows. Every verdict after such a point may be
 * attached to the wrong comment, and the transpiler gate cannot detect that because
 * comment edits leave code output identical. The batch is therefore rejected whole and
 * never reconciled by position.
 */
export async function collectCommentSweepVerdicts(
  options: CollectOptions,
): Promise<CollectResult> {
  const manifest = (await Bun.file(options.manifestPath).json()) as ManifestFile;
  const responses = parseResponses(await Bun.file(options.responsePath).text());

  const sent = new Set(manifest.groups.map((group) => group.id));
  const received = new Set(responses.map((response) => response.id));
  const missing = [...sent].filter((id) => !received.has(id));
  const unexpected = [...received].filter((id) => !sent.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Batch rejected: ${missing.length} id(s) missing, ${unexpected.length} unexpected. ` +
        `Missing: ${missing.slice(0, 5).join(", ")}. ` +
        `Unexpected: ${unexpected.slice(0, 5).join(", ")}. ` +
        "Re-run the whole batch; never merge a partial response.",
    );
  }
  if (responses.length !== sent.size) {
    throw new Error(
      `Batch rejected: ${responses.length} responses for ${sent.size} ids, so at least one id repeated.`,
    );
  }

  const byId = new Map(manifest.groups.map((group) => [group.id, group]));
  const lines: string[] = [];
  for (const response of responses) {
    const group = byId.get(response.id);
    if (!group) {
      throw new Error(`Unmapped id ${response.id}`);
    }
    for (const member of group.members) {
      lines.push(
        JSON.stringify(toLedgerRow(manifest.block, member, response)),
      );
    }
  }

  await mkdir(dirname(resolve(options.outPath)), { recursive: true });
  const existing = (await Bun.file(options.outPath).exists())
    ? await Bun.file(options.outPath).text()
    : "";
  await Bun.write(
    options.outPath,
    `${existing.trimEnd()}${existing.trim() ? "\n" : ""}${lines.join("\n")}\n`,
  );

  return { rowsWritten: lines.length };
}

/**
 * Collects a whole directory of judge responses, pairing each `NNN.jsonl` with `NNN.manifest.json`.
 *
 * One bad batch never blocks the others: a rejected batch contributes no rows and is named
 * in the result so it can be re-run on its own.
 *
 * The output file holds exactly this directory's batches. Single-batch collection appends so the
 * loop below can accumulate; a directory run therefore truncates first, otherwise re-running it
 * silently doubles every row instead of refreshing them.
 */
export async function collectCommentSweepDirectory(
  options: CollectDirOptions,
): Promise<CollectDirResult> {
  const manifests = [
    ...new Bun.Glob("*.manifest.json").scanSync(options.batchDir),
  ].sort();
  await mkdir(dirname(resolve(options.outPath)), { recursive: true });
  await Bun.write(options.outPath, "");
  const result: CollectDirResult = {
    accepted: [],
    missing: [],
    rejected: [],
    rowsWritten: 0,
  };

  for (const manifestName of manifests) {
    const label = manifestName.replace(".manifest.json", "");
    const responsePath = join(options.responseDir, `${label}.jsonl`);
    if (!(await Bun.file(responsePath).exists())) {
      result.missing.push(label);
      continue;
    }
    try {
      const one = await collectCommentSweepVerdicts({
        manifestPath: join(options.batchDir, manifestName),
        outPath: options.outPath,
        responsePath,
      });
      result.accepted.push(label);
      result.rowsWritten += one.rowsWritten;
    } catch (error) {
      result.rejected.push({
        batch: label,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

interface JudgeResponse {
  confidence?: number;
  criterion?: string;
  id: string;
  ordering?: string;
  reason?: string;
  rewrite?: string;
  verdict?: string;
}

function toLedgerRow(
  block: CommentSweepBlock,
  candidate: CommentSweepCandidate,
  response: JudgeResponse,
): Record<string, unknown> {
  const base = {
    confidence: response.confidence ?? 0,
    context_hash: candidate.context_hash,
    file: candidate.file,
    kind: candidate.kind satisfies CommentSweepCandidateKind,
    line: candidate.line,
    reason: response.reason,
    text: candidate.text,
    tier: candidate.tier satisfies CommentSweepTier,
  };

  if (block === "E") {
    // Block E returns a property, so the rewrite is derived here and never model-authored.
    if (response.ordering === "none") {
      return {
        ...base,
        rewrite: candidate.text.replace(/^(\s*\*\s*)\d+[a-z]?\./, "$1-"),
        verdict: "rewrite",
      };
    }
    return { ...base, verdict: "keep" };
  }

  if (block === "D") {
    return { ...base, rewrite: response.rewrite, verdict: "rewrite" };
  }

  // Only the line-comment rubrics name a KEEP criterion. Carrying it into the ledger is what
  // makes "deleted while asserting a criterion applies" auditable as a distinct defect.
  if (response.criterion === undefined) {
    return { ...base, verdict: response.verdict };
  }
  return { ...base, criterion: response.criterion, verdict: response.verdict };
}

function renderPrompt(
  preamble: string,
  rubric: string,
  block: CommentSweepBlock,
  groups: BatchGroup[],
): string {
  const unit = block === "E" ? "LIST" : "COMMENT";
  const envelope = [
    preamble,
    "",
    rubric,
    "",
    "BATCH MODE",
    `You are given ${groups.length} independent items below, separated by lines of ===.`,
    "Judge every item on its own. Earlier items must not influence later ones.",
    "",
    "Output one JSON object per item, one per line, in the order given.",
    'Each object MUST include its item\'s "id" verbatim, copied exactly as shown.',
    `Output exactly ${groups.length} objects. No markdown fence, no commentary, no blank lines.`,
    "Never invent, merge, split, reorder, or omit an item.",
    "",
    `Each item below carries ID, ${unit}, and CONTEXT.`,
    "",
  ].join("\n");

  return `${envelope}${groups.map((group) => group.prompt).join("")}`;
}

async function buildRowGroups(
  repoRoot: string,
  candidates: CommentSweepCandidate[],
  contextLines: number,
  cache: Map<string, string[]>,
): Promise<BatchGroup[]> {
  const groups: BatchGroup[] = [];

  for (const candidate of candidates) {
    // Rows carrying a manual_review marker belong to a block-level rubric. Judging one
    // with the per-line delete/keep rubric can return `delete` on a documentation line
    // that its own block never permits deleting.
    if (candidate.manual_review) {
      continue;
    }
    const lines = await readSource(repoRoot, candidate.file, cache);
    if (lines[candidate.line - 1]?.trim() !== candidate.text.trim()) {
      continue;
    }
    const start = Math.max(0, candidate.line - 1 - contextLines);
    const end = Math.min(lines.length, candidate.line + contextLines);
    const context = lines.slice(start, end).join("\n");
    const id = createId(candidate);
    groups.push({
      id,
      members: [candidate],
      prompt: [
        "===",
        `ID: ${id}`,
        `COMMENT: ${candidate.text.trim()}`,
        "CONTEXT:",
        context,
        "",
      ].join("\n"),
    });
  }

  return groups;
}

async function buildListGroups(
  repoRoot: string,
  candidates: CommentSweepCandidate[],
  cache: Map<string, string[]>,
): Promise<BatchGroup[]> {
  const byBlock = new Map<string, CommentSweepCandidate[]>();

  for (const candidate of candidates) {
    if (candidate.manual_review !== "jsdoc-ordered-list") {
      continue;
    }
    const lines = await readSource(repoRoot, candidate.file, cache);
    if (lines[candidate.line - 1]?.trim() !== candidate.text.trim()) {
      continue;
    }
    const bounds = findJSDocBounds(lines, candidate.line);
    if (!bounds) {
      continue;
    }
    // Keying on the block's own start line keeps one list in one request. A list split
    // across two requests produces contradictory verdicts on the same block.
    const key = `${candidate.file}:${bounds.start}`;
    const bucket = byBlock.get(key);
    if (bucket) {
      bucket.push(candidate);
      continue;
    }
    byBlock.set(key, [candidate]);
  }

  const groups: BatchGroup[] = [];
  for (const [key, members] of byBlock) {
    const [, startText] = key.split(/:(?=\d+$)/);
    const lines = await readSource(repoRoot, members[0].file, cache);
    const bounds = findJSDocBounds(lines, Number(startText) + 1);
    if (!bounds) {
      continue;
    }
    const id = createId(members[0]);
    groups.push({
      id,
      members,
      prompt: [
        "===",
        `ID: ${id}`,
        "LIST:",
        lines.slice(bounds.start, bounds.end + 1).join("\n"),
        "CONTEXT:",
        lines.slice(bounds.end + 1, bounds.end + 6).join("\n"),
        "",
      ].join("\n"),
    });
  }

  return groups;
}

function findJSDocBounds(
  lines: string[],
  oneBasedLine: number,
): { end: number; start: number } | undefined {
  let start = oneBasedLine - 1;
  while (start >= 0 && !JSDOC_OPEN_PATTERN.test(lines[start])) {
    if (start < oneBasedLine - 1 && JSDOC_CLOSE_PATTERN.test(lines[start])) {
      return undefined;
    }
    start -= 1;
  }
  if (start < 0) {
    return undefined;
  }

  let end = oneBasedLine - 1;
  while (end < lines.length && !JSDOC_CLOSE_PATTERN.test(lines[end])) {
    end += 1;
  }
  return end < lines.length ? { end, start } : undefined;
}

function createId(candidate: CommentSweepCandidate): string {
  // Opaque rather than sequential: a judge that loses its place can plausibly fabricate
  // r001..rNNN, but cannot fabricate a hash, so the round-trip check stays meaningful.
  return createHash("sha256")
    .update(`${candidate.file}\0${candidate.line}\0${candidate.tier}`)
    .digest("hex")
    .slice(0, ID_LENGTH);
}

function assertUniqueIds(groups: BatchGroup[]): void {
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) {
      throw new Error(
        `Duplicate batch id ${group.id}; widen ID_LENGTH in commentSweepBatch.ts`,
      );
    }
    seen.add(group.id);
  }
}

function parseResponses(text: string): JudgeResponse[] {
  const responses: JudgeResponse[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        `Response line ${index + 1} is not JSON: ${trimmed.slice(0, 80)}`,
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error(`Response line ${index + 1} has no string id`);
    }
    responses.push(parsed as JudgeResponse);
  }
  return responses;
}

async function readCandidates(
  path: string,
): Promise<CommentSweepCandidate[]> {
  const text = await Bun.file(path).text();
  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CommentSweepCandidate);
}

async function readSource(
  repoRoot: string,
  file: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const hit = cache.get(file);
  if (hit) {
    return hit;
  }
  // Must match the scanner's split exactly, or every line of a CRLF file carries a
  // trailing \r and the drift check rejects the entire file as changed.
  const lines = (await Bun.file(resolve(repoRoot, file)).text()).split(/\r?\n/);
  cache.set(file, lines);
  return lines;
}

async function extractBlock(
  promptsPath: string,
  block: CommentSweepBlock | "A",
): Promise<string> {
  const file = Bun.file(promptsPath);
  if (!(await file.exists())) {
    throw new Error(
      `Judge prompts not found at ${promptsPath}. plans/ is gitignored; pass --prompts.`,
    );
  }
  const text = await file.text();
  const heading = new RegExp(`^## Block ${block} `, "m");
  const match = heading.exec(text);
  if (!match) {
    throw new Error(`No "## Block ${block}" heading in ${promptsPath}`);
  }
  const fence = /```text\n([\s\S]*?)```/.exec(text.slice(match.index));
  if (!fence) {
    throw new Error(`Block ${block} has no text fence in ${promptsPath}`);
  }
  return fence[1].trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function resolvePath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function parseCliArgs(args: string[]): {
  mode: "collect-dir" | "collect" | "render";
  values: Record<string, string>;
} {
  const values: Record<string, string> = {};
  let mode: "collect-dir" | "collect" | "render" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--render" ||
      argument === "--collect" ||
      argument === "--collect-dir"
    ) {
      mode = (argument === "--collect-dir" ? "collect-dir" : argument.slice(2)) as
        | "collect-dir"
        | "collect"
        | "render";
      continue;
    }
    if (argument.startsWith("--")) {
      values[argument.slice(2)] = args[++index] ?? "";
    }
  }

  if (!mode) {
    throw new Error("Pass --render, --collect, or --collect-dir");
  }
  return { mode, values };
}

if (import.meta.main) {
  const { mode, values } = parseCliArgs(Bun.argv.slice(2));

  if (mode === "render") {
    const block = (values.block ?? "B") as CommentSweepBlock;
    if (!["B", "B2", "C", "D", "E"].includes(block)) {
      throw new Error("--block must be one of B, B2, C, D, E");
    }
    const result = await renderCommentSweepBatches({
      block,
      contextLines: values.context ? Number(values.context) : undefined,
      ledgerPath: values.ledger ?? "",
      outDir: values.out ?? "",
      promptsPath: values.prompts,
      size: values.size ? Number(values.size) : undefined,
    });
    console.log(
      `Rendered ${result.batches} batch(es): ${result.groups} request(s) covering ${result.rows} in-scope row(s). ${result.driftSkipped} skipped as drifted.`,
    );
  } else if (mode === "collect-dir") {
    const result = await collectCommentSweepDirectory({
      batchDir: values.batches ?? "",
      outPath: values.out ?? "",
      responseDir: values.responses ?? "",
    });
    console.log(
      `Accepted ${result.accepted.length} batch(es), ${result.rowsWritten} row(s).`,
    );
    if (result.missing.length > 0) {
      console.log(`No response yet: ${result.missing.join(", ")}`);
    }
    for (const { batch, reason } of result.rejected) {
      console.error(`REJECTED ${batch}: ${reason}`);
    }
    if (result.rejected.length > 0) {
      process.exitCode = 1;
    }
  } else {
    const result = await collectCommentSweepVerdicts({
      manifestPath: values.manifest ?? "",
      outPath: values.out ?? "",
      responsePath: values.response ?? "",
    });
    console.log(`Wrote ${result.rowsWritten} ledger row(s).`);
  }
}
