import { createHash } from "node:crypto";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import {
  buildRouteSegments,
  decodeRouteSegments,
  indexCodecsByWireToken,
  parseNonNegativeInt,
  parseNonce,
  parsePositiveId,
  type RouteFieldCodec,
} from "@/utils/discord/panelRouteCodec";
import { parseLocale } from "@/utils/discord/panelRouteTokens";

export const MEMORIES_ROUTE_NAMESPACE = "memories";
export const MEMORIES_ROUTE_VERSION = "v1";

export type MemoriesCategory = "memories" | "documents" | "lorebooks" | "stm";

export function computeServerStmFingerprint(
  workspaceId: string,
  userDiscId: string,
  entries: readonly { channelId: string; personaId?: number | null }[],
): string {
  const identities = entries.map((entry) => `${entry.channelId}:${entry.personaId ?? "none"}`).join(",");
  return createHash("sha256")
    .update(`memories-stm:${workspaceId}:${userDiscId}:${identities}`)
    .digest("base64url")
    .slice(0, 8);
}

type MemoriesAction =
  | "category"
  | "persona-select"
  | "persona-page"
  | "select"
  | "range"
  | "add-submit"
  | "edit-open"
  | "edit-submit"
  | "remove-prompt"
  | "remove-confirm"
  | "remove-cancel"
  | "vectorize-prompt"
  | "vectorize-confirm"
  | "vectorize-submit"
  | "vectorize-cancel"
  | "document-scope"
  | "document-persona-select"
  | "document-persona-page"
  | "document-select"
  | "document-range"
  | "document-add-submit"
  | "document-remove-prompt"
  | "document-remove-confirm"
  | "document-remove-cancel"
  | "history-remove-prompt"
  | "history-remove-confirm"
  | "history-remove-cancel"
  | "document-chunk-prev"
  | "document-chunk-next"
  | "document-chunk-edit-open"
  | "document-chunk-edit-submit"
  | "document-chunk-remove-prompt"
  | "document-chunk-remove-confirm"
  | "document-chunk-remove-cancel"
  | "lore-book-toggle-enabled"
  | "lore-book-channels-open"
  | "lore-book-channels-submit"
  | "lore-book-rename-open"
  | "lore-book-rename-submit"
  | "lore-book-remove-prompt"
  | "lore-book-remove-confirm"
  | "lore-book-remove-cancel"
  | "lore-book-select"
  | "lore-book-create-submit"
  | "lore-scope"
  | "lore-persona-select"
  | "lore-persona-page"
  | "lore-select"
  | "lore-range"
  | "lore-add-submit"
  | "lore-book-import-submit"
  | "lore-import-submit"
  | "lore-edit-open"
  | "lore-edit-submit"
  | "lore-activation-open"
  | "lore-activation-submit"
  | "lore-toggle-enabled"
  | "lore-remove-prompt"
  | "lore-remove-confirm"
  | "lore-remove-cancel"
  | "stm-open"
  | "stm-submit"
  | "stm-entry"
  | "retry";

