/**
 * Tracked media size check.
 *
 * Rejects committed image/video/audio assets that exceed a size budget, so large
 * uncompressed art never bloats the repo or ships oversized to runtime. The
 * primary target is Default Persona avatar/sprite art under the seed catalog
 * (these get uploaded to Discord on seed), plus bundled assets under assets/img.
 *
 * Historical marketing screenshots under .github/release/** are intentionally
 * NOT scanned because they are immutable release artifacts, not shipped or runtime art.
 *
 * The budget is configurable via MEDIA_SIZE_LIMIT_BYTES (see .env.optional.example).
 * Run `bun run compress-media` to losslessly shrink offenders in place.
 *
 * Exits non-zero if any in-scope media file exceeds the budget.
 *
 * Usage:
 *   bun run check-media-size
 *   bun run scripts/checks/checkMediaSize.ts
 */
import { config } from "dotenv";
import { formatBytes, listInScopeMedia, resolveLimitBytes, SCOPE_PREFIXES } from "../lib/media";

config({ quiet: true });

function main(): void {
  const limit = resolveLimitBytes();

  const offenders = listInScopeMedia().filter((file) => file.size > limit);

  // Report. Persona art is listed first and tagged, since it ships to Discord.
  if (offenders.length > 0) {
    offenders.sort((a, b) => Number(b.isPersona) - Number(a.isPersona) || b.size - a.size);
    console.error(
      `[check-media-size] ${offenders.length} tracked media file(s) exceed the ${formatBytes(limit)} budget:`,
    );
    for (const { path, size, isPersona } of offenders) {
      const tag = isPersona ? " (Default Persona art — ships to Discord)" : "";
      console.error(`  - ${path} — ${formatBytes(size)}${tag}`);
    }
    console.error(
      "\n  Run `bun run compress-media` to shrink these in place (lossless re-encode, downscaling oversized art to fit).",
    );
    console.error(`  Scanned scopes: ${SCOPE_PREFIXES.join(", ")}`);
    process.exit(1);
  }

  console.log(`[check-media-size] all tracked media under ${formatBytes(limit)} OK`);
}

main();
