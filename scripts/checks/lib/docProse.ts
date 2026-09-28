import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const DOC_PROSE_DEFAULT_PATHS = ["docs/en/contributing"];
export const DOC_PROSE_RULES_PATH = ".agents/skills/lint-prose/SKILL.md";
const SLOP_GUARD_CONFIG_PATH = ".agents/skills/lint-prose/slop-guard.jsonl";
// Pinned because the engine's word and phrase lists are code, not config: an upgrade can change
// what the calibrated rule set reports without any file in this repository changing.
const SLOP_GUARD_PACKAGE = "slop-guard==0.5.0";

/**
 * The `lint-prose` rule each kept slop-guard rule enforces. The config file keeps only these;
 * the structural and density rules were dropped in calibration because they penalize the
 * checklists and tables the contributor guides are meant to use.
 */
const ENGINE_RULE_IDS: Record<string, number | undefined> = {
  slop_word: 5,
  slop_phrase: 20,
  tone: 29,
  weasel: 2,
  ai_disclosure: undefined,
  placeholder: undefined,
  setup_resolution: 29,
  closing_aphorism: 4,
  copula_chain: 6,
  contrast_pair: 7,
};

// The engine's word list is not configurable. `lint-prose` rule 12 allows these where the term is
// literal, and every calibration hit on them was literal ("the DB test harness").
const ALLOWED_ENGINE_WORDS = new Set(["harness"]);

/** Plain-word and filler patterns from `lint-prose` rules 6, 11, and 20 that the engine lacks. */
const REPO_PATTERNS: Array<{ ruleId: number; pattern: RegExp; advice: string }> = [
  { ruleId: 20, pattern: /\bin order to\b/gi, advice: 'Write "to".' },
  { ruleId: 20, pattern: /\bdue to the fact that\b/gi, advice: 'Write "because".' },
  { ruleId: 20, pattern: /\bit is (?:worth|important to) not(?:e|ing)\b/gi, advice: "Delete the preamble." },
  { ruleId: 11, pattern: /\butiliz(?:e|es|ed|ing|ation)\b/gi, advice: 'Write "use".' },
  { ruleId: 11, pattern: /\bfacilitat(?:e|es|ed|ing)\b/gi, advice: 'Write "help" or name the action.' },
  { ruleId: 11, pattern: /\bin the event that\b/gi, advice: 'Write "if".' },
  { ruleId: 6, pattern: /\b(?:serves|stands) as\b/gi, advice: 'Write "is".' },
];

export interface DocProseFinding {
  file: string;
  /** Absent for a whole-page finding such as a copula chain. */
  line?: number;
  rule: string;
  ruleId?: number;
  match: string;
  advice?: string;
}

export interface DocProseResult {
  filesChecked: number;
  findings: DocProseFinding[];
  /** False when `uvx` is missing, so only the repository patterns ran. */
  engineRan: boolean;
}

interface EngineViolation {
  rule: string;
  match: string;
  context: string;
  start: number;
  end: number;
}

interface EngineResult {
  source: string;
  violations: EngineViolation[];
  advice: string[];
}

/**
 * Audits Markdown prose against the calibrated `lint-prose` rule set.
 *
 * @param repoRoot - Repository root that `paths` and the engine config resolve against.
 * @param paths - Markdown files or directories to scan.
 */
export async function auditDocProse(repoRoot: string, paths: string[]): Promise<DocProseResult> {
  const files = await collectMarkdownFiles(repoRoot, paths);
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(file, await readFile(resolve(repoRoot, file), "utf8"));
  }

  const findings: DocProseFinding[] = [];
  for (const [file, source] of sources) {
    findings.push(...collectRepoPatternFindings(file, source));
  }

  const uvx = Bun.which("uvx");
  if (uvx && files.length > 0) {
    findings.push(...(await runEngine(uvx, repoRoot, files, sources)));
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0));
  return { filesChecked: files.length, findings, engineRan: Boolean(uvx) };
}

/**
 * Scans one Markdown source for the repository patterns, skipping code.
 */
export function collectRepoPatternFindings(file: string, source: string): DocProseFinding[] {
  const prose = maskMarkdownCode(source);
  const findings: DocProseFinding[] = [];
  for (const { ruleId, pattern, advice } of REPO_PATTERNS) {
    for (const match of prose.matchAll(pattern)) {
      findings.push({
        file,
        line: lineAt(prose, match.index ?? 0),
        rule: "plain_words",
        ruleId,
        match: match[0],
        advice,
      });
    }
  }
  return findings;
}

/**
 * Blanks fenced blocks and inline code spans while keeping every offset and line number intact.
 */
export function maskMarkdownCode(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank).replace(/`[^`\n]+`/g, blank);
}

async function runEngine(
  uvx: string,
  repoRoot: string,
  files: string[],
  sources: Map<string, string>,
): Promise<DocProseFinding[]> {
  const proc = Bun.spawn(
    [uvx, "--quiet", "--from", SLOP_GUARD_PACKAGE, "sg", "--json", "--config", SLOP_GUARD_CONFIG_PATH, ...files],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Without --threshold the engine exits 0 whatever it finds, so any non-zero exit is a crash.
  if (exitCode !== 0) {
    throw new Error(`slop-guard exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const parsed = JSON.parse(stdout) as EngineResult | EngineResult[];
  const results = Array.isArray(parsed) ? parsed : [parsed];
  const findings: DocProseFinding[] = [];
  for (const result of results) {
    const file = normalizePath(result.source);
    const source = sources.get(file) ?? "";
    for (const violation of result.violations) {
      if (violation.rule === "slop_word" && ALLOWED_ENGINE_WORDS.has(violation.match.toLowerCase())) {
        continue;
      }
      const isSpan = violation.end - violation.start < source.length;
      findings.push({
        file,
        line: isSpan ? lineAt(source, violation.start) : undefined,
        rule: violation.rule,
        ruleId: ENGINE_RULE_IDS[violation.rule],
        match: isSpan ? violation.match : violation.context,
      });
    }
  }
  return findings;
}

async function collectMarkdownFiles(repoRoot: string, paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    const absolute = resolve(repoRoot, path);
    const info = await stat(absolute);
    if (info.isFile()) {
      files.add(normalizePath(relative(repoRoot, absolute)));
      continue;
    }
    for await (const match of new Bun.Glob("**/*.{md,mdx}").scan({ cwd: absolute })) {
      files.add(normalizePath(relative(repoRoot, resolve(absolute, match))));
    }
  }
  return [...files].sort();
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
