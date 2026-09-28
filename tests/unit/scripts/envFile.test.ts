import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedFromExample } from "../../../scripts/lib/envFile";

test("setup repairs an empty .env directory without deleting its contents", () => {
  const root = mkdtempSync(join(tmpdir(), "tomori-env-file-"));
  const example = join(root, ".env.example");
  const destination = join(root, ".env");

  try {
    writeFileSync(example, "DISCORD_TOKEN=placeholder\n");
    mkdirSync(destination);
    expect(seedFromExample(example, destination)).toBe(true);
    expect(readFileSync(destination, "utf-8")).toBe("DISCORD_TOKEN=placeholder\n");

    rmSync(destination);
    mkdirSync(destination);
    writeFileSync(join(destination, "keep.txt"), "keep");
    expect(() => seedFromExample(example, destination)).toThrow("non-empty directory");
    expect(readFileSync(join(destination, "keep.txt"), "utf-8")).toBe("keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
