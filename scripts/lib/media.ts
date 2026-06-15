/**
 * Shared helpers for the tracked-media tooling.
 *
 * Both `check-media-size` (the read-only gate) and `compress-media` (the
 * in-place optimizer) reason about the same set of files and the same byte
 * budget, so the scope definition lives here to keep them in lockstep.
 */
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "bun";

/** Default per-file budget: 1 MiB. Override with MEDIA_SIZE_LIMIT_BYTES. */
export const DEFAULT_LIMIT_BYTES = 1024 * 1024;

/**
 * Resolve the size budget from the environment, falling back to the default.
 * A non-positive or non-numeric override is ignored so a typo never disables the gate.
 */
export function resolveLimitBytes(): number {
  const raw = process.env.MEDIA_SIZE_LIMIT_BYTES;
  if (!raw) return DEFAULT_LIMIT_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT_BYTES;
}

/** Default long-edge cap (px) applied only when a file must be downscaled to fit the budget. */
export const DEFAULT_MAX_DIMENSION = 768;

/**
 * Resolve the downscale cap from the environment, falling back to the default.
 * A non-positive or non-numeric override is ignored so a typo never disables the cap.
 */
export function resolveMaxDimension(): number {
  const raw = process.env.MEDIA_MAX_DIMENSION;
  if (!raw) return DEFAULT_MAX_DIMENSION;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DIMENSION;
}

/** File extensions treated as media (lower-cased, no leading dot). */
export const MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "ico", "avif",
  "mp4", "webm", "mov", "mkv",
  "mp3", "wav", "ogg", "flac", "m4a",
]);

/**
 * Path prefixes (forward-slash, repo-relative) that are in scope for the gate.
 * Anything outside these prefixes is ignored even if it is tracked media.
 */
export const SCOPE_PREFIXES = ["src/db/seed/catalog/personas/", "assets/img/"];

/** Prefix identifying Default Persona art, flagged with extra emphasis in output. */
export const PERSONA_PREFIX = "src/db/seed/catalog/personas/";

/**
 * Prefix for historical release cards. These are NOT in the gate scope (excluded
 * on purpose), but `compress-media` still normalizes them to WebP — they are
 * web-viewed showcase art where WebP wins hugely over PNG.
 */
export const RELEASE_PREFIX = ".github/release/";

/** Default WebP quality used when normalizing release cards. */
export const DEFAULT_RELEASE_WEBP_QUALITY = 90;

/** Resolve the release-card WebP quality from the environment (1-100), else default. */
export function resolveReleaseWebpQuality(): number {
  const raw = process.env.RELEASE_CARD_WEBP_QUALITY;
  if (!raw) return DEFAULT_RELEASE_WEBP_QUALITY;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_RELEASE_WEBP_QUALITY;
}

/** Human-readable byte size, e.g. 1572864 -> "1.50 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Lower-cased extension of a path without the leading dot, or "" if none. */
export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/**
 * List every git-tracked file path (forward-slash, repo-relative). We scan only
 * tracked files so untracked scratch art and node_modules are never flagged.
 */
export function listTrackedFiles(): string[] {
  // -z gives NUL-separated paths so spaces/quoting never corrupt the list.
  const result = spawnSync(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

/**
 * List untracked, non-gitignored file paths within the given scope prefixes
 * (forward-slash, repo-relative). These are files present on disk but not yet
 * staged or committed — `git ls-files` alone misses them entirely.
 */
export function listUntrackedInScopePaths(prefixes: string[]): string[] {
  // --others = untracked files; --exclude-standard = respect .gitignore.
  // Passing the prefixes as pathspecs scopes the output without a repo-wide walk.
  const result = spawnSync(
    ["git", "ls-files", "--others", "--exclude-standard", "-z", "--", ...prefixes],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files --others failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

/** One in-scope tracked media file with its current on-disk size. */
export type MediaFile = { path: string; size: number; isPersona: boolean };

/**
 * Return every tracked or untracked (non-ignored) media file inside
 * SCOPE_PREFIXES, with its size. Including untracked files ensures that newly
 * added art is blocked before it is ever committed.
 */
export function listInScopeMedia(): MediaFile[] {
  const tracked = listTrackedFiles().filter(
    (path) => SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) && MEDIA_EXTENSIONS.has(extensionOf(path)),
  );
  const untracked = listUntrackedInScopePaths(SCOPE_PREFIXES).filter((path) =>
    MEDIA_EXTENSIONS.has(extensionOf(path)),
  );

  // Merge, deduplicate by path (a file staged but not committed appears in both).
  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, size: statSync(path).size, isPersona: path.startsWith(PERSONA_PREFIX) }));
}

/** Compression policy for a file: shrink-in-place vs convert-to-WebP. */
export type CompressStrategy = "lossless-fit" | "webp";

/** A media file `compress-media` will act on, tagged with the strategy to apply. */
export type CompressTarget = MediaFile & { strategy: CompressStrategy };

/**
 * Return every tracked or untracked (non-ignored) media file `compress-media`
 * operates on. This is a SUPERSET of the gate scope: gate-scoped files (personas
 * + assets) get "lossless-fit", while release cards get "webp". The gate itself
 * never sees release cards. Untracked files in scope prefixes are included so
 * newly added art can be compressed before it is ever committed.
 */
export function listCompressTargets(): CompressTarget[] {
  const isInScope = (path: string) =>
    SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.startsWith(RELEASE_PREFIX);

  const tracked = listTrackedFiles().filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)) && isInScope(path));
  // Untracked release cards are transient scratch — only scope prefixes matter here.
  const untracked = listUntrackedInScopePaths(SCOPE_PREFIXES).filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)));

  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({
      path,
      size: statSync(path).size,
      isPersona: path.startsWith(PERSONA_PREFIX),
      strategy: (path.startsWith(RELEASE_PREFIX) ? "webp" : "lossless-fit") as CompressStrategy,
    }));
}
