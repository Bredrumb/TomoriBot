import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { Glob } from "bun";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("source text encoding", () => {
  // Guard against raw NUL bytes because tsc and Biome accept them while rg and git grep silently skip NUL-bearing
  // files as binary.
  it("keeps raw NUL bytes out of TypeScript sources", async () => {
    const offenders: string[] = [];
    for await (const path of new Glob("{src,tests,scripts}/**/*.{ts,tsx}").scan({ cwd: REPO_ROOT })) {
      const bytes = await Bun.file(resolve(REPO_ROOT, path)).bytes();
      if (bytes.includes(0)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
