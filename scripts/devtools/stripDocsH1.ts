/**
 * One-time script: removes the first # heading from docs files that already
 * have frontmatter, since Starlight renders the frontmatter title as the H1.
 *
 * Run from repo root: bun run scripts/devtools/stripDocsH1.ts
 */

import { join } from "node:path";

const docsDir = join(import.meta.dir, "../../docs");
const glob = new Bun.Glob("**/*.md");

let stripped = 0;
let skipped = 0;

for await (const rel of glob.scan(docsDir)) {
  const filePath = join(docsDir, rel);
  const content = await Bun.file(filePath).text();

  if (!content.startsWith("---")) {
    skipped++;
    continue;
  }

  // Find the end of the frontmatter block
  const closingDash = content.indexOf("---", 3);
  if (closingDash === -1) {
    skipped++;
    continue;
  }

  const afterFrontmatter = content.slice(closingDash + 3);

  // Remove the first # heading (and any blank lines immediately before it)
  const stripped_body = afterFrontmatter.replace(/^\s*\n#[^\n]*\n/, "\n");

  if (stripped_body === afterFrontmatter) {
    skipped++;
    continue;
  }

  await Bun.write(filePath, content.slice(0, closingDash + 3) + stripped_body);
  console.log(`  [-] ${rel}`);
  stripped++;
}

console.log(`\nDone. ${stripped} H1s removed, ${skipped} files skipped.`);
