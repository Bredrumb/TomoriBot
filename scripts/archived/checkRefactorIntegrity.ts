import { Glob } from "bun";
import { basename, dirname, relative, resolve } from "node:path";

interface SourceFile {
  absPath: string;
  repoPath: string;
  lineCount: number;
  text: string;
}

interface Finding {
  kind: string;
  sourcePath: string;
  sourceLines: number;
  targetPath?: string;
  targetLines?: number;
  message: string;
}

const args = new Set(Bun.argv.slice(2));
const strict = args.has("--strict");
const allLargeImports = args.has("--all-large-imports");
const rootDir = process.cwd();
const sourceDir = resolve(rootDir, "src");
const largeLineThreshold = readNumberArg("--large-lines", 500);
const thinLineThreshold = readNumberArg("--thin-lines", 120);
const oversizedImplementationNames = new Set(["runtime.ts", "orchestrator.ts", "turnRunner.ts"]);
// Path patterns that indicate the "facade-rename" anti-pattern: a god file moved into
// an internals dumping ground (core/, internals/, _impl/) with a generic *Implementation.ts
// or *Internals.ts name. See docs/refactor/refactor-integrity-audit.md "Facade-rename smell".
const facadeRenamePathPattern = /\/(core|internals|_impl)\/[^/]+(Implementation|Internals)\.ts$/;
const knownLargeImplementationPaths = new Set([
  "src/utils/chat/turnRunner.ts",
  "src/utils/bridges/matrix/runtime.ts",
  "src/utils/discord/interactionHelper.legacy.ts",
  "src/utils/discord/webhookManager.legacy.ts",
  "src/utils/metrics/statusCommandMetrics.ts",
  "src/utils/compaction/compactOrchestrator.ts",
  "src/utils/db/repositoryReadSql.ts",
  "src/utils/db/repositoryWriteSql.ts",
  "src/utils/text/contextBuilder.ts",
  "src/utils/discord/streamOrchestrator.ts",
  // Phase 5.5c facade-rename targets: added so the existing
  // "thin facade to large file" finding fires until they're truly decomposed.
  "src/utils/text/context/core/builderImplementation.ts",
  "src/utils/discord/stream/core/orchestratorImplementation.ts",
  "src/utils/metrics/status/commandImplementation.ts",
]);
const knownFacadeTargetPaths = new Set([
  "src/utils/chat/turnRunner.ts",
  "src/utils/bridges/matrix/runtime.ts",
  "src/utils/discord/interactionHelper.legacy.ts",
  "src/utils/discord/webhookManager.legacy.ts",
  "src/utils/metrics/statusCommandMetrics.ts",
  "src/utils/compaction/compactOrchestrator.ts",
  "src/utils/db/repositoryReadSql.ts",
  "src/utils/db/repositoryWriteSql.ts",
  "src/utils/text/context/core/builderImplementation.ts",
  "src/utils/discord/stream/core/orchestratorImplementation.ts",
  "src/utils/metrics/status/commandImplementation.ts",
]);

function readNumberArg(name: string, defaultValue: number): number {
  const prefix = `${name}=`;
  const arg = Bun.argv.find((value) => value.startsWith(prefix));
  if (!arg) return defaultValue;

  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function toRepoPath(absPath: string): string {
  return relative(rootDir, absPath).replace(/\\/g, "/");
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\n|\r/).length;
}

function extractModuleSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  const fromPattern = /\bfrom\s+["']([^"']+)["']/g;
  const sideEffectImportPattern = /\bimport\s+["']([^"']+)["']/g;

  for (const pattern of [fromPattern, sideEffectImportPattern]) {
    let match = pattern.exec(text);
    while (match !== null) {
      specifiers.add(match[1]);
      match = pattern.exec(text);
    }
  }

  return [...specifiers];
}

function resolveModuleSpecifier(sourceFile: SourceFile, specifier: string, filesByAbsPath: Map<string, SourceFile>) {
  if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) {
    return null;
  }

  const basePath = specifier.startsWith("@/")
    ? resolve(rootDir, "src", specifier.slice(2))
    : resolve(dirname(sourceFile.absPath), specifier);

  const candidates = [basePath, `${basePath}.ts`, resolve(basePath, "index.ts")];
  for (const candidate of candidates) {
    const targetFile = filesByAbsPath.get(candidate);
    if (targetFile) {
      return targetFile;
    }
  }

  return null;
}

function addFinding(findings: Finding[], finding: Finding): void {
  const duplicate = findings.some(
    (existing) =>
      existing.kind === finding.kind &&
      existing.sourcePath === finding.sourcePath &&
      existing.targetPath === finding.targetPath,
  );
  if (!duplicate) {
    findings.push(finding);
  }
}

function isKnownLargeImplementation(file: SourceFile): boolean {
  return knownLargeImplementationPaths.has(file.repoPath) || matchesFacadeRenamePattern(file);
}

function isKnownFacadeTarget(file: SourceFile): boolean {
  return (
    knownFacadeTargetPaths.has(file.repoPath) ||
    file.repoPath.endsWith(".legacy.ts") ||
    matchesFacadeRenamePattern(file)
  );
}

// Catches the "moved a god file into core/<x>Implementation.ts" anti-pattern dynamically,
// so future occurrences are flagged without anyone editing the hardcoded path lists.
// A file that lives at .../{core,internals,_impl}/*{Implementation,Internals}.ts AND is
// >largeLineThreshold lines is treated as an implementation god file for purposes of the
// "thin facade to large file" check.
function matchesFacadeRenamePattern(file: SourceFile): boolean {
  return facadeRenamePathPattern.test(file.repoPath) && file.lineCount > largeLineThreshold;
}

