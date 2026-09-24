---
title: "Docs Authoring Conventions"
sidebar:
  order: 3
---

This guide covers the conventions for adding, moving, and formatting TomoriBot docs pages.

## Source of Truth

Write docs content in repo-root `docs/`.

`apps/docs/src/content/docs` is a junction/symlink to `docs/` for Astro. Do not treat it as
a second copy. `apps/docs/src/pages` is for custom Astro routes and redirects, not ordinary
Markdown docs.

## Routes

- `docs/foo/bar.md` becomes `/foo/bar/`.
- `docs/foo/README.md` becomes `/foo/`.
- A top-level folder appears in the main sidebar when it has a `README.md` or `README.mdx`
  with no `sidebar.hidden: true`.
- Nested folders are discovered recursively under visible top-level folders.

## Audience: Guide or Runbook

The repository is public and the docs site builds every page under `docs/`. Only `wiki/` is
`noindex` and hidden from navigation, so everything else is world-readable and search-indexed.
Decide which of two things a page is before writing it, because the rules are opposite.

**A guide** teaches a reader to operate their own deployment. It uses second person and belongs in
its normal section. **Use placeholders** for anything tied to one account: `<gcp-project-id>`,
`<resource-group>`, `<workspace-name>`. A reader who copies a literal value from a guide gets a
failure, so a real project ID in a guide is a bug, not just an oversight.

**A runbook** performs a procedure against the project's own production. It belongs in `docs/en/wiki/`
and **keeps real resource names**, because substituting placeholders into a runbook makes it wrong.
Link it from the related architecture page rather than the sidebar.

"Specific to a cloud provider" and "specific to our account" are different axes.
Both now live under `docs/en/wiki/cloud/<provider>/` on the `release` branch, because the IaC they
describe ships there too.

Regardless of type, never write credentials, API keys, tokens, private keys, connection strings,
tenant IDs, or the production VM's public IP into any page. GitHub push protection blocks true
credentials but does not flag infrastructure identifiers, so those are on the author.

A page may legitimately be part guide and part runbook. Split it: keep the architecture description
public and move the step-by-step procedure to `wiki/`, leaving a one-line pointer behind. See
`docs/en/wiki/cloud/azure/` on the `release` branch for that shape.

## Frontmatter

Use simple YAML frontmatter. The sidebar builder understands strings, numbers, booleans,
and one nested level.

Page example:

```yaml
---
title: "Entry Point and Initialization Flow"
sidebar:
  order: 4
---
```

Folder README example:

```yaml
---
title: "User Guides"
sidebar:
  groupLabel: "User Guides"
  order: 90
---
```

Common fields:

| Field | Use |
|---|---|
| `title` | Page title and default sidebar label |
| `description` | Meta description for search engines and link previews (optional; see SEO below) |
| `sidebar.label` | Sidebar-only page label override |
| `sidebar.groupLabel` | Folder/group label when set on that folder's README |
| `sidebar.order` | Manual ordering among siblings |
| `sidebar.hidden` | Hide a page or top-level folder from the sidebar |
| `aiGenerated` | Set `false` to opt out of the docs app disclaimer, if enabled |

Filenames and folder names are URL slugs. Keep them short, lowercase, and stable. Use
`title` and `groupLabel` for human-facing names.

### The `aiGenerated` disclaimer and translations

The disclaimer note is injected at render time by the `MarkdownContent.astro` override in
`apps/docs` (never written into markdown files), and it is locale-aware. The wording for each
locale lives in `src/constants/docsLocales.ts`, and a locale with no entry of its own falls back to
the default locale's strings. Which notice a page shows:

| Page | `aiGenerated` in its own file | Notice shown |
|---|---|---|
| Any page, flag unset or `true` | draft | The page locale's draft disclaimer |
| Any page, flag `false` | reviewed or human-written | None |
| Translated page whose English source is `aiGenerated: false` | draft | The page locale's translation notice, linking to the English page. Hidden by default; see below |

The translation notice is reader-facing only when `DOCS_SHOW_TRANSLATION_NOTICE=true` is set in the
docs build environment; it defaults to hidden. Review state is tracked in frontmatter either way: a
translated page without `aiGenerated: false` is an unreviewed machine translation
(`grep -rL "aiGenerated: false" docs/ja/` lists them).

Practical rules: machine-translated pages must NOT carry `aiGenerated: false` (delete the line when
translating a page that has it). After a human reviews and corrects a translation, set
`aiGenerated: false` in the translated file to clear its notice.

### Locale surfaces

