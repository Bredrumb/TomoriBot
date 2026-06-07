/**
 * One-time script: injects `title` frontmatter into every docs/*.md file
 * that doesn't already have it, derived from the first # heading.
 *
 * Run from repo root: bun run scripts/devtools/addDocsFrontmatter.ts
 */

import { join } from "node:path";

const docsDir = join(import.meta.dir, "../../docs");
const glob = new Bun.Glob("**/*.md");

let added = 0;
let skipped = 0;

for await (const rel of glob.scan(docsDir)) {
  const filePath = join(docsDir, rel);
  const content = await Bun.file(filePath).text();

  // Already has frontmatter
  if (content.startsWith("---")) {
    skipped++;
    continue;
  }

  // Extract first H1
  const h1Match = content.match(/^#\s+(.+)/m);
  if (!h1Match) {
    console.warn(`  [skip] No H1 found: ${rel}`);
    skipped++;
    continue;
  }

  // Strip leading "N. " numbering (e.g. "3. Architecture Overview" → "Architecture Overview")
  const title = h1Match[1].trim().replace(/^\d+\.\s+/, "");

  await Bun.write(filePath, `---\ntitle: "${title}"\n---\n\n${content}`);
  console.log(`  [+] ${rel} → "${title}"`);
  added++;
}

console.log(`\nDone. ${added} files updated, ${skipped} already had frontmatter or no H1.`);
