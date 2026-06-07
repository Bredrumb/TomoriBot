/**
 * One-time script: strips .md / .mdx extensions from internal relative links
 * in docs files so they route correctly in Starlight (e.g. ./foo.md → ./foo).
 *
 * Run from repo root: bun run scripts/devtools/fixDocLinks.ts
 */

import { join } from "node:path";

const docsDir = join(import.meta.dir, "../../docs");
const glob = new Bun.Glob("**/*.md");

let fixed = 0;
let skipped = 0;

for await (const rel of glob.scan(docsDir)) {
  const filePath = join(docsDir, rel);
  const original = await Bun.file(filePath).text();

  // Match markdown links: [text](./path/to/file.md) or [text](../path.mdx)
  // Only strip .md/.mdx when the link is clearly a relative path (starts with ./ or ../)
  const updated = original.replace(
    /(\[.*?\])\((\.\.?\/[^)]*?)\.mdx?\)/g,
    "$1($2)",
  );

  if (updated === original) {
    skipped++;
    continue;
  }

  await Bun.write(filePath, updated);
  console.log(`  [~] ${rel}`);
  fixed++;
}

console.log(`\nDone. ${fixed} files updated, ${skipped} unchanged.`);
