---
title: "README And Repo"
---

The repository has one translated README per locale under `.github/`, plus a language switcher in the
root `README.md`. A translated README is optional and recommended, and it is the surface most people
see before the docs site.

## File Layout And Switcher

- The translated file is `.github/README_{code}.md`, using the Discord locale code:
  `.github/README_pt-BR.md`, `.github/README_zh-TW.md`, and so on.
- The root `README.md` switcher row lists every locale that has a file.
- Each translated README carries a switcher row pointing back at `../README.md`.

The root switcher is pre-staged with the locale table, and each entry becomes a live link when its
translated file lands. A row that points at a file nobody has written yet is a broken link in the
repository's front page, so do not enable one before its file exists.

Copy the complete switcher from the root README into the translated file and translate only the labels
for languages you are not writing. The English label stays `English` in every language's switcher.

## Docs Links Versus README Links

The two surfaces use **different** link rules, and mixing them up is the most common localization
defect:

Links are the surface where a translated page and a translated README diverge most, because the two are
rendered by different systems:

| Surface | Rule |
|---|---|
| English docs Markdown under `docs/en/` | Root-relative, unprefixed route: `/features/knowledge/memory/`. English is where those routes resolve |
| Translated docs Markdown under `docs/{locale}/` | Root-relative with the page's own locale prefix when the destination exists in that locale: `/ja/features/knowledge/memory/`. The English destination when it does not |
| Translated README under `.github/` | Absolute target-locale docs URL for a page that exists in that locale, and the absolute English URL for an excluded or missing page |
| Everything else in a README (relative paths, images, code, command examples, badges) | Unchanged |

A README is rendered by GitHub, which knows nothing about the docs router, so a root-relative
`/features/...` link there resolves to `github.com/features/...`. Always write the full
`https://docs.tomoribot.app/...` destination in a README.

The locale prefix in translated docs source is what keeps a reader in their language. Starlight does not
rewrite root-relative `href` values into the current locale's prefix, in Markdown links or in component
props, so an unprefixed route in a translated page resolves through the bare-route redirect into English.
A card `href` is therefore written per locale file: the English file keeps the unprefixed route and the
translated file writes its own prefix. Prefer the English destination only for anything in
`architecture/`, `contributing/`, or `wiki/`, which stay English in every locale, or for a page whose
translation has not landed.

The full rule, with the evidence behind it, is in
[Documentation](/contributing/adding-locale/documentation/).

## Fragments

A fragment link has to match the anchor the destination heading actually generates, and translating a
heading changes its anchor:

- If the target heading is translated, update the `#fragment` to the anchor that translated heading
  generates.
- If the target is an English-only fallback page, keep the English fragment, because that page's
  headings are still English.
- Preserve explicitly authored IDs exactly. An `<!-- anchor: custom-id -->` comment immediately
  after a heading keeps that ID in every language.

Verify fragments against the rendered target in the locale you are writing, not against the English
page. The link check in `bun run check-locales` extracts anchors from explicit `<a id="...">` tags, `anchor:`
comments, and slugified headings, then fails on a fragment that resolves to nothing. It scans absolute
`docs.tomoribot.app` URLs, which covers locale strings and READMEs, and it resolves a project-owned
route in the linking file's own locale tree first and then in the default tree, so a link to an
untranslated English page passes while a link to a page that exists nowhere fails. It does not read
root-relative Markdown links in `docs/`, so a docs fragment is on the translator and the reviewer.

## Third-Party URLs

The rule is one sentence: **translate the label, leave the destination alone unless an official
localized destination is verified.**

- Discord invite links, the repository URL, issue templates, badges, donation links, and provider
  documentation URLs stay exactly as they are.
- Preserve query parameters and identifiers byte for byte.
- **Never invent a locale URL pattern.** Do not add a `?locale=` parameter, a locale subdomain, or a
  locale path segment to a third-party URL on the theory that the vendor probably supports it. A
  guessed URL is a broken link shipped to every reader of that language.
- If a localized destination looks plausible but you cannot verify it, report it instead of using it.
  An unverified candidate is a note for a human, not a link.

The link checker ignores external domains entirely, so this rule has no automated backstop. It is on
the author and the reviewer.

## Images And Other Unchanged Content

Keep image paths, code blocks, commands, file paths, environment variable names, project names,
provider names, and model names unchanged. Translate human-readable link labels and image alt text.
Do not add claims, features, or support promises absent from the English source.

## Legal Text Policy

Translate `docs/{locale}/legal/**`, and put a translated notice at the top of the body stating that the
translation is for convenience and that the English version controls. Translate legal prose
conservatively: no expansion, no softening, no reinterpretation to read better in the target language.

The rest of the repository carries no legal text, so a README does not need a notice. What a README
does need is accuracy: a translated README that promises a capability the bot does not have is a
product claim in every language.

## Outside The Repository

Two surfaces are not in version control and cannot be updated by a commit:

- The Discord App Directory listing.
- The bot's own profile description.

Both are manual checklist items for whoever operates the deployment, and they belong to the release
step rather than to a translation lane. Note them as pending rather than assuming a docs change
covered them.

## Related Docs

- [Documentation](/contributing/adding-locale/documentation/): docs tree scope, notices, and publishing
- [Docs Site Localization](/contributing/docs-site-localization/): shared files a locale addition edits
- [Verification](/contributing/adding-locale/verification/): the link and fragment gates