Translated pages are served at `/{locale}/` routes, so a locale is added to
`src/constants/docsLocales.ts` rather than to a page's frontmatter. Sidebar labels fall back to the
English label on any group or page whose locale has no counterpart file, and pages without a
translation are served with English content, `noindex`, and no `hreflang` alternate. Adding a locale
and its page tree is covered in [Docs Site Localization](/contributing/docs-site-localization/).

## SEO

The docs site handles most SEO automatically:

- **Meta descriptions**: when a page has no `description` frontmatter, the route middleware
  (`apps/docs/src/routeData.ts`) derives one from the page's first prose paragraph at build
  time. A hand-written `description:` always wins, so add one when the opening paragraph
  does not summarize the page well. Keep it under ~160 characters, or under ~80 for a locale whose
  script is written without spaces; the per-locale budget lives in `src/constants/docsLocales.ts`.
- **First paragraphs matter**: because they become search snippets, open each page with one
  or two plain sentences that describe the page, before any heading, list, aside, or
  component.
- **Internal pages**: everything under `docs/en/wiki/` is marked `noindex` and stays out of
  search engines. Put maintainer-only records there.
- **hreflang**: alternates are emitted only for pages that exist in both the default locale and the
  current locale, and `x-default` points at the English page. A locale route serving English
  fallback content emits none, and is `noindex` as well.
- **robots.txt / sitemap**: `apps/docs/public/robots.txt` advertises the auto-generated
  `sitemap-index.xml`. No per-page action needed.

### Machine-readable documentation

The docs build also generates `llms.txt` entrypoints for AI agents:

- `llms.txt` emphasizes the English `introduction/` and `features/` indexes and links to
  small, commonly useful pages. Agents should fetch the smallest relevant page.
- `llms-small.txt` and the “TomoriBot introduction and features” set contain the curated
  English user-facing surface.
- Self-hosting/public reference and contributor/architecture sets remain available for
  deeper investigation. Every set is English-only: `starlight-llms-txt` reads the default
  locale's entries, so a translated page never reaches these files.
- `wiki/` is excluded from every generated text set, including `llms-full.txt`. The docs
  package build runs `scripts/checkLlmsOutput.ts` to fail if a wiki page leaks, a curated
  set becomes empty, a non-default locale URL appears, or a fallback route advertises an
  `hreflang` alternate.

Keep page IDs in `apps/docs/astro.config.mts` synchronized when moving a page between these
audiences. The local `starlight-llms-txt` dependency patch adds full-output exclusions because
the upstream `exclude` option only applies to the abridged output.

## Internal Links

Always link between docs pages with **root-absolute** URLs (leading `/`, trailing slash),
e.g. `[Manual Setup](/self-hosting/manual-setup/)` or with an anchor
`[…](/self-hosting/manual-setup/#optional-extras-the-manual-full-install)`.

A heading that is a link target should carry an `anchor:` comment immediately after it:

```md
## Keyword Tags
<!-- anchor: keyword-tags -->
```

`apps/docs/src/remarkHeadingIds.ts` removes the comment from the rendered page and assigns its value
as the heading id. This pins the anchor against later rewording and lets every translated tree answer
the same English fragment. Only the English slug belongs in the comment. `bun run check-locales`
resolves every internal link and fragment, including the bot's own `DOCS_ROUTES` table against each
published locale.

Do **not** use relative `./sibling` links from a normal (non-index) page. Pages deploy in
directory format (`/self-hosting/manual-setup/`), and the build does not rewrite relative
links, so `./setup-wizard` from that page resolves to
`/self-hosting/manual-setup/setup-wizard`, a 404. Only `README.md` index pages, which deploy
at their directory root, may use `./child` links.

## Moving Pages

When moving docs:

1. Use `git mv` for tracked files when possible.
2. Update links in `docs/`, `README.md`, `.github/`, and release notes when relevant.
3. Update `docs/README.md` when section structure changes.
4. When old URLs should keep working, add both an entry in the `redirects` map in
   `apps/docs/astro.config.mts` (meta-refresh fallback page) and matching 301 rules in
   `apps/docs/public/_redirects` (real redirects on Cloudflare, listed with and without
   the trailing slash).
5. Run the docs build:

```bash
cd apps/docs
bun run build
```

For code/config changes outside Markdown, also run root `bun run check` and `bun run lint`.

## Cards and Images

Use Starlight built-ins for most docs:

- `Card` and `CardGrid` for compact reference content.
- `LinkCard` when the whole card is a navigation target.
- `LinkButton` for call-to-action rows.

Use custom image cards only for landing or task-router pages where screenshots are worth
maintaining.

Docs-site static images must be present under `apps/docs/public` unless the Astro build
explicitly bundles or copies them. Root `assets/img` is useful for repo and README assets,
but it is not automatically deployed to `docs.tomoribot.app`.
