import { DOCS_BASE_URL, LEGAL_DOC_ROUTES, buildLocalizedDocsPath } from "@/constants/docsLocales";

type LegalDoc = keyof typeof LEGAL_DOC_ROUTES;

// Trailing slashes in the emitted directory routes are required because Discord link previews do not follow the
// redirect from slashless URLs.
export function buildLegalDocUrl(locale: string, doc: LegalDoc): string {
  return `${DOCS_BASE_URL}${buildLocalizedDocsPath(locale, LEGAL_DOC_ROUTES[doc])}`;
}
