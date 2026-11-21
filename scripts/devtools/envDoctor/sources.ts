import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileKindFor } from "./analyze";
import { parseLiveEnvKeys } from "./declarations";
import type { EnvDoctorInput, SourceFile, UnavailableSurface } from "./types";

const RELEASE_ONLY_ROOTS = ["deploy", "terraform"];
const RELEASE_REFS = ["origin/release", "release"];

function git(root: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

/**
 * Collects scanner input from a checkout. Files come from Git (tracked plus untracked-but-not-ignored),
 * so ignored local material such as Terraform state never enters the scan. Release-only
 * deployment files absent from the checkout are read from a release ref when one exists.
 */
export function loadCheckout(root: string, options: { includeRelease: boolean }): EnvDoctorInput {
  const unavailable: UnavailableSurface[] = [];
  const listing = git(root, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (listing === null) {
    throw new Error("git ls-files failed; run env-doctor from inside the TomoriBot checkout");
  }
  const paths = listing.split("\n").filter((path) => path.length > 0 && fileKindFor(path) !== null);
  const files: SourceFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, text: readFileSync(join(root, path), "utf8") });
    } catch {
      unavailable.push({ surface: path, reason: "listed by git but unreadable (deleted or locked)" });
    }
  }

  let releaseSource: string | null = null;
  const hasReleaseFiles = paths.some((path) => RELEASE_ONLY_ROOTS.some((prefix) => path.startsWith(`${prefix}/`)));
  if (hasReleaseFiles) {
    releaseSource = "checkout";
  } else if (options.includeRelease) {
    const ref = RELEASE_REFS.find(
      (candidate) => git(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]) !== null,
    );
    if (ref) {
      const sha = (git(root, ["rev-parse", "--short", ref]) ?? "").trim();
      const label = `${ref}@${sha}`;
      const releasePaths = (git(root, ["ls-tree", "-r", "--name-only", ref, "--", ...RELEASE_ONLY_ROOTS]) ?? "")
        .split("\n")
        .filter((path) => path.length > 0 && fileKindFor(path) !== null);
      for (const path of releasePaths) {
        const text = git(root, ["show", `${ref}:${path}`]);
        if (text === null) {
          unavailable.push({ surface: `${label}:${path}`, reason: "git show failed" });
        } else {
          files.push({ path, text, origin: label });
        }
      }
      releaseSource = label;
    } else {
      unavailable.push({
        surface: "release deployment files (deploy/, terraform/)",
        reason: "not checked out and no origin/release or release ref exists; RELEASE_ONLY_CONSUMERS is used instead",
      });
    }
  } else {
    unavailable.push({
      surface: "release deployment files (deploy/, terraform/)",
      reason: "skipped by --no-release; RELEASE_ONLY_CONSUMERS is used instead",
    });
  }

  const live = readLiveEnvKeys(join(root, ".env"));
  return { files, liveEnvKeys: live.keys, liveEnvStatus: live.status, unavailable, releaseSource };
}

/** Reads variable names from the live `.env`. A directory or unreadable file is reported, not thrown. */
export function readLiveEnvKeys(path: string): { keys: string[] | null; status: string } {
  try {
    if (!statSync(path).isFile()) {
      return { keys: null, status: ".env exists but is not a regular file" };
    }
    const keys = parseLiveEnvKeys(readFileSync(path, "utf8"));
    return {
      keys,
      status: `.env read for names only (${keys.length} entries; values discarded as each line is parsed)`,
    };
  } catch {
    return { keys: null, status: "no .env in this checkout" };
  }
}
