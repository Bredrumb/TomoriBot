// Removes shared preset images left behind by the retired
// `presets/{lineage}/{language}/...` storage layout. Preset art does not vary by locale, so that
// layout stored one identical copy per authored locale; the current layout is
// `presets/{lineage}/...`. Run this once, AFTER a startup re-seed has written the language-free
// copies and repointed the DB rows.
//
// Local filesystem only. Production objects live in GCS/S3 and are not touched.

import { readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DISCORD_LOCALES } from "@/constants/locales";

const PRESET_ROOT = path.join(process.cwd(), "data", "avatars", "presets");
const LOCALE_SEGMENTS = new Set<string>(DISCORD_LOCALES);

interface Candidate {
  /** Absolute path of the file under the retired per-language layout. */
  legacyPath: string;
  /** Absolute path its bytes should also live at under the current layout. */
  currentPath: string;
  bytes: number;
}

async function listPngFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listPngFiles(full)));
    else if (entry.name.endsWith(".png")) files.push(full);
  }
  return files;
}

async function hashOf(filePath: string): Promise<string> {
  return createHash("sha1")
    .update(await readFile(filePath))
    .digest("hex");
}

/**
 * Pairs each legacy file with the current-layout path holding the same image.
 *
 * A legacy path is `presets/{lineage}/{locale}/[sprites/]{file}`; dropping the locale segment gives
 * the current path. Anything already language-free is skipped rather than reported.
 */
async function collectCandidates(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const legacyPath of await listPngFiles(PRESET_ROOT)) {
    const segments = path.relative(PRESET_ROOT, legacyPath).split(path.sep);
    const [, localeSegment] = segments;
    if (!localeSegment || !LOCALE_SEGMENTS.has(localeSegment)) continue;
    const currentPath = path.join(PRESET_ROOT, ...segments.filter((_, index) => index !== 1));
    candidates.push({ legacyPath, currentPath, bytes: (await stat(legacyPath)).size });
  }
  return candidates;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const candidates = await collectCandidates();

  if (candidates.length === 0) {
    console.log("No per-language preset assets found. Nothing to prune.");
    return;
  }

  const deletable: Candidate[] = [];
  const blocked: Array<{ candidate: Candidate; reason: string }> = [];
  for (const candidate of candidates) {
    const replacement = await stat(candidate.currentPath).catch(() => null);
    if (!replacement) {
      blocked.push({ candidate, reason: "no language-free counterpart (re-seed first)" });
      continue;
    }
    // Byte equality, not just presence: pruning on filename alone would discard the only copy of an
    // image whose counterpart happens to share a name but not its content.
    if ((await hashOf(candidate.legacyPath)) !== (await hashOf(candidate.currentPath))) {
      blocked.push({ candidate, reason: "counterpart content differs" });
      continue;
    }
    deletable.push(candidate);
  }

  const asMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  console.log(
    `Per-language preset images : ${candidates.length} (${asMb(candidates.reduce((sum, c) => sum + c.bytes, 0))} MB)`,
  );
  console.log(
    `Verified duplicates        : ${deletable.length} (${asMb(deletable.reduce((sum, c) => sum + c.bytes, 0))} MB)`,
  );
  console.log(`Kept, needs attention      : ${blocked.length}`);
  for (const { candidate, reason } of blocked.slice(0, 20)) {
    console.log(`  ${path.relative(process.cwd(), candidate.legacyPath)}  <- ${reason}`);
  }
  if (blocked.length > 20) console.log(`  ... and ${blocked.length - 20} more`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to delete the verified duplicates.");
    return;
  }
  if (blocked.length > 0) {
    console.log("\nRefusing to delete while any file is unverified. Re-seed, then re-run.");
    process.exitCode = 1;
    return;
  }

  for (const candidate of deletable) await rm(candidate.legacyPath, { force: true });
  // The locale directories are empty once their files are gone; drop them so a later run sees a
  // clean tree rather than an empty per-language skeleton.
  for (const lineage of await readdir(PRESET_ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!lineage.isDirectory()) continue;
    for (const child of await readdir(path.join(PRESET_ROOT, lineage.name), { withFileTypes: true })) {
      if (child.isDirectory() && LOCALE_SEGMENTS.has(child.name)) {
        await rm(path.join(PRESET_ROOT, lineage.name, child.name), { recursive: true, force: true });
      }
    }
  }
  console.log(
    `\nDeleted ${deletable.length} duplicate images, reclaiming ${asMb(deletable.reduce((sum, c) => sum + c.bytes, 0))} MB.`,
  );
}

await main();
