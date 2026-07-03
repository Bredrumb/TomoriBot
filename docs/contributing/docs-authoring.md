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

## SEO

The docs site handles most SEO automatically:

- **Meta descriptions**: when a page has no `description` frontmatter, the route middleware
  (`apps/docs/src/routeData.ts`) derives one from the page's first prose paragraph at build
  time. A hand-written `description:` always wins, so add one when the opening paragraph
  does not summarize the page well. Keep it under ~160 characters.
- **First paragraphs matter**: because they become search snippets, open each page with one
  or two plain sentences that describe the page, before any heading, list, aside, or
  component.
- **Internal pages**: everything under `docs/wiki/` is marked `noindex` and stays out of
  search engines. Put maintainer-only records there.
- **robots.txt / sitemap**: `apps/docs/public/robots.txt` advertises the auto-generated
  `sitemap-index.xml`. No per-page action needed.

## Moving Pages

When moving docs:

1. Use `git mv` for tracked files when possible.
2. Update links in `docs/`, `README.md`, `.github/`, and release notes when relevant.
3. Update `docs/README.md` when section structure changes.
4. When old URLs should keep working, add both an entry in the `redirects` map in
   `apps/docs/astro.config.mjs` (meta-refresh fallback page) and matching 301 rules in
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
