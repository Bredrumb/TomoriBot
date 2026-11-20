import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { Glob } from "bun";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("source text encoding", () => {
  // rg and git grep classify a file containing a raw NUL byte as binary and skip it silently, which
  // hides every match in that file from code search and review diffs. No gate catches it: tsc and
  // Biome both accept the byte.
  it("keeps raw NUL bytes out of TypeScript sources", async () => {
    const offenders: string[] = [];
    for await (const path of new Glob("{src,tests,scripts}/**/*.{ts,tsx}").scan({ cwd: REPO_ROOT })) {
      const bytes = await Bun.file(resolve(REPO_ROOT, path)).bytes();
      if (bytes.includes(0)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
