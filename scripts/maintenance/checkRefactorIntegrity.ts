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
  return knownLargeImplementationPaths.has(file.repoPath);
}

function isKnownFacadeTarget(file: SourceFile): boolean {
  return knownFacadeTargetPaths.has(file.repoPath) || file.repoPath.endsWith(".legacy.ts");
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
