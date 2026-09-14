---
title: "Docs Site Localization"
---

This guide covers the localization surfaces outside `src/locales/`: the documentation site under `docs/`, the
bot links that point at it, and the translated READMEs in `.github/`.

Adding runtime strings is a separate task. Start with
[Adding a New Locale](/contributing/adding-locale/) for the locale tree, then come back here to publish the
locale's documentation surfaces.

## One Locale Configuration

`src/constants/docsLocales.ts` is the single source of truth for docs locales. Every other surface derives
from it, so a locale is described once:

| Consumer | Reads from the table |
|---|---|
| `apps/docs/astro.config.mts` | Starlight `locales`, sitemap i18n, sidebar label fallbacks, locale-root redirects, `llms.txt` exclusions |
| `apps/docs/src/routeData.ts` | hreflang alternates, `noindex` on fallback routes, meta description budget |
| `apps/docs/src/components/MarkdownContent.astro` | Which review notice a page shows, and its wording |
| `src/utils/discord/docsLinks.ts`, `src/utils/misc/docsUrl.ts` | The locale prefix on every docs link the bot builds |

The module is imported by the bot runtime and by the Astro build, so it must stay dependency-free: no
Node built-ins, and no project module other than `src/constants/locales.ts`.

`apps/docs/functions/_middleware.ts` cannot import it. The Pages Functions bundler follows relative paths
outside the published directory, but it does not apply the repo's `@/*` tsconfig alias, and the shared table
needs one for `@/constants/locales`. The middleware therefore keeps its own copy of the published locale
list and the `Accept-Language` matching rules, and a test holds the two copies identical. Edit both when
either changes.

### The publish flag

A locale entry has a `docsTree` flag. While it is `false`:

- The locale root is not a route, so nothing 404s into a locale that has no content.
- Starlight does not register the locale, so no sidebar, sitemap, or alternate is emitted for it.
- The bot's docs links resolve to English instead of a prefix that does not exist.
- The site root never redirects a browser to it.

Setting it to `true` is the act of publishing. `tests/unit/docs/docsLocaleConfig.test.ts` fails if the flag
and the `docs/` directory disagree, in either direction.

## Shared Files a Locale Addition Must Edit

These are the only files a new locale has to touch. Everything else follows from the table.

| File | Edit |
|---|---|
| `src/constants/docsLocales.ts` | Add or update the locale entry, then set `docsTree: true` to publish. |
| `apps/docs/functions/_middleware.ts` | Add the locale to the middleware's own published-locale list. |
| `docs/{locale}/**` | The translated page tree. |
| `apps/docs/public/_redirects` | Add the locale root pair: `/xx /xx/ 301` and `/xx/ /xx/introduction/ 200`. |
| `src/locales/{locale}/**` | Hardcoded docs URLs inside locale strings, which carry their own locale prefix. |
| `.github/README_{locale}.md` | The translated README, plus a switcher row pointing back at `../README.md`. |
| `README.md` | Add the new locale to the switcher row so English readers can reach it. |

Pages that stay English-only are linked with an explicit English destination, per the scope rule below.
`bun run check-locale-links` resolves each project-owned route in the linking file's own locale tree first and
then in the default tree, so a link to an untranslated page passes while a link to a page that exists nowhere
fails.

The redirect pair is the one edit nothing can derive for you: `_redirects` is a static asset, so a published
locale without its pair serves a 404 at its own root even though every page under it works. The Astro
redirect map is generated from the locale table, so it needs no edit.

An unpublished locale root is not redirected to English either. It 404s, which is the honest answer for a
URL the site does not serve, and it keeps a locale from looking published before its content lands.

## Localized Page Scope

Translated trees mirror English for the reader-facing pages only. `architecture/`, `contributing/`, and
`wiki/` stay English, because localizing contributor documentation would nearly triple the per-locale page
count for an audience that reads English source either way.

A page with no translation is served at its locale URL with the English content, which is Starlight's
fallback behavior. That fallback route:

- Is marked `noindex`, because indexing it competes with the English page it copies.
- Emits no `hreflang` alternate, so search engines are never told the two are translations.
- Is excluded from the sitemap.
- Shows the locale's own draft disclaimer, so a reader knows the page is not translated yet.

Publishing a translation flips all four automatically and adds the alternate pair.

## Review Notices and `aiGenerated`

The notice above each page comes from the `notices` map in the locale table. A page shows exactly one of:

| Page state | Notice |
|---|---|
| `aiGenerated: false` in that locale's file | None. A human reviewed it. |
| Translated page whose English source has `aiGenerated: false` | The locale's translation notice, linking to the English page. Hidden unless `DOCS_SHOW_TRANSLATION_NOTICE=true`. |
| Anything else | The locale's draft disclaimer. |

Machine-translated pages must **not** carry `aiGenerated: false`; delete that line when translating a page
that has it. After a human reviews a translation, add `aiGenerated: false` to the translated file to clear
its notice. Legal pages additionally state that the English version controls.

## Bot Docs Links

`buildDocsUrl()` and `buildLegalDocUrl()` both route through `buildLocalizedDocsPath()`, which prefixes the
locale only when its tree exists and otherwise returns English. Two consequences worth knowing:

- `DOCS_PATHS` (exported from `src/utils/discord/docsLinks.ts`) holds locale-less routes such as
  `/features/knowledge/memory/`. Never add a locale prefix there; the builder owns the prefix, and
  `tests/unit/docs/docsRouteRegistry.test.ts` fails on a route that carries one.
- Locale strings cannot call a builder, because they are static text. Their links are absolute, including
  the locale prefix, and the same test resolves each one against `docs/` to catch a route that moved.

## Accept-Language at the Site Root

The site root has no content of its own, so `functions/_middleware.ts` redirects `/` to the best published
locale for the visitor's `Accept-Language` header. Matching is quality-aware: the highest `q` value wins,
`q=0` rejects a language, and an exact code, registered alias, or unambiguous base language matches. It falls
back to the default locale, including for an ambiguous base such as `zh` when both Chinese trees are
published.

That list of published locales is the middleware's own copy, so publishing a locale means adding it to both
`src/constants/docsLocales.ts` and `apps/docs/functions/_middleware.ts`.
`tests/unit/docs/docsSiteMiddleware.test.ts` fails if the two copies disagree on any header it covers.

## Machine-Readable Output

`llms.txt`, `llms-small.txt`, `llms-full.txt`, and the per-audience sets under `_llms-txt/` are English-only.
`starlight-llms-txt` selects the default locale's entries, and `apps/docs/scripts/checkLlmsOutput.ts` fails
the build if a non-default locale URL appears in any of them.

That script also verifies hreflang against the built HTML: every fallback route must emit no alternate, and
every translated pair must emit its full set plus `x-default`. `bun run build` in `apps/docs` runs both.

## Verifying a Locale Addition

```bash
cd apps/docs && bun run build   # docs build, hreflang and llms.txt checks
bun test tests/unit/docs/       # locale config, routing, fallback, and notice rules
bun run check                   # TypeScript strict mode
bun run lint                    # Biome formatting
bun run check-locale-links      # locale strings, docs, and README routes resolve
```

`bun run build` fails rather than warns when a fallback route advertises an alternate, which is the check
that catches a route accidentally registered without its content.
