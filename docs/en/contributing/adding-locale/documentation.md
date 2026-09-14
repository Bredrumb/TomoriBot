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
English endonym inside its own sentence. A locale with no entry falls back to the default locale's
copy, which keeps a newly published locale readable while its notices are still being authored.

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
- The site root never redirects a browser to it.

The pre-staged shared surfaces a locale relies on:

| File | Pre-staged state | Publish-time edit |
|---|---|---|
| `src/constants/docsLocales.ts` | The locale row and its endonym | Set `docsTree: true` |
| `apps/docs/functions/_middleware.ts` | The locale is in the routed list | None |
| `apps/docs/public/_redirects` | The `/xx` and `/xx/` root pair | None |
| `README.md` switcher | The locale table row | None |
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

The routed list is wider than the published set on purpose: it names every locale root the shared
table registers, whether or not that locale's tree has landed. A staged root serves its content once
`docsTree` is true and a 404 until then, so registering the roots ahead of the content is what lets a
translation lane work without editing the middleware. Because of that, the site root can send a
visitor to a staged root that has no page behind it yet, which is the intended staging state rather
than a rule disagreement.

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

Two link rules apply, and they are opposites by design:

- **Docs source Markdown keeps root-relative, unprefixed routes.** Write `/features/knowledge/memory/`
  and let the router apply the active locale. A hardcoded `/pt-BR/features/...` in a Markdown file is a
  bug, because it breaks the English fallback for that same page and pins the route to one locale.
- **Locale strings carry absolute URLs with the locale prefix**, because they are static text that no
  builder can rewrite at runtime. Inside an authored locale tree those URLs are hardcoded absolute
  destinations prefixed with the published locale, so repointing them to `/{locale}/...` is the last
  in-tree edit for a locale. The `ja` tree is the worked example, and its URLs live in `general.ts`,
  `providers.ts`, `commands/config.ts`, `commands/memories.ts`, `commands/personal.ts`,
  `commands/refresh.ts`, `commands/setup.ts`, and `commands/shared.ts`.

`bun run check-locale-links` resolves each locale string's destination against the docs tree, so a
repointed URL that does not exist fails the gate.

## Related Docs

- [Docs Site Localization](/contributing/docs-site-localization/): the docs site's own surfaces in detail
- [README And Repo](/contributing/adding-locale/readme-and-repo/): the README link rules and legal-text policy
- [Docs Authoring Conventions](/contributing/docs-authoring/): frontmatter, routes, and card components
- [Verification](/contributing/adding-locale/verification/): the docs build and link gates
