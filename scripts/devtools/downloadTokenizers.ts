/**
 * @file download-tokenizers.ts
 * @description Downloads tokenizer assets from HuggingFace for the logit-bias system.
 *
 * Usage:
 *   bun run setup:tokenizers                     # Download missing families
 *   bun run setup:tokenizers --force             # Re-download all families
 *   bun run setup:tokenizers --family gemma3     # Download a specific family only
 *   HF_TOKEN=hf_xxx bun run setup:tokenizers    # Use HuggingFace auth token (required for gated models)
 *
 * Gated Models:
 *   Most tokenizer repos require accepting a HuggingFace license agreement and a PAT.
 *   Without HF_TOKEN, gated repos return 401/403 and the family is skipped with a warning.
 *
 * Exit codes:
 *   0 — all families downloaded (or already present)
 *   1 — one or more families failed or were access-denied
 */

import * as path from "node:path";
import * as fs from "node:fs";

// ─── Types ─────────────────────────────────────────────────────────────────

interface TokenizerFamily {
  repo: string;
  files: string[];
}

interface Manifest {
  version: number;
  families: Record<string, TokenizerFamily>;
}

type FamilyResult = "ok" | "skipped" | "access-denied" | "error";

// ─── Config ─────────────────────────────────────────────────────────────────

const MANIFEST_PATH = path.join(import.meta.dir, "..", "..", "tokenizers", "manifest.json");
const TOKENIZER_BASE_DIR = path.join(import.meta.dir, "..", "..", "tokenizers");
const HF_BASE_URL = "https://huggingface.co";

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes("--force");
const familyFlagIndex = args.indexOf("--family");
const targetFamily = familyFlagIndex !== -1 ? args[familyFlagIndex + 1] : null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds the HuggingFace resolve URL for a specific file in a repo.
 * @param repo - HuggingFace repo identifier (e.g. "google/gemma-3-4b-pt")
 * @param file - File name within the repo root (e.g. "tokenizer.json")
 */
function buildHfUrl(repo: string, file: string): string {
  return `${HF_BASE_URL}/${repo}/resolve/main/${file}`;
}

/**
 * Checks whether all required files for a family already exist on disk and
 * are non-empty. Returns true only if every file passes.
 */
function isFamilyComplete(familyName: string, files: string[]): boolean {
  for (const file of files) {
    const filePath = path.join(TOKENIZER_BASE_DIR, familyName, file);
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return false;
  }
  return true;
}

/**
 * Downloads a single file from HuggingFace to the destination path.
 * Streams the response body directly to disk via Bun.write() to avoid
 * buffering large tokenizer files in memory.
 *
 * @param url     - Full HuggingFace resolve URL
 * @param destPath - Absolute path to write the downloaded file
 * @param hfToken  - Optional HuggingFace PAT for gated model access
 * @returns "ok" | "access-denied" | "error"
 */
async function downloadFile(
  url: string,
  destPath: string,
  hfToken: string | undefined,
): Promise<"ok" | "access-denied" | "error"> {
  const headers: Record<string, string> = {};
  if (hfToken) {
    headers.Authorization = `Bearer ${hfToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    console.error(`  ✗ Network error fetching ${url}: ${err}`);
    return "error";
  }

  if (response.status === 401 || response.status === 403) {
    return "access-denied";
  }

  if (!response.ok) {
    console.error(`  ✗ HTTP ${response.status} for ${url}`);
    return "error";
  }

  // 1. Ensure the parent directory exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // 2. Stream response body to disk — Bun.write() accepts a Response directly
  try {
    await Bun.write(destPath, response);
  } catch (err) {
    console.error(`  ✗ Write error for ${destPath}: ${err}`);
    return "error";
  }

  // 3. Verify the written file is non-empty
  const stat = fs.statSync(destPath);
  if (stat.size === 0) {
    console.error(`  ✗ Written file is empty: ${destPath}`);
    fs.unlinkSync(destPath);
    return "error";
  }

  return "ok";
}

/**
 * Prints the HuggingFace access-denied guidance for a gated model family.
 * @param familyName - The tokenizer family name (e.g. "gemma3")
 * @param repo       - The HuggingFace repo path (e.g. "google/gemma-3-4b-pt")
 * @param hasToken   - Whether HF_TOKEN was provided in the environment
 */
function printAccessDeniedGuide(familyName: string, repo: string, hasToken: boolean): void {
  if (hasToken) {
    console.warn(`  ⚠ ${familyName}: access denied — your HF_TOKEN may not have access to this repo.`);
    console.warn(`    Accept the model license at: ${HF_BASE_URL}/${repo}`);
    console.warn(`    Then re-run: bun run setup:tokenizers`);
  } else {
    console.warn(`  ⚠ ${familyName}: access denied — this model requires a HuggingFace access token.`);
    console.warn(`    1. Create a token at: https://huggingface.co/settings/tokens`);
    console.warn(`    2. Accept the model license at: ${HF_BASE_URL}/${repo}`);
    console.warn(`    3. Set HF_TOKEN and re-run: HF_TOKEN=hf_xxx bun run setup:tokenizers`);
  }
}