export type MemoriesPanelRoute = (
  | { action: "category"; locale: string; category: MemoriesCategory }
  | { action: "persona-select"; locale: string; lineageId: number }
  | { action: "persona-page"; locale: string; lineageId: number; rangeIndex: number }
  | { action: "select"; locale: string; lineageId: number; rangeIndex?: number }
  | { action: "range"; locale: string; lineageId: number; rangeIndex: number }
  | { action: "add-submit"; locale: string; lineageId: number; nonce: string }
  | {
      action: "edit-open" | "remove-prompt" | "remove-confirm" | "remove-cancel";
      locale: string;
      lineageId: number;
      memoryId: number;
    }
  | { action: "edit-submit"; locale: string; lineageId: number; memoryId: number; nonce: string }
  | {
      action: "vectorize-prompt" | "vectorize-confirm" | "vectorize-cancel";
      locale: string;
      lineageId: number;
      personaId: number;
      memoryId: number;
    }
  | {
      action: "vectorize-submit";
      locale: string;
      lineageId: number;
      personaId: number;
      memoryId: number;
      nonce: string;
    }
  | { action: "document-scope" | "document-persona-select"; locale: string; personaId: number }
  | { action: "document-persona-page"; locale: string; personaId: number; rangeIndex: number }
  | { action: "document-select"; locale: string; personaId: number; rangeIndex?: number }
  | { action: "document-range"; locale: string; personaId: number; rangeIndex: number }
  | { action: "document-add-submit"; locale: string; personaId: number; nonce: string }
  | {
      action:
        | "document-remove-prompt"
        | "document-remove-confirm"
        | "document-remove-cancel"
        | "history-remove-prompt"
        | "history-remove-confirm"
        | "history-remove-cancel";
      locale: string;
      personaId: number;
      documentId: number;
    }
  | {
      action:
        | "document-chunk-prev"
        | "document-chunk-next"
        | "document-chunk-edit-open"
        | "document-chunk-remove-prompt"
        | "document-chunk-remove-confirm"
        | "document-chunk-remove-cancel";
      locale: string;
      personaId: number;
      documentId: number;
      chunkIdx: number;
    }
  | {
      action: "document-chunk-edit-submit";
      locale: string;
      personaId: number;
      documentId: number;
      chunkIdx: number;
      nonce: string;
    }
  | {
      action:
        | "lore-book-toggle-enabled"
        | "lore-book-channels-open"
        | "lore-book-rename-open"
        | "lore-book-remove-prompt"
        | "lore-book-remove-confirm"
        | "lore-book-remove-cancel";
      locale: string;
      bookId: number;
    }
  | { action: "lore-book-rename-submit" | "lore-book-channels-submit"; locale: string; bookId: number; nonce: string }
  | { action: "lore-book-select"; locale: string; rangeIndex?: number }
  | { action: "lore-book-import-submit"; locale: string; nonce: string }
  | { action: "lore-book-create-submit"; locale: string; nonce: string }
  | { action: "lore-scope" | "lore-persona-select"; locale: string; scopeLineageId: number }
  | { action: "lore-persona-page" | "lore-range"; locale: string; scopeLineageId: number; rangeIndex: number }
  | { action: "lore-select"; locale: string; scopeLineageId: number; rangeIndex?: number }
  | { action: "lore-add-submit"; locale: string; scopeLineageId: number; nonce: string }
  | { action: "lore-import-submit"; locale: string; scopeLineageId: number; nonce: string }
  | {
      action:
        | "lore-edit-open"
        | "lore-activation-open"
        | "lore-toggle-enabled"
        | "lore-remove-prompt"
        | "lore-remove-confirm"
        | "lore-remove-cancel";
      locale: string;
      scopeLineageId: number;
      entryId: number;
    }
  | {
      action: "lore-edit-submit" | "lore-activation-submit";
      locale: string;
      scopeLineageId: number;
      entryId: number;
      nonce: string;
    }
  | { action: "stm-open"; locale: string }
  | { action: "stm-submit"; locale: string; nonce: string }
  | { action: "stm-entry"; locale: string; channelId: string; personaId: number }
  | { action: "retry"; locale: string; category: MemoriesCategory; lineageId?: number }
) & { bookId?: number };

const categoryField: RouteFieldCodec<"category", MemoriesCategory> = {
  key: "category",
  encode: (val) => String(val),
  decode: (raw) => (raw === "memories" || raw === "documents" || raw === "lorebooks" || raw === "stm" ? raw : null),
};