function shouldIgnoreLargeImportTarget(targetFile: SourceFile): boolean {
  return targetFile.repoPath.startsWith("src/types/") || targetFile.repoPath.startsWith("src/locales/");
}

async function loadSourceFiles(): Promise<SourceFile[]> {
  const glob = new Glob("**/*.ts");
  const files: SourceFile[] = [];

  for await (const relativePath of glob.scan({ cwd: sourceDir, onlyFiles: true })) {
    if (relativePath.endsWith(".d.ts")) {
      continue;
    }

    const absPath = resolve(sourceDir, relativePath);
    const text = await Bun.file(absPath).text();
    files.push({
      absPath,
      repoPath: toRepoPath(absPath),
      lineCount: countLines(text),
      text,
    });
  }

  return files;
}

function collectFindings(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const filesByAbsPath = new Map(files.map((file) => [file.absPath, file]));

  for (const file of files) {
    const fileName = basename(file.absPath);

    if (fileName.endsWith(".legacy.ts")) {
      addFinding(findings, {
        kind: "active legacy implementation",
        sourcePath: file.repoPath,
        sourceLines: file.lineCount,
        message: "Active implementation still lives in a .legacy.ts file.",
      });
    }

    if (
      file.lineCount >= largeLineThreshold &&
      (oversizedImplementationNames.has(fileName) || isKnownLargeImplementation(file))
    ) {
      addFinding(findings, {
        kind: "oversized implementation",
        sourcePath: file.repoPath,
        sourceLines: file.lineCount,
        message: `${fileName} exceeds ${largeLineThreshold} lines and is part of the Phase 5.5 integrity audit surface.`,
      });
    }

    const moduleSpecifiers = extractModuleSpecifiers(file.text);
    for (const specifier of moduleSpecifiers) {
      const targetFile = resolveModuleSpecifier(file, specifier, filesByAbsPath);
      if (!targetFile) {
        continue;
      }

      if (
        file.lineCount <= thinLineThreshold &&
        targetFile.lineCount >= largeLineThreshold &&
        !shouldIgnoreLargeImportTarget(targetFile) &&
        (allLargeImports || isKnownFacadeTarget(targetFile))
      ) {
        addFinding(findings, {
          kind: "thin facade to large file",
          sourcePath: file.repoPath,
          sourceLines: file.lineCount,
          targetPath: targetFile.repoPath,
          targetLines: targetFile.lineCount,
          message: `Thin file imports/re-exports a target over ${largeLineThreshold} lines.`,
        });
      }

      if (file.lineCount <= thinLineThreshold && targetFile.repoPath.endsWith(".legacy.ts")) {
        addFinding(findings, {
          kind: "thin facade to legacy file",
          sourcePath: file.repoPath,
          sourceLines: file.lineCount,
          targetPath: targetFile.repoPath,
          targetLines: targetFile.lineCount,
          message: "Thin file delegates to a legacy implementation file.",
        });
      }
    }
  }

  // ── Phase 5.5e check: surviving SQL siblings ──────────────────────────────
  // Any *ReadSql.ts or *WriteSql.ts file anywhere under src/utils/db/ is a
  // regression: all SQL must be inlined as private methods on the owning
  // Repository class. These sibling files were deleted in Phase 5.5e Stage C.
  for (const file of files) {
    if (!file.repoPath.startsWith("src/utils/db/")) continue;
    if (/(?:Read|Write)Sql\.ts$/.test(file.repoPath)) {
      addFinding(findings, {
        kind: "surviving SQL sibling",
        sourcePath: file.repoPath,
        sourceLines: file.lineCount,
        message:
          "SQL sibling file survived Phase 5.5e. Inline its SQL as private methods on the owning Repository class and delete this file.",
      });
    }
  }

  // ── Phase 5.5e check: cohabiting siblings ─────────────────────────────────
  // In src/utils/db/repositories/, every file must be a Repository class,
  // the index barrel, or the IRepository interface. Any other .ts file at
  // that depth is a domain file that leaked into the repository layer.
  const repoDir = "src/utils/db/repositories/";
  const allowedRepoFilenames = /^(index|IRepository|.*Repository)\.ts$/;
  for (const file of files) {
    if (!file.repoPath.startsWith(repoDir)) continue;
    const remainder = file.repoPath.slice(repoDir.length);
    if (remainder.includes("/")) continue;
    if (!allowedRepoFilenames.test(basename(file.absPath))) {
      addFinding(findings, {
        kind: "cohabiting sibling",
        sourcePath: file.repoPath,
        sourceLines: file.lineCount,
        message:
          "Non-repository file found in src/utils/db/repositories/. Fold its domain logic into the owning Repository class or move it to a non-db utility path.",
      });
    }
  }

  return findings.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.kind.localeCompare(b.kind));
}

function printFindings(findings: Finding[]): void {
  console.log(`Refactor integrity scan: ${findings.length} finding(s)`);
  console.log(`Thresholds: thin <= ${thinLineThreshold} lines, large >= ${largeLineThreshold} lines`);

  if (findings.length === 0) {
    return;
  }

  for (const finding of findings) {
    const target = finding.targetPath ? ` -> ${finding.targetPath} (${finding.targetLines ?? "?"} lines)` : "";
    console.log(`\n[${finding.kind}] ${finding.sourcePath} (${finding.sourceLines} lines)${target}`);
    console.log(`  ${finding.message}`);
  }
}

const files = await loadSourceFiles();
const findings = collectFindings(files);
printFindings(findings);

if (strict && findings.length > 0) {
  process.exit(1);
}
