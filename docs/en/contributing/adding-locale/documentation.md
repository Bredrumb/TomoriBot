---
title: "Documentation"
---

The docs site at `docs.tomoribot.app` serves translated content from `docs/{locale}/`. Translated
pages are optional but recommended, and a locale can ship with runtime strings alone while its
documentation follows.

The site's own surfaces are covered in depth in
[Docs Site Localization](/contributing/docs-site-localization/). This page states what a locale must
and must not do.

## Translated Page Scope

Only reader-facing sections are translated:

| Section | Translated | Reason |
|---|---|---|
| `introduction/` | Yes | The front door |
| `meet-tomori/` | Yes | Persona gallery |
| `features/` | Yes | The user manual |
| `self-hosting/` | Yes | Operators read their own language |
| `legal/` | Yes, with a notice | See the legal rule below |
| `architecture/` | No | Code-level reference for people reading the source |
| `contributing/` | No | Contributor audience, and localizing it would nearly triple per-locale volume |
| `wiki/` | No | Hidden maintainer pages, `noindex` in every locale |

The English tree is roughly 165 pages, and the translated scope is the reader-facing subset rather
than a fixed count. A section that grows in English is translatable in the locale tree; a page outside
the scope is never translated even if a translator offers.

Create the same relative path under `docs/{locale}/` for each page you translate. A page with no
counterpart file is served at its locale URL with English content, so a partial tree is a normal state
rather than a broken one.

## Fallback Routes

A locale URL with no translated file behind it is a fallback route. It is marked `noindex`, emits no
`hreflang` alternate, is excluded from the sitemap, and shows the locale's own draft disclaimer.
Publishing the translation flips all four automatically and adds the alternate set.

That is why a half-translated tree is safe to land: the untranslated routes do not compete with the
English pages they copy, and search engines are never told the two are translations.

## `aiGenerated` And Review State

Review state lives in each page's frontmatter and is per locale file:

| Page state | `aiGenerated` in that file | Notice shown |
|---|---|---|
| Machine-translated, unreviewed | unset or `true` | The locale's draft disclaimer |
| Human-reviewed translation | `false` | None |
| English source is human-written, translation is not yet reviewed | unset or `true` | The locale's translation notice, hidden unless `DOCS_SHOW_TRANSLATION_NOTICE=true` |

Two rules follow, and both are enforced by reading the files rather than by a script:

- **A machine translation must not carry `aiGenerated: false`.** Delete the line when translating a
  page that has it in the English source. Claiming human review that did not happen is the one state
  this system cannot detect for you.
- **Only a human review sets `aiGenerated: false`.** Clearing it is a per-page act after someone reads
  the page, and it is also what removes the page from the review queue.

A locale does not wait for a named reviewer to ship. Unreviewed machine translations ship with the
draft disclaimer, and native review clears the flag page by page later.

The notice wording itself lives in `LOCALE_NOTICES` in `src/constants/docsLocales.ts`, including
`englishLinkText`, so a locale names the source language in its own words rather than showing an
English endonym inside its own sentence. Add this locale-owned notice entry before setting `docsTree`
to `true`. A locale with no entry falls back to the default locale's copy only while its tree is
staged and unpublished.

## Publishing A Locale

`src/constants/docsLocales.ts` is the single source of truth for docs locales. Each target locale
already has a row carrying its `id`, `botLocaleCode`, `lang`, endonym `label`, and description budget,
with `docsTree: false`.

`docsTree` is the publish switch, and flipping it to `true` in the same change as the page tree is what
makes the locale a real route. While it is `false`:

- The locale root serves a 404 rather than redirecting into English, which is the honest answer for a
  URL with no content.
- Starlight registers no locale for it, so there is no sidebar, sitemap entry, or `hreflang` alternate
  configured for it.
- The bot's docs links resolve to English instead of a prefix that does not exist.

The flag governs content and link building. It does **not** govern request routing, because the
middleware decides that from its own routed list, which already names every locale root in the shared
table. So the site root can send a visitor whose `Accept-Language` matches a staged locale to that
locale's root, where they get a 404 until `docsTree` flips. That is the intended staging state: the URL
exists and answers honestly instead of silently serving English under a locale address.

The pre-staged shared surfaces a locale relies on:

| File | Pre-staged state | Publish-time edit |
|---|---|---|
| `src/constants/docsLocales.ts` | The locale row and its endonym | Add the locale's `LOCALE_NOTICES` entry and set `docsTree: true` |
| `apps/docs/functions/_middleware.ts` | The locale is in the routed list | None |
| `apps/docs/public/_redirects` | The `/xx` and `/xx/` root pair | None |
| `README.md` switcher | The locale's endonym as staged plain text | Replace it with the locale README link |
| `src/locales/{code}/**` docs URLs | English-prefixed absolute URLs | Repoint to `/{locale}/` once the tree is published |

`tests/unit/docs/docsLocaleConfig.test.ts` fails when the `docsTree` flags and the directories under
`docs/` disagree, in either direction, so the flag cannot drift from reality.

The locale root pair in `apps/docs/public/_redirects` is a static asset, so nothing can derive it. One
line is a 301 from the slashless form and the other is a 200 rewrite that serves the locale's
introduction page at its own root. The Astro redirect map is generated from the locale table and needs
no edit.

