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
needs one for `@/constants/locales`. The middleware therefore keeps its own copy of the routed locale list
and the `Accept-Language` matching rules, and a test pins that list against `DOCS_LOCALES` while comparing
the two matchers. Edit both when either changes.

### The publish flag

A locale entry has a `docsTree` flag. While it is `false`:

- The locale root serves a 404 rather than serving English, which is the honest answer for a URL with no
  content behind it.
- Starlight does not register the locale, so no sidebar, sitemap, or alternate is emitted for it.
- The bot's docs links resolve to English instead of a prefix that does not exist.

The flag governs content and link building, not request routing. Routing comes from the middleware's own
routed list, which already names every locale root in `DOCS_LOCALES`, so the site root can send a visitor
whose `Accept-Language` matches a staged locale to that locale's root and answer with a 404 until the flag
flips. That is the intended staging state rather than a bug: the URL exists and answers honestly instead of
silently serving English under a locale address.

Setting it to `true` is the act of publishing. `tests/unit/docs/docsLocaleConfig.test.ts` fails if the flag
and the `docs/` directory disagree, in either direction.

## Shared Files a Locale Addition Touches

These are the only files a new locale has to touch. Everything else is already staged for every locale
in `DOCS_LOCALES`, or derives from it.

| File | Edit |
|---|---|
| `src/constants/docsLocales.ts` | Add or update the locale entry, then set `docsTree: true` to publish. |
| `docs/{locale}/**` | The translated page tree. |
| `src/locales/{locale}/**` | Hardcoded docs URLs inside locale strings, which carry their own locale prefix. Repoint them to `/{locale}/` once the tree is published. |
| `.github/README_{locale}.md` | The translated README, plus a switcher row pointing back at `../README.md`. |
| `README.md` | The locale's switcher entry becomes a live link once its translated file exists. |

`apps/docs/functions/_middleware.ts` and `apps/docs/public/_redirects` are already staged for every
target locale in `DOCS_LOCALES`. Their entries name the locale root without claiming content exists, so
`docsTree: true` plus the page tree is the whole publish step. `tests/unit/docs/docsSiteMiddleware.test.ts`
fails if the middleware's routed list and `DOCS_LOCALES` disagree.

Pages that stay English-only are linked with an explicit English destination, per the scope rule below.
`bun run check-locale-links` resolves each project-owned route in the linking file's own locale tree first and
then in the default tree, so a link to an untranslated page passes while a link to a page that exists nowhere
fails.

The redirect pair is the entry nothing can derive from the table, because `_redirects` is a static
asset. It is written for every target locale ahead of its content, so publishing a locale needs no edit
there. The Astro redirect map is generated from the locale table and needs no edit either.

An unpublished locale root is not redirected to English. It 404s, which is the honest answer for a URL
the site does not serve, and it keeps a locale from looking published before its content lands.

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

### Links inside a translated page

Starlight emits a per-locale route set but does not rewrite a root-relative `href` in page source into the
current locale's prefix. An unprefixed route in a translated file therefore resolves through the bare-route
redirect and ejects the reader into English.

- English pages keep unprefixed routes such as `/features/knowledge/memory/`.
- A translated page prefixes its own locale for a destination that exists in that locale:
  `/ja/features/knowledge/memory/`.
- A translated page links to `/en/...` for a page outside the reader-facing scope or one whose translation
  has not landed.
- Fragments follow the destination page's own headings, in whichever tree that destination lives.

The `ja` tree is the worked example: most of its links carry `/ja/`, and the ones that carry `/en/` are pages
the Japanese tree does not have. Two links under `docs/ja/legal/` still use unprefixed routes and send a
Japanese reader to English; Japanese catch-up owns fixing them.
`bun run check-locale-links` only scans absolute `docs.tomoribot.app` URLs, so this rule has no automated
backstop for Markdown source.

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

The site root has no content of its own, so `functions/_middleware.ts` redirects `/` to the best routed
locale for the visitor's `Accept-Language` header. Matching is quality-aware: the highest `q` value wins,
`q=0` rejects a language, and an exact code, registered alias, or unambiguous base language matches. It falls
back to the default locale, including for an ambiguous base such as `zh` when both Chinese trees are
published.

That routed list is the middleware's own copy and is already wider than the published set: it names every
locale root in `DOCS_LOCALES`, so a staged locale can receive the site-root redirect before its content
lands. A staged root answers with a 404 until `docsTree` flips, which is why registering roots early is safe.
`tests/unit/docs/docsSiteMiddleware.test.ts` pins the list against `DOCS_LOCALES` and compares the two
matchers on every header a published locale answers.

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
