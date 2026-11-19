import { existsSync, statSync } from "node:fs";
import { spawnSync } from "bun";

export const DEFAULT_LIMIT_BYTES = 1024 * 1024;

// Long-edge cap in pixels (px): applied only when a file must be downscaled to fit the budget.
export const DEFAULT_MAX_DIMENSION = 768;

export const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "ico",
  "avif",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
]);

export const SCOPE_PREFIXES = ["src/db/seed/catalog/personas/", "assets/img/"];

export const PERSONA_PREFIX = "src/db/seed/catalog/personas/";

// Intentionally excluded from SCOPE_PREFIXES because release cards are web showcase art outside the 1 MB gate, though
// compress-media still normalizes them to WebP.
export const RELEASE_PREFIX = ".github/release/";

export const DEFAULT_RELEASE_WEBP_QUALITY = 90;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function listTrackedFiles(): string[] {
  // -z gives NUL-separated paths so spaces/quoting never corrupt the list.
  const result = spawnSync(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

export function listUntrackedInScopePaths(prefixes: string[]): string[] {
  // Pass prefixes as pathspecs so git lists untracked non-ignored files without a repo-wide walk.
  const result = spawnSync(["git", "ls-files", "--others", "--exclude-standard", "-z", "--", ...prefixes], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files --others failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

export type MediaFile = { path: string; size: number; isPersona: boolean };

// Untracked non-ignored files are included alongside tracked ones so newly added art is caught by the gate before it
// is committed.
export function listInScopeMedia(): MediaFile[] {
  const tracked = listTrackedFiles().filter(
    (path) => SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) && MEDIA_EXTENSIONS.has(extensionOf(path)),
  );
  const untracked = listUntrackedInScopePaths(SCOPE_PREFIXES).filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)));

  // Merge, deduplicate by path (a file staged but not committed appears in both).
  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, size: statSync(path).size, isPersona: path.startsWith(PERSONA_PREFIX) }));
}

export type CompressStrategy = "lossless-fit" | "release-card";

export type CompressTarget = MediaFile & { strategy: CompressStrategy };

export function listCompressTargets(): CompressTarget[] {
  const isInScope = (path: string) =>
    SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.startsWith(RELEASE_PREFIX);

  const tracked = listTrackedFiles().filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)) && isInScope(path));
  // Include untracked files across both gate scopes and release cards so new art can be compressed before commit.
  const untracked = listUntrackedInScopePaths([...SCOPE_PREFIXES, RELEASE_PREFIX]).filter((path) =>
    MEDIA_EXTENSIONS.has(extensionOf(path)),
  );

  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({
      path,
      size: statSync(path).size,
      isPersona: path.startsWith(PERSONA_PREFIX),
      strategy: (path.startsWith(RELEASE_PREFIX) ? "release-card" : "lossless-fit") as CompressStrategy,
    }));
}
