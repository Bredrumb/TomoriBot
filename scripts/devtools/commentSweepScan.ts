import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import * as ts from "typescript";

const DEFAULT_PATHS = ["src", "scripts", "tests", "apps"];
// Two shapes, both anchored to the comment head. The dotted form (`5.`, `1.5.`) requires a
// trailing dot so version strings like `1.2.3 changed this` never match. The bare form
// (`5.1 Check`) has no trailing dot, so it needs an inner dot plus a capitalized next word
// to stay clear of `12 minutes out` and `2.5 hours out`.
// Case-sensitive deliberately: an `i` flag would let the capital lookahead match lowercase.
const NUMBERED_INDEX = String.raw`(?:\d+(?:\.\d+)*[a-zA-Z]?\.(?:\s+|$)|\d+\.\d+[a-zA-Z]?\s+(?=[A-Z]))`;
const NUMBERED_LINE_PATTERN = new RegExp(String.raw`^(\/\/\s*)${NUMBERED_INDEX}`);
const NUMBERED_JSDOC_PATTERN = new RegExp(String.raw`^(\s*\*\s*)${NUMBERED_INDEX}`);

// Both rule patterns are case-sensitive and shape-anchored. A loose /rule \d+/i also
// matches prose citing an instruction file, which is rationale rather than scaffolding.
const RULE_HEAD_PATTERN =
  /^(\/\/|\*)(\s*)Rule\s*\d+(?:\s*(?:,|&|and)\s*\d+)*\s*[:,]?\s*/;
const RULE_TAG_PATTERN =
  /\s*\(\s*Rule\s*\d+(?:\s*(?:,|&|and)\s*\d+)*\s*\)/g;

// Stateless counterparts, since RULE_TAG_PATTERN is global and `test` would advance it.
const RULE_HEAD_TEST = /^(?:\/\/|\*)\s*Rule\s*\d+/;
const RULE_TAG_TEST = /\(\s*Rule\s*\d+/;
const DASH_PATTERN = /—|–| -- /;
const JSDOC_TAG_PATTERN = /^\s*\*\s+@(param|returns?)\b/;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "get",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "set",
  "that",
  "the",
  "this",
  "to",
  "use",
  "with",
]);

export type CommentSweepTier = "1" | "2" | "2b" | "2c";
export type CommentSweepCandidateKind = "jsdoc-tag" | "line";
export type CommentSweepTierOneOperation =
  | "delete-commented-code"
  | "normalize-block"
  | "strip-numbering"
  | "strip-rule";

export interface CommentSweepCandidate {
  context_hash: string;
  file: string;
  kind: CommentSweepCandidateKind;
  line: number;
  manual_review?: "jsdoc-ordered-list";
  mech_score: number;
  operation?: CommentSweepTierOneOperation;
  text: string;
  tier: CommentSweepTier;
}

export interface CommentSweepScanOptions {
  paths?: string[];
  repoRoot?: string;
  tiers?: CommentSweepTier[];
}

interface CommentToken {
  endLine: number;
  jsdoc: boolean;
  kind: "block" | "line";
  line: number;
  standalone: boolean;
  text: string;
}

/**
 * Extracts comment-sweep candidates and their drift/scoring metadata.
 */
export async function scanCommentSweepCandidates(
  options: CommentSweepScanOptions = {},
): Promise<CommentSweepCandidate[]> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const paths = options.paths?.length ? options.paths : DEFAULT_PATHS;
  const tiers = new Set<CommentSweepTier>(
    options.tiers ?? ["1", "2", "2b", "2c"],
  );
  const files = await discoverTypeScriptFiles(repoRoot, paths);
  const candidates: CommentSweepCandidate[] = [];

  for (const absolutePath of files) {
    const source = await Bun.file(absolutePath).text();
    assertParseable(source, relative(repoRoot, absolutePath));
    candidates.push(
      ...scanSource(
        source,
        normalizePath(relative(repoRoot, absolutePath)),
        tiers,
      ),
    );
  }

  return candidates.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.tier.localeCompare(right.tier),
  );
}

