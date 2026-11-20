import { join } from "node:path";

const docsDir = join(import.meta.dir, "../../docs");
const glob = new Bun.Glob("**/*.md");

let fixed = 0;
let skipped = 0;

for await (const rel of glob.scan(docsDir)) {
  const filePath = join(docsDir, rel);
  const original = await Bun.file(filePath).text();

  const updated = original.replace(/(\[.*?\])\((\.\.?\/[^)]*?)\.mdx?\)/g, "$1($2)");

  if (updated === original) {
    skipped++;
    continue;
  }

  await Bun.write(filePath, updated);
  console.log(`  [~] ${rel}`);
  fixed++;
}

console.log(`\nDone. ${fixed} files updated, ${skipped} unchanged.`);
