---
title: "Adding a Locale"
sidebar:
  groupLabel: "Adding a Locale"
---

import { CardGrid, LinkCard } from "@astrojs/starlight/components";

Adding a display language to TomoriBot touches four disjoint surfaces: runtime strings under
`src/locales/`, seed-catalog metadata, the documentation site, and the repository README. This guide
defines which of those are required, which are optional, and the order to work in.

Every page here assumes `src/locales/en-US/` is open beside you. English is the canonical key
structure, and a translated tree that invents keys is a bug rather than a translation.

<CardGrid>
  <LinkCard title="Locale Codes" href="/contributing/adding-locale/locale-codes/"
    description="The Discord code table, why a folder name is load-bearing, and the alias mechanism." />
  <LinkCard title="UI Strings" href="/contributing/adding-locale/ui-strings/"
    description="The required tier: key patterns, the English-for-the-model rule, and the protocol-key freeze." />
  <LinkCard title="Seed Catalog" href="/contributing/adding-locale/seed-catalog/"
    description="Locale-keyed descriptions, the fallback chain, and persona voice authoring." />
  <LinkCard title="Documentation" href="/contributing/adding-locale/documentation/"
    description="Translated page scope, review notices, hreflang, and the site middleware." />
  <LinkCard title="README And Repo" href="/contributing/adding-locale/readme-and-repo/"
    description="Translated READMEs, the language switcher, and localized link rules." />
  <LinkCard title="Verification" href="/contributing/adding-locale/verification/"
    description="The per-locale gate sequence, in the order it has to run." />
</CardGrid>

## Required And Optional Tiers

A locale can ship useful with only the required tier. Nothing in the optional tier blocks a release,
and everything optional degrades to English rather than to a broken surface.

| Surface | Tier | Degrades to |
|---|---|---|
| `src/locales/{code}/**` (UI strings) | Required | Per-key English fallback |
| Protocol keys inside the locale tree | Required and frozen | No fallback: historical embeds stop matching |
| `general.language_name`, `general.defaults.bot_name`, `general.defaults.base_trigger_words` | Required | The locale code itself, the env default, and the English trigger list |
| `docs/{locale}/**` (translated pages) | Optional, recommended | English content with `noindex` |
| `.github/README_{code}.md` | Optional, recommended | The English README |
| Seed `i18n` descriptions | Optional, recommended | English description |
| `tools.intent_packs` | Recommended | The union drops to the packs that do exist |
| Persona voice authoring | Optional per locale, required for the shipped roster | English preset content |

Only `en-US` and `ja` are authored today. The eight target locales (`pt-BR`, `es-419`, `fr`, `zh-TW`,
`zh-CN`, `vi`, `ru`, `ko`) are registered in the shared docs configuration and are waiting for their
trees.

## Definition Of Done

1. The tree exists at `src/locales/{code}/` under a valid Discord locale folder name.
2. `general.language_name` is the language's own name, not a translation of "English".
3. Every key in `src/locales/en-US/` has a counterpart, or is left out deliberately for the English
   fallback.
4. Protocol keys are reviewed before the locale's first release, then frozen.
5. `tools.intent_packs` entries are authored as native phrasing rather than translated English.
6. The docs tree and translated README are optional; the guide to publish them is
   [Documentation](/contributing/adding-locale/documentation/) and
   [README And Repo](/contributing/adding-locale/readme-and-repo/).
7. The full gate sequence in [Verification](/contributing/adding-locale/verification/) passes.
8. The bot boots and registers commands. An invalid locale code fails registration for every command,
   and no script catches it.

## Shared Files And Disjoint Work

Locale work is designed to be split across agents that never edit the same file. Each locale owns
`src/locales/{code}/**`, `docs/{locale}/**`, and `.github/README_{code}.md`, and none of those paths
is shared with another locale.

The remaining shared files are pre-staged so a translation lane does not have to edit them:

| Shared file | Pre-staged for every target locale | What a locale lane still does |
|---|---|---|
| `src/constants/docsLocales.ts` | The locale row with its endonym and description budget | Flip `docsTree` to `true` when the page tree lands |
| `apps/docs/functions/_middleware.ts` | The routed locale list | Nothing |
| `apps/docs/public/_redirects` | The two-line locale root pair | Nothing |
| `README.md` language switcher | The locale table | Nothing |
| `src/db/seed/catalog/**` | One `i18n` map per entry | One dedicated lane owns all locale keys |

The `docsTree` flag is the publish switch. While it is `false`, the docs build registers no route, no
sidebar, no sitemap entry, and no `hreflang` alternate for that locale, and the bot's docs links stay
on English. A pre-staged locale root serves a 404 until its tree exists, which is the honest answer for
a URL with no content behind it.

Seed catalogs are the one genuine exception: `models.ts`, `naiPresets.ts`, and `systemPrompts.ts`
hold every locale's descriptions in the same three files. Per-locale lanes must not edit them
concurrently. One dedicated worker adds every locale's `i18n` entries after the glossaries are
accepted, which is why [Seed Catalog](/contributing/adding-locale/seed-catalog/) describes a
hand-off rather than a per-locale edit.

One in-tree edit is deliberately left to the moment a locale publishes: the hardcoded absolute docs
URLs inside `src/locales/{code}/**` move from `/en/...` to `/{code}/...` once that locale's page tree
exists. It is a run over the lane's own files rather than a shared-file change, and
[Documentation](/contributing/adding-locale/documentation/) names the files that carry URLs today.

## Related Docs

- [Localization System](/architecture/subsystems/localization/): `localizer()` API, locale discovery, fallback chain
- [Docs Site Localization](/contributing/docs-site-localization/): the docs site surfaces in detail
- [Adding a Persona Preset](/contributing/adding-persona-preset/): the preset structure a locale voice fills
- [Comment Policy](/contributing/comment-policy/): the prose rules locale strings also follow