/**
 * Removes a leading `5.` or `11b.` step index from a line or JSDoc comment.
 */
export function stripCommentNumbering(text: string): string {
  if (text.startsWith("//")) {
    return text.replace(NUMBERED_LINE_PATTERN, "$1");
  }
  return text.replace(NUMBERED_JSDOC_PATTERN, "$1");
}

/**
 * Removes `Rule N` prompt scaffolding and any step index, preserving all other prose.
 *
 * Returns a bare comment marker when the comment held nothing else, which the applier
 * treats as a whole-line deletion.
 */
export function stripRuleArtifact(text: string): string {
  const withoutTag = text.replace(RULE_TAG_PATTERN, "");
  const withoutHead = withoutTag.replace(RULE_HEAD_PATTERN, "$1$2");
  return stripCommentNumbering(withoutHead);
}

/**
 * Hashes the five normalized source lines immediately below a candidate.
 */
export function createCommentSweepContextHash(
  lines: string[],
  oneBasedLine: number,
): string {
  const context = lines.slice(oneBasedLine, oneBasedLine + 5).join("\n");
  return createHash("sha256").update(context).digest("hex");
}

function assertParseable(source: string, path: string): void {
  try {
    new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: TypeScript parse failed: ${message}`);
  }
}

async function discoverTypeScriptFiles(
  repoRoot: string,
  paths: string[],
): Promise<string[]> {
  const discovered = new Set<string>();

  for (const input of paths) {
    const absoluteInput = isAbsolute(input) ? input : resolve(repoRoot, input);
    const inputStat = await stat(absoluteInput).catch(() => undefined);

    if (inputStat?.isFile()) {
      if (/\.tsx?$/i.test(absoluteInput)) {
        discovered.add(resolve(absoluteInput));
      }
      continue;
    }

    if (inputStat?.isDirectory()) {
      const glob = new Bun.Glob("**/*.ts");
      for await (const path of glob.scan({
        absolute: true,
        cwd: absoluteInput,
        onlyFiles: true,
      })) {
        if (!isExcludedPath(path)) {
          discovered.add(resolve(path));
        }
      }
      continue;
    }

    const glob = new Bun.Glob(normalizePath(input));
    for await (const path of glob.scan({
      absolute: true,
      cwd: repoRoot,
      onlyFiles: true,
    })) {
      if (/\.tsx?$/i.test(path) && !isExcludedPath(path)) {
        discovered.add(resolve(path));
      }
    }
  }

  return [...discovered].sort();
}

function isExcludedPath(path: string): boolean {
  return /(?:^|[\\/])(?:\.git|dist|node_modules)(?:[\\/]|$)/.test(path);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function scanSource(
  source: string,
  file: string,
  tiers: Set<CommentSweepTier>,
): CommentSweepCandidate[] {
  const lines = source.split(/\r?\n/);
  const comments = collectCommentTokens(source);
  const protection = findCommentProtection(comments, file);
  const commentedCodeIndexes = findCommentedCodeIndexes(comments, file);
  const candidates: CommentSweepCandidate[] = [];

  comments.forEach((comment, index) => {
    if (protection.full.has(index)) {
      return;
    }

    if (protection.numberingOnly.has(index)) {
      if (tiers.has("1")) {
        candidates.push(
          ...createNumberingOnlyCandidates(comment, file, lines),
        );
      }
      return;
    }

    if (tiers.has("1")) {
      const tierOne = createTierOneCandidates(
        comment,
        index,
        commentedCodeIndexes,
        file,
        lines,
      );
      candidates.push(...tierOne);
    }

    if (tiers.has("2") && comment.kind === "line" && comment.standalone) {
      candidates.push(createCandidate(comment, "2", "line", file, lines));
    }

    if (comment.kind === "block" && comment.jsdoc) {
      candidates.push(
        ...createJSDocCandidates(comment, file, lines, tiers),
      );
    }

    if (
      tiers.has("2c") &&
      comment.kind === "line" &&
      DASH_PATTERN.test(comment.text)
    ) {
      candidates.push(createCandidate(comment, "2c", "line", file, lines));
    }
  });

  return deduplicateCandidates(candidates);
}

function collectCommentTokens(source: string): CommentToken[] {
  const sourceFile = ts.createSourceFile(
    "scan.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const ranges = new Map<string, ts.CommentRange>();

  const addRanges = (found: ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      ranges.set(`${range.pos}:${range.end}`, range);
    }
  };
  const addStandaloneMatches = (
    pattern: RegExp,
    kind:
      | ts.SyntaxKind.MultiLineCommentTrivia
      | ts.SyntaxKind.SingleLineCommentTrivia,
  ): void => {
    for (const match of source.matchAll(pattern)) {
      const text = match[1];
      if (match.index === undefined || text === undefined) {
        continue;
      }
      const pos = match.index + match[0].indexOf(text);
      const end = pos + text.length;
      ranges.set(`${pos}:${end}`, {
        end,
        hasTrailingNewLine: true,
        kind,
        pos,
      });
    }
  };

  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(source, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(source, node.getEnd()));
    node.forEachChild(visit);
  };

  visit(sourceFile);
  addRanges(ts.getLeadingCommentRanges(source, sourceFile.end));
  addStandaloneMatches(
    /^[\t ]*(\/\/[^\r\n]*)/gm,
    ts.SyntaxKind.SingleLineCommentTrivia,
  );
  addStandaloneMatches(
    /^[\t ]*(\/\*(?!\*)[^\r\n]*\*\/)[\t ]*$/gm,
    ts.SyntaxKind.MultiLineCommentTrivia,
  );
  addStandaloneMatches(
    /^[\t ]*(\/\*\*[\s\S]*?^[\t ]*\*\/)/gm,
    ts.SyntaxKind.MultiLineCommentTrivia,
  );

  return [...ranges.values()]
    .sort((left, right) => left.pos - right.pos)
    .map((range) => {
      const start = range.pos;
      const end = range.end;
      const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
      const endLocation = sourceFile.getLineAndCharacterOfPosition(end);
      const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const prefix = source.slice(lineStart, start);
      const text = source.slice(start, end);

      return {
        endLine: endLocation.line + 1,
        jsdoc: text.startsWith("/**"),
        kind:
          range.kind === ts.SyntaxKind.SingleLineCommentTrivia
            ? "line"
            : "block",
        line: startLocation.line + 1,
        standalone: prefix.trim().length === 0,
        text,
      };
    });
}

interface CommentProtection {
  full: Set<number>;
  numberingOnly: Set<number>;
}

/**
 * Splits protected comments by how much protection they need.
 *
 * Locale-example comments are guarded because deleting one flips its key to unused
 * (README hazard 1). Stripping a step index leaves the key text byte-identical, so it
 * stays permitted; every other transform on them does not.
 */
function findCommentProtection(
  comments: CommentToken[],
  file: string,
): CommentProtection {
  const full = new Set<number>();
  const numberingOnly = new Set<number>();
  const suppressionIndexes: number[] = [];

  comments.forEach((comment, index) => {
    if (/biome-ignore|@ts-expect-error/.test(comment.text)) {
      full.add(index);
      suppressionIndexes.push(index);
      return;
    }
    if (isLicenseHeader(comment) || isKnownCodeExample(file, comment.text)) {
      full.add(index);
      return;
    }
    if (isLocaleScannerExample(file, comment.text)) {
      numberingOnly.add(index);
    }
  });

  for (const index of suppressionIndexes) {
    const current = comments[index];
    const previous = comments[index - 1];
    if (
      !hasSuppressionExplanation(current.text) &&
      previous &&
      current.line - previous.endLine <= 1
    ) {
      full.add(index - 1);
      numberingOnly.delete(index - 1);
    }
  }

  return { full, numberingOnly };
}

function hasSuppressionExplanation(text: string): boolean {
  return (
    /biome-ignore[^:\r\n]*:\s*\S/.test(text) ||
    /@ts-expect-error\s+\S/.test(text)
  );
}

function isLicenseHeader(comment: CommentToken): boolean {
  return (
    comment.line <= 10 && /\b(?:copyright|license|SPDX-License-Identifier)\b/i.test(comment.text)
  );
}

function isLocaleScannerExample(file: string, text: string): boolean {
  return (
    file === "scripts/checks/checkLocalizationKeys.ts" &&
    /localizer|localizeWithAliases|commands\.|genai\./.test(text)
  );
}

function isKnownCodeExample(file: string, text: string): boolean {
  return (
    file === "tests/unit/checks/mockModuleSurface.test.ts" &&
    text.includes('mock.module("@/utils/misc/logger"')
  );
}

function findCommentedCodeIndexes(
  comments: CommentToken[],
  file: string,
): Set<number> {
  const indexes = new Set<number>();
  let group: number[] = [];

  const flush = (): void => {
    if (group.length === 0) {
      return;
    }
    const bodies = group.map((index) => stripLineComment(comments[index].text));
    if (bodies.some(looksLikeStrongCode)) {
      group.forEach((index, offset) => {
        if (
          looksLikeStrongCode(bodies[offset]) ||
          looksLikeCodeContinuation(bodies[offset])
        ) {
          indexes.add(index);
        }
      });
    }
    group = [];
  };

  comments.forEach((comment, index) => {
    if (comment.kind !== "line" || !comment.standalone) {
      flush();
      return;
    }

    const previousIndex = group.at(-1);
    const previous =
      previousIndex === undefined ? undefined : comments[previousIndex];
    if (previous && comment.line - previous.endLine > 1) {
      flush();
    }
    group.push(index);
  });
  flush();

  if (file === "scripts/checks/checkLocalizationKeys.ts") {
    for (const index of indexes) {
      if (isLocaleScannerExample(file, comments[index].text)) {
        indexes.delete(index);
      }
    }
  }

  return indexes;
}

function stripLineComment(text: string): string {
  return text.replace(/^\/\/\s*/, "").trim();
}

function looksLikeStrongCode(value: string): boolean {
  return (
    /^(?:import|export|const|let|var)\s/.test(value) ||
    /^return(?:\s+.+|;)$/.test(value) ||
    /^case\s+.+:$/.test(value) ||
    /^[{}[\](),]+[;,]?$/.test(value) ||
    /^[a-z_$][\w$]*\s*:\s*\[\[/.test(value) ||
    /^[a-z_$][\w$]*\s*:\s*(?:["'][^"']*["']|`[^`]*`)[,;]$/.test(value) ||
    /^[a-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*(?:\.[\w$]+(?:\([^)]*\))?)*[,;]$/.test(
      value,
    ) ||
    /^[a-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$.]*\(.+\)[,;]$/.test(value) ||
    /^[a-z_$][\w$]*\s*:\s*(?:\{|\w+\()$/.test(value) ||
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\(.*\);$/.test(value)
  );
}

function looksLikeCodeContinuation(value: string): boolean {
  return (
    /^["'`].*[,;]$/.test(value) ||
    /^[{}[\](),]+[;,]?$/.test(value) ||
    /^[a-z_$][\w$]*\s*:\s*.+[,;{]$/.test(value)
  );
}

function createTierOneCandidates(
  comment: CommentToken,
  index: number,
  commentedCodeIndexes: Set<number>,
  file: string,
  lines: string[],
): CommentSweepCandidate[] {
  if (
    comment.kind === "line" &&
    isRuleArtifact(file, comment.text)
  ) {
    return [
      {
        ...createCandidate(comment, "1", "line", file, lines),
        operation: "strip-rule",
      },
    ];
  }

  if (commentedCodeIndexes.has(index)) {
    return [
      {
        ...createCandidate(comment, "1", "line", file, lines),
        operation: "delete-commented-code",
      },
    ];
  }

  if (comment.kind === "line" && NUMBERED_LINE_PATTERN.test(comment.text)) {
    return [
      {
        ...createCandidate(comment, "1", "line", file, lines),
        operation: "strip-numbering",
      },
    ];
  }

  if (comment.kind === "block" && !comment.jsdoc && !comment.text.includes("\n")) {
    if (isRuleArtifact(file, comment.text)) {
      return [
        {
          ...createCandidate(comment, "1", "line", file, lines),
          operation: "strip-rule",
        },
      ];
    }
    return [
      {
        ...createCandidate(comment, "1", "line", file, lines),
        operation: "normalize-block",
      },
    ];
  }

  if (comment.kind === "block" && comment.jsdoc) {
    return createRuleBlockCandidates(comment, file, lines);
  }

  return [];
}

/**
 * Yields the only transform a partially protected comment may receive.
 *
 * JSDoc numbering is excluded because it is no longer deterministic (Tier 2 judges it),
 * and routing a protected comment into a judgment tier would reopen the locale-scanner
 * hazard that the protection exists to close.
 */
function createNumberingOnlyCandidates(
  comment: CommentToken,
  file: string,
  lines: string[],
): CommentSweepCandidate[] {
  if (comment.kind !== "line" || !NUMBERED_LINE_PATTERN.test(comment.text)) {
    return [];
  }

  return [
    {
      ...createCandidate(comment, "1", "line", file, lines),
      operation: "strip-numbering",
    },
  ];
}

function createRuleBlockCandidates(
  comment: CommentToken,
  file: string,
  lines: string[],
): CommentSweepCandidate[] {
  if (file === "scripts/checks/lib/textPreviewAudit.ts") {
    return [];
  }

  return comment.text.split(/\r?\n/).flatMap((text, offset) => {
    const trimmed = text.trimStart();
    if (!RULE_HEAD_TEST.test(trimmed) && !RULE_TAG_TEST.test(trimmed)) {
      return [];
    }
    return [
      {
        ...createCandidateFromLine(
          trimmed,
          comment.line + offset,
          "1",
          "line",
          file,
          lines,
        ),
        operation: "strip-rule" as const,
      },
    ];
  });
}

function isRuleArtifact(file: string, text: string): boolean {
  return (
    (RULE_HEAD_TEST.test(text) || RULE_TAG_TEST.test(text)) &&
    file !== "scripts/checks/lib/textPreviewAudit.ts"
  );
}

/**
 * Yields numbered JSDoc lines as Tier 2 judgment rows rather than Tier 1 transforms.
 *
 * Measured across the repository, every one of these is a block-level ordered list, not
 * narration above the statement it describes. Several encode fallback precedence or
 * attempt order, so dropping the ordinal changes meaning and collapses the rendered
 * hover into one paragraph. Neither outcome satisfies Tier 1's lossless property.
 */
function createNumberedJSDocCandidates(
  comment: CommentToken,
  file: string,
  lines: string[],
): CommentSweepCandidate[] {
  return comment.text.split(/\r?\n/).flatMap((text, offset) => {
    if (!NUMBERED_JSDOC_PATTERN.test(text)) {
      return [];
    }
    return [
      {
        ...createCandidateFromLine(
          text.trimStart(),
          comment.line + offset,
          "2",
          "line",
          file,
          lines,
        ),
        manual_review: "jsdoc-ordered-list" as const,
      },
    ];
  });
}

function createJSDocCandidates(
  comment: CommentToken,
  file: string,
  lines: string[],
  tiers: Set<CommentSweepTier>,
): CommentSweepCandidate[] {
  const candidates: CommentSweepCandidate[] = tiers.has("2")
    ? createNumberedJSDocCandidates(comment, file, lines)
    : [];

  comment.text.split(/\r?\n/).forEach((text, offset) => {
    const trimmed = text.trimStart();
    const line = comment.line + offset;
    if (tiers.has("2b") && JSDOC_TAG_PATTERN.test(trimmed)) {
      candidates.push(
        createCandidateFromLine(trimmed, line, "2b", "jsdoc-tag", file, lines),
      );
    }
    if (tiers.has("2c") && DASH_PATTERN.test(trimmed)) {
      candidates.push(
        createCandidateFromLine(trimmed, line, "2c", "line", file, lines),
      );
    }
  });

  return candidates;
}

function createCandidate(
  comment: CommentToken,
  tier: CommentSweepTier,
  kind: CommentSweepCandidateKind,
  file: string,
  lines: string[],
): CommentSweepCandidate {
  return createCandidateFromLine(
    comment.text,
    comment.line,
    tier,
    kind,
    file,
    lines,
  );
}

function createCandidateFromLine(
  text: string,
  line: number,
  tier: CommentSweepTier,
  kind: CommentSweepCandidateKind,
  file: string,
  lines: string[],
): CommentSweepCandidate {
  return {
    context_hash: createCommentSweepContextHash(lines, line),
    file,
    kind,
    line,
    mech_score: calculateMechanicalScore(text, lines, line),
    text,
    tier,
  };
}

function calculateMechanicalScore(
  comment: string,
  lines: string[],
  oneBasedLine: number,
): number {
  const commentWords = wordSet(comment.replace(/^\/\/|^\/?\*+|\*\/$/g, ""));
  if (commentWords.size === 0) {
    return 0;
  }

  const codeLines: string[] = [];
  for (
    let index = oneBasedLine;
    index < lines.length && codeLines.length < 2;
    index++
  ) {
    const value = lines[index].trim();
    if (
      value.length === 0 ||
      value.startsWith("//") ||
      value.startsWith("*") ||
      value.startsWith("/*")
    ) {
      continue;
    }
    codeLines.push(value);
  }

  const codeWords = wordSet(codeLines.join(" "));
  const overlap = [...commentWords].filter((word) => codeWords.has(word)).length;
  return Math.round((overlap / commentWords.size) * 1000) / 1000;
}

function wordSet(value: string): Set<string> {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
  const words = expanded.match(/[a-z][a-z0-9]*/g) ?? [];
  return new Set(words.filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
}

function deduplicateCandidates(
  candidates: CommentSweepCandidate[],
): CommentSweepCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.file}\0${candidate.line}\0${candidate.tier}\0${candidate.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseCliArgs(args: string[]): {
  out: string;
  paths: string[];
  tiers?: CommentSweepTier[];
} {
  let out: string | undefined;
  let tiers: CommentSweepTier[] | undefined;
  const paths: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--out") {
      out = args[++index];
      continue;
    }
    if (argument === "--tier") {
      const tier = args[++index] as CommentSweepTier | undefined;
      if (!tier || !["1", "2", "2b", "2c"].includes(tier)) {
        throw new Error("--tier must be one of 1, 2, 2b, or 2c");
      }
      tiers = [tier];
      continue;
    }
    if (argument === "--paths") {
      paths.push(...args.slice(index + 1));
      break;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!out) {
    throw new Error("--out is required");
  }

  return { out, paths, tiers };
}

async function main(): Promise<number> {
  const { out, paths, tiers } = parseCliArgs(Bun.argv.slice(2));
  const candidates = await scanCommentSweepCandidates({
    paths: paths.length > 0 ? paths : undefined,
    tiers,
  });
  const body = candidates.map((row) => JSON.stringify(row)).join("\n");
  await Bun.write(out, body.length > 0 ? `${body}\n` : "");
  console.log(`Wrote ${candidates.length} candidate(s) to ${out}.`);
  return 0;
}

if (import.meta.main) {
  const exitCode = await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Comment sweep scan failed: ${message}`);
    return 1;
  });
  process.exit(exitCode);
}
