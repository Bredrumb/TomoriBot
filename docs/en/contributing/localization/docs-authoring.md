---
title: "Docs Authoring Conventions"
sidebar:
  order: 20
---

Conventions for adding, moving, and formatting pages on the TomoriBot docs site.

## Files and routes

Write pages in `docs/` at the repository root. `apps/docs/src/content/docs` is a link to it, so edits
there change `docs/` directly. `apps/docs/src/pages` holds custom Astro routes and redirects only.

- `docs/foo/bar.md` is served at `/foo/bar/`; `docs/foo/README.md` at `/foo/`.
- A top-level folder appears in the sidebar when it has a `README.md` or `README.mdx` without
  `sidebar.hidden: true`. Folders below it are discovered recursively.
- File and folder names are URL slugs: short, lowercase, and stable. Put human names in `title`.

## Audience
<!-- anchor: audience -->

The repository is public and every page outside `docs/en/wiki/` is indexed by search engines. Decide
which kind of page you are writing, because the rules are opposite:

- **A guide** teaches readers to run their own deployment. Use second person and placeholders for
  anything tied to one account (`<gcp-project-id>`, `<resource-group>`). A reader who copies a literal
  project ID gets an error, so a real ID in a guide is a bug.
- **A runbook** operates the project's own production. It lives in `docs/en/wiki/` with real resource
  names, linked from the related architecture page rather than the sidebar. Cloud runbooks live under
  `docs/en/wiki/cloud/<provider>/` on the `release` branch.

A page that is part of each gets split: the description stays public and the procedure moves to
`wiki/` with a one-line pointer.

Never write credentials, API keys, tokens, private keys, connection strings, tenant IDs, or the
production VM's IP on any page. GitHub push protection blocks credentials but not infrastructure
identifiers.

## Frontmatter

```yaml
---
title: "User Guides"
sidebar:
  groupLabel: "User Guides"   # on a folder README only
  order: 90
---
```

| Field | Use |
|---|---|
| `title` | Page title and default sidebar label |
| `description` | Search and link-preview text; generated from the first paragraph when absent |
| `sidebar.label` | Sidebar-only label |
| `sidebar.groupLabel` | Folder label, set on that folder's README |
| `sidebar.order` | Order among siblings |
| `sidebar.hidden` | Hide a page or top-level folder |
| `aiGenerated` | `false` removes the draft disclaimer after human review |

The sidebar builder reads strings, numbers, booleans, and one nested level. The disclaimer is added
at render time by `MarkdownContent.astro`, never written into Markdown. Translated pages follow the
review rules in [Docs Site Localization](/contributing/localization/docs-site/#review-state).

## Search and `llms.txt`

- Open every page with one or two plain sentences before any heading, list, or component.
  `apps/docs/src/routeData.ts` turns that paragraph into the meta description.
- Add `description:` when the opening does not summarize the page. Keep it under about 160
  characters, or about 80 for scripts without spaces (per-locale budgets are in
  `src/constants/docsLocales.ts`).
- `wiki/` is `noindex`, out of the sidebar, and out of every `llms*.txt` set.
- The build writes English-only `llms.txt`, `llms-small.txt`, and `llms-full.txt`.
  `apps/docs/scripts/checkLlmsOutput.ts` fails the build if a wiki page or a non-English URL leaks
  in, or if a curated set is empty. When a page moves between audiences, update its page ID in
  `apps/docs/astro.config.mts`; the local `starlight-llms-txt` patch exists because upstream
  `exclude` only covers the abridged output.

## Links

Link between pages with root-absolute URLs that end in a slash: `[Manual Setup](/self-hosting/manual-setup/)`.
Pages deploy as directories, and relative links are not rewritten, so `./setup-wizard` on
`/self-hosting/manual-setup/` points at `/self-hosting/manual-setup/setup-wizard`. Only `README`
index pages, which sit at their directory root, may use `./child` links.

Pin any heading that is a link target with an anchor comment directly below it:

```md
## Keyword Tags
<!-- anchor: keyword-tags -->
```

`apps/docs/src/remarkHeadingIds.ts` removes the comment and uses it as the heading id, so rewording
or translating the heading keeps links working. `bun run check-locales` resolves every internal link
and fragment, including the bot's `DOCS_ROUTES`.

## Moving pages

1. `git mv` the file.
2. Update links in `docs/`, `README.md`, `.github/`, `AGENTS.md`, and `docs/README.md`.
3. To keep an old URL working, add it to the `redirects` map in `apps/docs/astro.config.mts` (a
   meta-refresh page) and add 301 rules to `apps/docs/public/_redirects` with and without the
   trailing slash (real redirects on Cloudflare).
4. Run `cd apps/docs && bun run build`.

## Components and images

Use Starlight's `Card`, `CardGrid`, `LinkCard`, and `LinkButton`. Keep screenshot cards to landing and
router pages, where the screenshots are worth maintaining. Site images must be under
`apps/docs/public`; root `assets/img` is for the repository README and is not deployed.

## Prose

Run `bun run audit-comments --docs <file>` on pages you write. It applies the calibrated slop-guard
rules and the plain-word patterns from the `lint-prose` skill (`.agents/skills/lint-prose/SKILL.md`),
which lists the full rules. It is an on-demand check and not part of CI.
