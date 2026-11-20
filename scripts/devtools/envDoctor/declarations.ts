import { isEnvName } from "./policy";
import { stripQuotes } from "./textUtils";
import type { DeclarationLayer, DeclarationSite } from "./types";

const ENTRY_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const COMMENT_DEFAULT_PATTERN = /\bdefaults?(?:\s+is|\s*:)\s*("[^"]*"|'[^']*'|[^\s,;)]+)/i;

/**
 * Parses an `.env`-style example file into declarations. The comment block directly above an
 * entry (no blank line between) is the only one searched for a `default:` note, because a section
 * banner's prose describes the whole section rather than one value.
 */
export function parseExampleFile(file: string, text: string, layer: DeclarationLayer): DeclarationSite[] {
  const declarations: DeclarationSite[] = [];
  const lines = text.split(/\r?\n/);
  let tier: string | undefined;
  let section: string | undefined;
  let pendingComment: string[] = [];
  let inBanner = false;
  let awaitingBannerTitle = false;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      pendingComment = [];
      continue;
    }
    if (/^#{5,}$/.test(line)) {
      inBanner = !inBanner;
      awaitingBannerTitle = inBanner;
      pendingComment = [];
      continue;
    }
    if (line.startsWith("#")) {
      const body = line.replace(/^#+\s?/, "");
      if (inBanner) {
        if (awaitingBannerTitle) {
          tier = body;
          section = undefined;
          awaitingBannerTitle = false;
        }
        continue;
      }
      if (line.startsWith("## ")) {
        section = line.slice(3).trim();
        pendingComment = [];
        continue;
      }
      pendingComment.push(body);
      continue;
    }

    const match = ENTRY_PATTERN.exec(line);
    if (match && isEnvName(match[1])) {
      const commentDefault = findCommentDefault(pendingComment);
      declarations.push({
        name: match[1],
        file,
        line: index + 1,
        layer,
        value: stripQuotes(match[2].trim()),
        ...(commentDefault !== undefined ? { commentDefault } : {}),
        ...(tier ? { tier } : {}),
        ...(section ? { section } : {}),
      });
    }
    pendingComment = [];
  }
  return declarations;
}

function findCommentDefault(comment: string[]): string | undefined {
  for (const line of comment) {
    const match = COMMENT_DEFAULT_PATTERN.exec(line);
    if (match) {
      return stripQuotes(match[1].replace(/\.$/, ""));
    }
  }
  return undefined;
}

/**
 * Returns only the variable names in a live `.env`. Each value is discarded on the line it is
 * found, so no code path after this function can print, log, or serialize one.
 */
export function parseLiveEnvKeys(text: string): string[] {
  const names = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const name = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name) {
      names.add(name);
    }
  }
  return [...names].sort();
}