## Locale Roots And The Middleware

`apps/docs/functions/_middleware.ts` redirects the site root to the best locale for the visitor's
`Accept-Language` header. Matching honors quality values, treats `q=0` as a rejection, and matches an
exact code, a registered alias, or an unambiguous base language.

The middleware keeps its own copy of the routed locale list and the matching rules, because the Pages
Functions bundler follows relative imports outside the published directory but does not apply the
repo's `@/*` tsconfig alias, which the shared table needs. A test pins the routed list against
`DOCS_LOCALES` and compares the two matchers on every header they can disagree on.

The routed list names every locale root the shared table registers, whether or not that locale's tree
has landed, and that is why the site root can answer a staged locale with a 404. Registering the roots
ahead of the content is what lets a translation lane work without editing the middleware. Because the
routed list is wider than `PUBLISHED_DOCS_LOCALES`, the two resolvers legitimately diverge on a staged
locale, and the test compares them only where the shared matcher picked a published tree.

An `es-ES` browser reaches the `es-419` tree through `DOCS_LOCALE_ALIASES`, which is inverted from the
bot's `LOCALE_ALIASES` so one alias decision covers runtime strings and docs destinations.

## Legal Pages

Translate `docs/{locale}/legal/**`, and put a translated notice at the top of the body on every legal
page saying that the translation is provided for convenience and that the English version controls.

Translate legal prose conservatively. Do not expand, soften, or reinterpret a clause to read better in
the target language, and do not add a commitment the English page does not make. When a sentence has
no safe equivalent, keep it closer to the English meaning and flag it for review rather than
paraphrasing.

## Translated Docs And Locale Strings

A translated page must link to the destination a reader of that language should land on, and the docs
build does not do that for you. Starlight emits a per-locale route set, but it does not rewrite a
root-relative `href` in page source into the current locale's prefix, so an unprefixed route in a
translated file resolves through the bare-route redirect and ejects the reader into English.

That makes the rule per locale, not per section:

- **English pages (`docs/en/**`) and any page outside the translated scope** keep root-relative,
  unprefixed routes such as `/features/knowledge/memory/`. English is where those routes point.
- **A translated page (`docs/{locale}/**`) prefixes routes with its own locale** when the destination
  exists in that locale: `/ja/features/knowledge/memory/`. Use the locale code, not the language name.
- **A translated page links to English when the destination is not translated**, either because it is
  outside the reader-facing scope (`architecture/`, `contributing/`, `wiki/`) or because its
  translation has not landed yet. `/en/self-hosting/...` is the correct destination in a Japanese page
  for a page the Japanese tree does not have.
- **Fragments are the English anchor in every tree.** A heading that anything links to carries a
  `{#english-slug}` suffix in every locale, so one fragment resolves for every reader:

  ```md
  ### 关键词标签 {#keyword-tags}
  ```

  `apps/docs/src/remarkHeadingIds.ts` turns that suffix into the rendered heading id; Starlight has
  no syntax of its own for it, and without the plugin the braces fold into the slug. The bot needs
  this because `DOCS_ROUTES` in `src/constants/docsLocales.ts` stores one locale-less route per
  destination and `buildDocsUrl` prefixes the reader's locale onto it, so a translated anchor would
  leave every non-English reader at the top of the page. Use the slug the English heading already
  generates, never a new invented one, and run `bun run check-locale-links`: it resolves that table's
  fragments against every published tree and names the locales a heading is missing from.

The `ja` tree is the worked example and shows both directions: 206 links point at `/ja/...`, and the
handful that point at `/en/...` are pages the Japanese tree does not carry. A few unprefixed routes
remain and each one sends a Japanese reader to English: the two cross-links under `docs/ja/legal/`
(`/legal/terms-of-service/` and `/legal/privacy-policy/`) and the `CardGrid` hrefs in
`docs/ja/features/knowledge/README.mdx`. Japanese catch-up owns fixing them, and they are the reason
this rule is stated explicitly rather than implied. Note that a component `href` follows the same rule
as a Markdown link: it is written per locale file, because the English file must keep the unprefixed
route.

Inside an authored locale tree the runtime strings are a separate surface. They cannot call a builder,
because they are static text, so their URLs are absolute and already carry the locale prefix. In `ja`
those URLs live in `general.ts`, `providers.ts`, `commands/config.ts`, `commands/memories.ts`,
`commands/personal.ts`, `commands/refresh.ts`, `commands/setup.ts`, and `commands/shared.ts`.

`bun run check-locale-links` resolves each locale string's destination against the docs tree, so a
repointed URL that does not exist fails the gate. It ignores root-relative Markdown links, so the docs
link rule above has no automated backstop and rests on the translator and the reviewer.

## Related Docs

- [Docs Site Localization](/contributing/docs-site-localization/): the docs site's own surfaces in detail
- [README And Repo](/contributing/adding-locale/readme-and-repo/): the README link rules and legal-text policy
- [Docs Authoring Conventions](/contributing/docs-authoring/): frontmatter, routes, and card components
- [Verification](/contributing/adding-locale/verification/): the docs build and link gates