const lineageIdField: RouteFieldCodec<"lineageId", number> = {
  key: "lineageId",
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

const optionalLineageIdField: RouteFieldCodec<"lineageId", number> = {
  key: "lineageId",
  optional: true,
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

const memoryIdField: RouteFieldCodec<"memoryId", number> = {
  key: "memoryId",
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

const personaIdField: RouteFieldCodec<"personaId", number> = {
  key: "personaId",
  encode: (val) => String(val),
  decode: (raw) => parseNonNegativeInt(raw),
};

const documentIdField: RouteFieldCodec<"documentId", number> = {
  key: "documentId",
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

const chunkIdxField: RouteFieldCodec<"chunkIdx", number> = {
  key: "chunkIdx",
  encode: (val) => String(val),
  decode: (raw) => parseNonNegativeInt(raw),
};

const channelIdField: RouteFieldCodec<"channelId", string> = {
  key: "channelId",
  encode: (val) => String(val),
  decode: (raw) => (/^\d{17,20}$/.test(raw) ? raw : null),
};

const nonceField: RouteFieldCodec<"nonce", string> = {
  key: "nonce",
  encode: (val) => String(val),
  decode: (raw) => parseNonce(raw),
};

const rangeIndexField: RouteFieldCodec<"rangeIndex", number> = {
  key: "rangeIndex",
  encode: (val) => String(val),
  decode: (raw) => parseNonNegativeInt(raw),
};

const scopeLineageIdField: RouteFieldCodec<"scopeLineageId", number> = {
  key: "scopeLineageId",
  encode: (val) => String(val),
  decode: (raw) => parseNonNegativeInt(raw),
};

const entryIdField: RouteFieldCodec<"entryId", number> = {
  key: "entryId",
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

const optionalRangeIndexField: RouteFieldCodec<"rangeIndex", number> = {
  key: "rangeIndex",
  optional: true,
  encode: (val) => String(val),
  decode: (raw) => parseNonNegativeInt(raw),
};

const optionalBookIdField: RouteFieldCodec<"bookId", number> = {
  key: "bookId",
  optional: true,
  encode: (val) => String(val),
  decode: (raw) => parsePositiveId(raw),
};

export const MEMORIES_ROUTE_CODECS: Record<
  MemoriesAction,
  { wireToken: string; fields: readonly RouteFieldCodec<string, unknown>[] }
> = {
  category: {
    wireToken: "category",
    fields: [categoryField],
  },
  "persona-select": {
    wireToken: "persona-select",
    fields: [lineageIdField],
  },
  "persona-page": {
    wireToken: "persona-page",
    fields: [lineageIdField, rangeIndexField],
  },
  select: {
    wireToken: "select",
    fields: [lineageIdField, optionalRangeIndexField],
  },
  range: {
    wireToken: "range",
    fields: [lineageIdField, rangeIndexField],
  },
  "add-submit": {
    wireToken: "add-submit",
    fields: [lineageIdField, nonceField],
  },
  "edit-open": {
    wireToken: "edit-open",
    fields: [lineageIdField, memoryIdField],
  },
  "edit-submit": {
    wireToken: "edit-submit",
    fields: [lineageIdField, memoryIdField, nonceField],
  },
  "remove-prompt": {
    wireToken: "remove-prompt",
    fields: [lineageIdField, memoryIdField],
  },
  "remove-confirm": {
    wireToken: "remove-confirm",
    fields: [lineageIdField, memoryIdField],
  },
  "remove-cancel": {
    wireToken: "remove-cancel",
    fields: [lineageIdField, memoryIdField],
  },
  "vectorize-prompt": {
    wireToken: "vectorize-prompt",
    fields: [lineageIdField, personaIdField, memoryIdField],
  },
  "vectorize-confirm": {
    wireToken: "vectorize-confirm",
    fields: [lineageIdField, personaIdField, memoryIdField],
  },
  "vectorize-submit": {
    wireToken: "vectorize-submit",
    fields: [lineageIdField, personaIdField, memoryIdField, nonceField],
  },
  "vectorize-cancel": {
    wireToken: "vectorize-cancel",
    fields: [lineageIdField, personaIdField, memoryIdField],
  },
  "document-scope": {
    wireToken: "document-scope",
    fields: [personaIdField],
  },
  "document-persona-select": {
    wireToken: "document-persona-select",
    fields: [personaIdField],
  },
  "document-persona-page": {
    wireToken: "document-persona-page",
    fields: [personaIdField, rangeIndexField],
  },
  "document-select": {
    wireToken: "document-select",
    fields: [personaIdField, optionalRangeIndexField],
  },
  "document-range": {
    wireToken: "document-range",
    fields: [personaIdField, rangeIndexField],
  },
  "document-add-submit": {
    wireToken: "document-add-submit",
    fields: [personaIdField, nonceField],
  },
  "document-remove-prompt": {
    wireToken: "document-remove-prompt",
    fields: [personaIdField, documentIdField],
  },
  "document-remove-confirm": {
    wireToken: "document-remove-confirm",
    fields: [personaIdField, documentIdField],
  },
  "document-remove-cancel": {
    wireToken: "document-remove-cancel",
    fields: [personaIdField, documentIdField],
  },
  "history-remove-prompt": {
    wireToken: "history-remove-prompt",
    fields: [personaIdField, documentIdField],
  },
  "history-remove-confirm": {
    wireToken: "history-remove-confirm",
    fields: [personaIdField, documentIdField],
  },
  "history-remove-cancel": {
    wireToken: "history-remove-cancel",
    fields: [personaIdField, documentIdField],
  },
  "document-chunk-prev": {
    wireToken: "document-chunk-prev",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "document-chunk-next": {
    wireToken: "document-chunk-next",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "document-chunk-edit-open": {
    wireToken: "document-chunk-edit-open",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "document-chunk-edit-submit": {
    wireToken: "document-chunk-edit-submit",
    fields: [personaIdField, documentIdField, chunkIdxField, nonceField],
  },
  "document-chunk-remove-prompt": {
    wireToken: "document-chunk-remove-prompt",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "document-chunk-remove-confirm": {
    wireToken: "document-chunk-remove-confirm",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "document-chunk-remove-cancel": {
    wireToken: "document-chunk-remove-cancel",
    fields: [personaIdField, documentIdField, chunkIdxField],
  },
  "lore-book-toggle-enabled": {
    wireToken: "lore-book-toggle-enabled",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-channels-open": {
    wireToken: "lore-book-channels-open",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-channels-submit": {
    wireToken: "lore-book-channels-submit",
    fields: [{ ...optionalBookIdField, optional: false }, nonceField],
  },
  "lore-book-rename-open": {
    wireToken: "lore-book-rename-open",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-rename-submit": {
    wireToken: "lore-book-rename-submit",
    fields: [{ ...optionalBookIdField, optional: false }, nonceField],
  },
  "lore-book-remove-prompt": {
    wireToken: "lore-book-remove-prompt",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-remove-confirm": {
    wireToken: "lore-book-remove-confirm",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-remove-cancel": {
    wireToken: "lore-book-remove-cancel",
    fields: [{ ...optionalBookIdField, optional: false }],
  },
  "lore-book-select": {
    wireToken: "lore-book-select",
    fields: [optionalRangeIndexField],
  },
  "lore-book-create-submit": {
    wireToken: "lore-book-create-submit",
    fields: [nonceField],
  },
  "lore-scope": {
    wireToken: "lore-scope",
    fields: [scopeLineageIdField, optionalBookIdField],
  },
  "lore-persona-select": {
    wireToken: "lore-persona-select",
    fields: [scopeLineageIdField, optionalBookIdField],
  },
  "lore-persona-page": {
    wireToken: "lore-persona-page",
    fields: [scopeLineageIdField, rangeIndexField, optionalBookIdField],
  },
  "lore-select": {
    wireToken: "lore-select",
    fields: [scopeLineageIdField, optionalRangeIndexField, optionalBookIdField],
  },
  "lore-range": {
    wireToken: "lore-range",
    fields: [scopeLineageIdField, rangeIndexField, optionalBookIdField],
  },
  "lore-add-submit": {
    wireToken: "lore-add-submit",
    fields: [scopeLineageIdField, nonceField, optionalBookIdField],
  },
  "lore-book-import-submit": { wireToken: "lore-book-import-submit", fields: [nonceField] },
  "lore-import-submit": {
    wireToken: "lore-import-submit",
    fields: [scopeLineageIdField, nonceField, optionalBookIdField],
  },
  "lore-edit-open": {
    wireToken: "lore-edit-open",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "lore-edit-submit": {
    wireToken: "lore-edit-submit",
    fields: [scopeLineageIdField, entryIdField, nonceField, optionalBookIdField],
  },
  "lore-activation-open": {
    wireToken: "lore-activation-open",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "lore-activation-submit": {
    wireToken: "lore-activation-submit",
    fields: [scopeLineageIdField, entryIdField, nonceField, optionalBookIdField],
  },
  "lore-toggle-enabled": {
    wireToken: "lore-toggle-enabled",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "lore-remove-prompt": {
    wireToken: "lore-remove-prompt",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "lore-remove-confirm": {
    wireToken: "lore-remove-confirm",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "lore-remove-cancel": {
    wireToken: "lore-remove-cancel",
    fields: [scopeLineageIdField, entryIdField, optionalBookIdField],
  },
  "stm-open": {
    wireToken: "stm-open",
    fields: [],
  },
  "stm-submit": {
    wireToken: "stm-submit",
    fields: [nonceField],
  },
  "stm-entry": {
    wireToken: "stm-entry",
    fields: [channelIdField, personaIdField],
  },
  retry: {
    wireToken: "retry",
    fields: [categoryField, optionalLineageIdField],
  },
};

const CODECS_BY_WIRE_TOKEN = indexCodecsByWireToken<MemoriesAction, MemoriesPanelRoute>(MEMORIES_ROUTE_CODECS);

export function listMemoriesPanelActions(): string[] {
  return Object.keys(MEMORIES_ROUTE_CODECS);
}

export function buildMemoriesRouteSegments(route: MemoriesPanelRoute): string[] {
  return buildRouteSegments(
    MEMORIES_ROUTE_CODECS[route.action],
    route.action === "lore-select" && route.bookId ? { ...route, rangeIndex: route.rangeIndex ?? 0 } : route,
  );
}

export function buildMemoriesRouteId(route: MemoriesPanelRoute): string {
  return buildInteractionRouteId(
    MEMORIES_ROUTE_NAMESPACE,
    MEMORIES_ROUTE_VERSION,
    ...buildMemoriesRouteSegments(route),
  );
}

export function parseMemoriesPanelRoute(route: ParsedInteractionRoute): MemoriesPanelRoute | null {
  if (route.namespace !== MEMORIES_ROUTE_NAMESPACE || route.version !== MEMORIES_ROUTE_VERSION) {
    return null;
  }

  const [rawWireToken, rawLocale, ...tail] = route.segments;
  if (!rawWireToken || !rawLocale) return null;

  const locale = parseLocale(rawLocale);
  if (!locale) return null;

  const entry = CODECS_BY_WIRE_TOKEN.get(rawWireToken);
  if (!entry) return null;

  return decodeRouteSegments(entry.codec, entry.action, locale, tail);
}
