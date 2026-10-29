export const RAG_LANGUAGES = ["en", "ja", "zh-Hans", "zh-Hant", "ru", "pt", "es", "vi"] as const;

export type RagLanguage = (typeof RAG_LANGUAGES)[number];

export const RAG_DOCUMENT_SCOPES = ["persona", "serverwide"] as const;

export type RagDocumentScope = (typeof RAG_DOCUMENT_SCOPES)[number];

export interface RagPassage {
  /** Globally unique across the corpus, so a query can label passages in any document. */
  key: string;
  text: string;
}

export interface RagDocument {
  key: string;
  documentName: string;
  language: RagLanguage;
  scope: RagDocumentScope;
  /** Every passage text appears here verbatim, so a chunker test can map output back to labels. */
  sourceText: string;
  passages: readonly RagPassage[];
}

export const RAG_QUERY_CATEGORIES = [
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

export const RAG_QUERY_SPLITS = ["tuning", "holdout"] as const;

export type RagQuerySplit = (typeof RAG_QUERY_SPLITS)[number];
