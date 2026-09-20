import { DOCS_BASE_URL, LEGAL_DOC_ROUTES, buildLocalizedDocsPath } from "@/constants/docsLocales";

type LegalDoc = keyof typeof LEGAL_DOC_ROUTES;

/**
 * Builds the canonical docs-site URL for a legal document.
 *
 * Locale resolution is shared with every other docs link, so a locale without a legal tree lands on
 * the English page instead of a prefixed route that does not exist. The trailing slash is required:
 * routes are emitted directory-style, and the slashless form costs a redirect hop that Discord's
 * link preview does not follow.
 */
export function buildLegalDocUrl(locale: string, doc: LegalDoc): string {
  return `${DOCS_BASE_URL}${buildLocalizedDocsPath(locale, LEGAL_DOC_ROUTES[doc])}`;
}
