const DOCS_BASE_URL = "https://docs.tomoribot.app";

type LegalDoc = "privacy-policy" | "terms-of-service";

/**
 * Builds the canonical docs-site URL for a legal document.
 *
 * Starlight is configured with `defaultLocale: "root"`, so English is served without a
 * locale prefix and any locale lacking a docs translation correctly falls back to it.
 * The trailing slash is required: routes are emitted directory-style, and the slashless
 * form costs a redirect hop that Discord's link preview does not follow.
 */
export function buildLegalDocUrl(locale: string, doc: LegalDoc): string {
  const localePrefix = locale === "ja" ? "/ja" : "";
  return `${DOCS_BASE_URL}${localePrefix}/legal/${doc}/`;
}
