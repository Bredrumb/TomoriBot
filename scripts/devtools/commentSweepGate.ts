const TYPESCRIPT_PATH_PATTERN = /\.tsx?$/i;
const decoder = new TextDecoder();

export interface CommentSweepGateDifference {
  afterExcerpt: string;
  beforeExcerpt: string;
  column: number;
  line: number;
}

export type CommentSweepGateResult =
  | { status: "equal" }
  | {
      difference: CommentSweepGateDifference;
      status: "different";
    }
  | {
      message: string;
      side: "after" | "before";
      status: "parse-error";
    };

/**
 * Compares two TypeScript sources after Bun removes comments and type syntax.
 */
export function compareTypeScriptSources(
  before: string,
  after: string,
): CommentSweepGateResult {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  let beforeOutput: string;
  let afterOutput: string;

  try {
    beforeOutput = transpiler.transformSync(before);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      side: "before",
      status: "parse-error",
    };
  }

  try {
    afterOutput = transpiler.transformSync(after);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      side: "after",
      status: "parse-error",
    };
  }

  if (beforeOutput === afterOutput) {
    return { status: "equal" };
  }

  return {
    difference: findDifference(beforeOutput, afterOutput),
    status: "different",
  };
}

function findDifference(
  before: string,
  after: string,
): CommentSweepGateDifference {
  const sharedLength = Math.min(before.length, after.length);
  let offset = 0;

  while (offset < sharedLength && before[offset] === after[offset]) {
    offset++;
  }

  const beforeStart = before.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const afterStart = after.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const beforeEnd = nextLineEnd(before, offset);
  const afterEnd = nextLineEnd(after, offset);

  return {
    afterExcerpt: after.slice(afterStart, afterEnd),
    beforeExcerpt: before.slice(beforeStart, beforeEnd),
    column: offset - beforeStart + 1,
    line: countLines(before, offset),
  };
}

function nextLineEnd(value: string, offset: number): number {
  const lineEnd = value.indexOf("\n", offset);
  return lineEnd === -1 ? value.length : lineEnd;
}

function countLines(value: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (value[index] === "\n") {
      line++;
    }
  }
  return line;
}

function runGit(args: string[]): {
  exitCode: number;
  stderr: string;
  stdout: Uint8Array;
} {
  const process = Bun.spawnSync({
    cmd: ["git", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: process.exitCode,
    stderr: decoder.decode(process.stderr).trim(),
    stdout: process.stdout,
  };
}

function assertValidReference(reference: string): void {
  const result = runGit(["rev-parse", "--verify", `${reference}^{commit}`]);
  if (result.exitCode !== 0) {
    throw new Error(`Invalid before reference "${reference}": ${result.stderr}`);
  }
}

function listScopedFiles(
  reference: string,
  staged: boolean,
  pathspecs: string[],
): string[] {
  const args = staged
    ? ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACDMRT"]
    : ["diff", "--name-only", "-z", "--diff-filter=ACDMRT", reference];

  if (pathspecs.length > 0) {
    args.push("--", ...pathspecs);
  }

  const result = runGit(args);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to list files: ${result.stderr}`);
  }

  return decoder
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path.length > 0 && TYPESCRIPT_PATH_PATTERN.test(path))
    .sort();
}

function readGitSource(specifier: string): string | undefined {
  const result = runGit(["show", specifier]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return decoder.decode(result.stdout);
}

async function readWorkingTreeSource(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  return file.text();
}

function formatDifference(
  path: string,
  result: Extract<CommentSweepGateResult, { status: "different" }>,
): string {
  const { difference } = result;
  return [
    `FAIL ${path}:${difference.line}:${difference.column}`,
    `  before | ${difference.beforeExcerpt}`,
    `  after  | ${difference.afterExcerpt}`,
  ].join("\n");
}

async function main(): Promise<number> {
  const [referenceArgument, ...pathspecs] = Bun.argv.slice(2);
  if (!referenceArgument) {
    console.error(
      "Usage: bun run scripts/devtools/commentSweepGate.ts <before-ref|--staged> [globs...]",
    );
    return 2;
  }

  const staged = referenceArgument === "--staged";
  const reference = staged ? "HEAD" : referenceArgument;
  assertValidReference(reference);

  const paths = listScopedFiles(reference, staged, pathspecs);
  let failures = 0;

  for (const path of paths) {
    const before = readGitSource(`${reference}:${path}`);
    const after = staged
      ? readGitSource(`:${path}`)
      : await readWorkingTreeSource(path);

    if (before === undefined || after === undefined) {
      console.error(
        `FAIL ${path}: file ${before === undefined ? "did not exist before" : "does not exist after"}`,
      );
      failures++;
      continue;
    }

    const result = compareTypeScriptSources(before, after);
    if (result.status === "equal") {
      continue;
    }

    failures++;
    if (result.status === "parse-error") {
      console.error(`FAIL ${path}: ${result.side} parse failed: ${result.message}`);
    } else {
      console.error(formatDifference(path, result));
    }
  }

  if (failures > 0) {
    console.error(
      `Comment sweep gate failed: ${failures}/${paths.length} file(s) rejected.`,
    );
    return 1;
  }

  console.log(`Comment sweep gate passed: ${paths.length} file(s).`);
  return 0;
}

if (import.meta.main) {
  const exitCode = await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Comment sweep gate error: ${message}`);
    return 2;
  });
  process.exit(exitCode);
}