/**
 * Downloads all files for a single tokenizer family.
 * Skips the family entirely if complete and --force is not set.
 *
 * @param familyName - Key from manifest (e.g. "gemma3")
 * @param family     - Family config with repo + files list
 * @param hfToken    - Optional HuggingFace PAT
 * @returns The result status for this family
 */
async function downloadFamily(
  familyName: string,
  family: TokenizerFamily,
  hfToken: string | undefined,
): Promise<FamilyResult> {
  // 1. Skip if all files are already present (unless --force)
  if (!force && isFamilyComplete(familyName, family.files)) {
    console.log(`  ✓ ${familyName}: already complete, skipping`);
    return "skipped";
  }

  console.log(`  ↓ ${familyName} (${family.repo})`);

  // 2. Download each file in the family
  for (const file of family.files) {
    const url = buildHfUrl(family.repo, file);
    const destPath = path.join(TOKENIZER_BASE_DIR, familyName, file);

    // Skip individual files that exist and are non-empty (unless --force)
    if (!force && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      console.log(`    ✓ ${file}: already exists`);
      continue;
    }

    console.log(`    ↓ ${file}...`);
    const result = await downloadFile(url, destPath, hfToken);

    if (result === "access-denied") {
      // 3. On access denied: print guidance and abort this family
      printAccessDeniedGuide(familyName, family.repo, !!hfToken);
      return "access-denied";
    }

    if (result === "error") {
      console.error(`    ✗ Failed to download ${file} for ${familyName}`);
      return "error";
    }

    const stat = fs.statSync(destPath);
    console.log(`    ✓ ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  return "ok";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load manifest
  const manifestRaw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const manifest: Manifest = JSON.parse(manifestRaw);

  const hfToken = process.env.HF_TOKEN;

  console.log("=".repeat(50));
  console.log("Downloading Tokenizers...");
  console.log("=".repeat(50));

  if (hfToken) {
    console.log("HF_TOKEN is set — gated model access enabled");
  } else {
    console.log("HF_TOKEN not set — open repos only (gated models will be skipped)");
  }

  if (force) console.log("--force: re-downloading all families");
  if (targetFamily) console.log(`--family: downloading only '${targetFamily}'`);

  console.log("");

  // 2. Determine which families to process
  const familiesToProcess = targetFamily ? { [targetFamily]: manifest.families[targetFamily] } : manifest.families;

  if (targetFamily && !manifest.families[targetFamily]) {
    console.error(`Unknown family: '${targetFamily}'`);
    console.error(`Available families: ${Object.keys(manifest.families).join(", ")}`);
    process.exit(1);
  }

  // 3. Download each family, collecting results
  const results: Record<string, FamilyResult> = {};

  for (const [familyName, family] of Object.entries(familiesToProcess)) {
    results[familyName] = await downloadFamily(familyName, family, hfToken);
  }

  // 4. Print summary
  console.log("");
  console.log("=".repeat(50));
  console.log("Summary");
  console.log("=".repeat(50));

  const ok = Object.entries(results).filter(([, r]) => r === "ok");
  const skipped = Object.entries(results).filter(([, r]) => r === "skipped");
  const denied = Object.entries(results).filter(([, r]) => r === "access-denied");
  const errors = Object.entries(results).filter(([, r]) => r === "error");

  if (ok.length > 0) console.log(`  ✓ Downloaded: ${ok.map(([n]) => n).join(", ")}`);
  if (skipped.length > 0) console.log(`  - Skipped (complete): ${skipped.map(([n]) => n).join(", ")}`);
  if (denied.length > 0) console.warn(`  ⚠ Access denied: ${denied.map(([n]) => n).join(", ")}`);
  if (errors.length > 0) console.error(`  ✗ Errors: ${errors.map(([n]) => n).join(", ")}`);

  const failed = denied.length + errors.length;

  if (failed === 0) {
    console.log("");
    console.log("All tokenizer families are ready.");
    process.exit(0);
  } else {
    console.log("");
    console.error(`${failed} family/families failed. See warnings above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
