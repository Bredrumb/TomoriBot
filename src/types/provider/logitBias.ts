import { randomUUID } from "node:crypto";
import { z } from "zod";

export const LOGIT_BIAS_MIN = -100;
export const LOGIT_BIAS_MAX = 100;
export const LOGIT_BIAS_TEXT_MAX_LENGTH = 200;
const LOGIT_BIAS_TOKENIZATION_MAX = 16;
const LOGIT_BIAS_TOKEN_ID_MAX = 512;

const LOGIT_BIAS_KIND_VALUES = ["text", "token_id"] as const;
const logitBiasKindSchema = z.enum(LOGIT_BIAS_KIND_VALUES);

function normalizeTokenIds(value: unknown): string[] {
  const source = parseArrayLike(value);
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTokenId of source) {
    const parsedTokenId =
      typeof rawTokenId === "number"
        ? parseNumericTokenId(rawTokenId.toString())
        : typeof rawTokenId === "string"
          ? parseNumericTokenId(rawTokenId)
          : null;

    if (!parsedTokenId || seen.has(parsedTokenId)) continue;
    seen.add(parsedTokenId);
    normalized.push(parsedTokenId);
  }

  return normalized;
}

const logitBiasTokenizationSchema = z.object({
  tokenizer_key: z.string().trim().min(1).max(100),
  token_ids: z.preprocess(
    (value) => normalizeTokenIds(value),
    z.array(z.string().regex(/^\d+$/)).max(LOGIT_BIAS_TOKEN_ID_MAX).default([]),
  ),
});

export type LogitBiasTokenization = z.infer<typeof logitBiasTokenizationSchema>;

export const logitBiasEntrySchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(LOGIT_BIAS_TEXT_MAX_LENGTH),
  value: z.number().min(LOGIT_BIAS_MIN).max(LOGIT_BIAS_MAX),
  kind: logitBiasKindSchema.default("text"),
  tokenizations: z.preprocess(
    (value) => normalizeLogitBiasTokenizations(value),
    z.array(logitBiasTokenizationSchema).max(LOGIT_BIAS_TOKENIZATION_MAX).default([]),
  ),
});

export type LogitBiasEntry = z.infer<typeof logitBiasEntrySchema>;

function parseArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeLogitBiasTokenizations(value: unknown): LogitBiasTokenization[] {
  const tokenizations = parseArrayLike(value);
  const normalized: LogitBiasTokenization[] = [];
  const seen = new Set<string>();

  for (const tokenization of tokenizations) {
    const parsed = logitBiasTokenizationSchema.safeParse(tokenization);
    if (!parsed.success) continue;

    const tokenizerKey = parsed.data.tokenizer_key.trim();
    if (tokenizerKey.length === 0 || seen.has(tokenizerKey)) continue;

    seen.add(tokenizerKey);
    normalized.push({
      tokenizer_key: tokenizerKey,
      token_ids: normalizeTokenIds(parsed.data.token_ids),
    });
  }

  return normalized;
}

export function normalizeLogitBiasEntries(value: unknown): LogitBiasEntry[] {
  const entries = parseArrayLike(value);
  const normalized: LogitBiasEntry[] = [];

  for (const entry of entries) {
    const parsed = logitBiasEntrySchema.safeParse(entry);
    if (!parsed.success) continue;

    const normalizedKind =
      parsed.data.kind === "token_id" || parseNumericTokenId(parsed.data.text) ? "token_id" : "text";

    normalized.push({
      ...parsed.data,
      kind: normalizedKind,
      tokenizations: normalizeLogitBiasTokenizations(parsed.data.tokenizations),
    });
  }

  return normalized;
}

