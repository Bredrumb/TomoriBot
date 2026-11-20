#!/usr/bin/env bun
import { Glob } from "bun";
import { readFile, writeFile } from "node:fs/promises";

const ROOTS = ["src", "tests"];
// Prefix-only patterns (no end boundary) catch compound identifiers like
// `tomoriIdForError`, `tomoriId1`, `tomoriIds`, `targetTomoriIdLookup`.
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\btargetTomoriId/g, "targetPersonaId"],
  [/\btomoriId/g, "personaId"],
];

let totalReplacements = 0;
let touchedFiles = 0;

for (const root of ROOTS) {
  const glob = new Glob("**/*.ts");
  for await (const rel of glob.scan({ cwd: root })) {
    const path = `${root}/${rel}`;
    const before = await readFile(path, "utf8");
    let after = before;
    let fileHits = 0;
    for (const [pat, repl] of REPLACEMENTS) {
      const matches = after.match(pat);
      if (matches) {
        fileHits += matches.length;
        after = after.replace(pat, repl);
      }
    }
    if (fileHits > 0) {
      await writeFile(path, after);
      console.log(`  ${path}: ${fileHits} replacements`);
      totalReplacements += fileHits;
      touchedFiles += 1;
    }
  }
}

console.log(`\nDone: ${totalReplacements} replacements across ${touchedFiles} files.`);
