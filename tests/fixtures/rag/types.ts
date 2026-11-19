const RAG_LANGUAGES = ["en", "ja", "zh-Hans", "zh-Hant", "ru", "pt", "es", "vi"] as const;

export type RagLanguage = (typeof RAG_LANGUAGES)[number];

const RAG_DOCUMENT_SCOPES = ["persona", "serverwide"] as const;

type RagDocumentScope = (typeof RAG_DOCUMENT_SCOPES)[number];

interface RagPassage {
  // Must be globally unique across the entire corpus because queries reference passages by key across documents.
  key: string;
  text: string;
}

export interface RagDocument {
  key: string;
  documentName: string;
  language: RagLanguage;
  scope: RagDocumentScope;
  // Every passage text in passages must appear verbatim in sourceText so chunker tests can map chunks back to labels.
  sourceText: string;
  passages: readonly RagPassage[];
}

const RAG_QUERY_CATEGORIES = [
  "exact-proper-name",
  "cjk-substring",
  "single-han-name",
  "kana-only-term",
  "accented-latin",
  "cyrillic-inflection",
  "vietnamese-tones",
  "paraphrase-no-lexical-overlap",
  "contextual-follow-up",
  "title-only",
  "common-word-false-positive",
  "no-relevant-passage",
  "topic-shift",
] as const;

export type RagQueryCategory = (typeof RAG_QUERY_CATEGORIES)[number];

const RAG_QUERY_SPLITS = ["tuning", "holdout"] as const;

export type RagQuerySplit = (typeof RAG_QUERY_SPLITS)[number];