export function parseLogitBiasInputTerms(input: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const rawTerm of input.split(",")) {
    const term = rawTerm.trim();
    if (term.length === 0 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

export function parseLogitBiasValue(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value < LOGIT_BIAS_MIN || value > LOGIT_BIAS_MAX) return null;

  return value;
}

export function mergeLogitBiasEntries(
  existingEntries: LogitBiasEntry[],
  incomingEntries: LogitBiasEntry[],
): {
  entries: LogitBiasEntry[];
  addedCount: number;
  updatedCount: number;
} {
  const mergedEntries = [...existingEntries];
  let addedCount = 0;
  let updatedCount = 0;

  for (const incomingEntry of incomingEntries) {
    const existingIndex = mergedEntries.findIndex((entry) => entry.text === incomingEntry.text);

    if (existingIndex >= 0) {
      const existingEntry = mergedEntries[existingIndex];
      const mergedTokenizations = mergeLogitBiasTokenizations(
        existingEntry.tokenizations ?? [],
        incomingEntry.tokenizations ?? [],
      );

      const nextEntry: LogitBiasEntry = {
        ...existingEntry,
        value: incomingEntry.value,
        kind: incomingEntry.kind,
        tokenizations: mergedTokenizations.tokenizations,
      };

      if (!didLogitBiasEntryChange(existingEntry, nextEntry)) {
        continue;
      }

      mergedEntries[existingIndex] = nextEntry;
      updatedCount++;
      continue;
    }

    mergedEntries.push(incomingEntry);
    addedCount++;
  }

  return {
    entries: mergedEntries,
    addedCount,
    updatedCount,
  };
}

export function buildLogitBiasEntries(terms: string[], value: number): LogitBiasEntry[] {
  return terms.map((term) => ({
    id: randomUUID(),
    text: term,
    value,
    kind: parseNumericTokenId(term) ? "token_id" : "text",
    tokenizations: [],
  }));
}

export function formatLogitBiasValue(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return Number.parseFloat(value.toFixed(4)).toString();
}

export function parseNumericTokenId(term: string): string | null {
  if (!/^\d+$/.test(term)) return null;

  const numericId = Number(term);
  if (!Number.isSafeInteger(numericId) || numericId < 0) return null;

  return numericId.toString();
}

export function buildRuntimeLogitBiasMap(
  entries: LogitBiasEntry[],
  tokenizerKey?: string | null,
): Record<string, number> {
  const runtimeLogitBias: Record<string, number> = {};

  for (const entry of entries) {
    for (const tokenId of getRuntimeTokenIdsForEntry(entry, tokenizerKey)) {
      runtimeLogitBias[tokenId] = entry.value;
    }
  }

  return runtimeLogitBias;
}

export function countRuntimeReadyLogitBiasEntries(entries: LogitBiasEntry[], tokenizerKey?: string | null): number {
  let count = 0;

  for (const entry of entries) {
    if (getRuntimeTokenIdsForEntry(entry, tokenizerKey).length > 0) {
      count++;
    }
  }

  return count;
}

export function upsertLogitBiasTokenization(
  entry: LogitBiasEntry,
  tokenizerKey: string,
  tokenIds: string[],
): LogitBiasEntry {
  const normalizedTokenIds = normalizeTokenIds(tokenIds);
  const nextTokenizations = mergeLogitBiasTokenizations(entry.tokenizations ?? [], [
    {
      tokenizer_key: tokenizerKey,
      token_ids: normalizedTokenIds,
    },
  ]).tokenizations;

  return {
    ...entry,
    tokenizations: nextTokenizations,
  };
}

function mergeLogitBiasTokenizations(
  existingTokenizations: LogitBiasTokenization[],
  incomingTokenizations: LogitBiasTokenization[],
): {
  tokenizations: LogitBiasTokenization[];
} {
  const merged = [...existingTokenizations];

  for (const incomingTokenization of incomingTokenizations) {
    const existingIndex = merged.findIndex(
      (tokenization) => tokenization.tokenizer_key === incomingTokenization.tokenizer_key,
    );
    const normalizedIncoming = {
      tokenizer_key: incomingTokenization.tokenizer_key,
      token_ids: normalizeTokenIds(incomingTokenization.token_ids),
    };

    if (existingIndex >= 0) {
      merged[existingIndex] = normalizedIncoming;
      continue;
    }

    merged.push(normalizedIncoming);
  }

  return {
    tokenizations: merged.slice(0, LOGIT_BIAS_TOKENIZATION_MAX),
  };
}

function didLogitBiasEntryChange(before: LogitBiasEntry, after: LogitBiasEntry): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function getRuntimeTokenIdsForEntry(entry: LogitBiasEntry, tokenizerKey?: string | null): string[] {
  if (entry.kind === "token_id") {
    const tokenId = parseNumericTokenId(entry.text);
    return tokenId ? [tokenId] : [];
  }

  if (!tokenizerKey) return [];

  const matchingTokenization = entry.tokenizations?.find((tokenization) => tokenization.tokenizer_key === tokenizerKey);
  if (!matchingTokenization) return [];

  return normalizeTokenIds(matchingTokenization.token_ids);
}
