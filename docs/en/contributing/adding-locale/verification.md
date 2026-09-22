---
title: "Verification"
---

Run the gates per locale, in this order. The localization checks come first because they are cheap and
they catch the errors that a later full-suite run would bury under unrelated output.

Most of these accept `--locale=<code>`, which scopes the run to one tree. A scoped run is the right
default for a translation lane: a full scan reports every locale's existing debt alongside the new
work. `check-locales` and `check-locale-markers` have no scope flag and always scan every authored
locale.

## The Gate Sequence

```bash
# Localization safety
bun run check-locales                              # key parity, all authored locales
bun run check-locale-placeholders --locale=<code>  # {placeholder} parity against en-US
bun run check-locale-lengths                       # Discord 45/100 code-point caps
bun run check-locale-markers                       # protocol keys, templates, collisions
bun run check-locale-links --locale=<code>         # project routes and heading fragments
bun run find-stale-translations --locale=<code>    # translation review queue
bun run check-intent-packs --locale=<code> --requests=<file.json>  # natural requests reach tools
# Add --export to write the review list to scripts/maintenance/stale-translations.json.
# Add --reason=drifted for historical source drift, or --reason=unfollowed --base=origin/main for branch follow-up.

# Repository gates
bun run check-seed-catalogs   # i18n map shape and catalog invariants
bun run check                 # TypeScript strict
bun run lint:ci               # Biome, no writes
bun run test                  # unit, isolated-unit, and DB lanes
```

Then run the docs build, which is a separate package:

```bash
cd apps/docs && bun run build
```

It runs `astro build` and then `scripts/checkLlmsOutput.ts`, which verifies that `llms.txt` and its
siblings stay English-only and that `hreflang` matches the files on disk. A fallback route that
advertises an alternate fails the build rather than warning.

## What Each Gate Catches

| Gate | Fails on | Exit behavior |
|---|---|---|
| `check-locales` | A key missing from every locale | Exit 1 is fatal; parity gaps in one locale are advisory exit 2 |
| `check-locale-placeholders` | An English placeholder absent from the translation | Exit 1; a placeholder the translation adds is an advisory warning |
| `check-locale-lengths` | Modal titles or input labels over 45 code points, or command, option, choice, and placeholder text over 100 | Exit 1 |
| `check-locale-markers` | A protocol key absent from an authored locale, a template placeholder mismatch, a missing literal anchor, or two keys rendering the same title | Exit 1 |
| `check-locale-links` | A project-owned docs route or heading fragment that resolves to nothing | Exit 1 |
| `find-stale-translations` | Values that are byte-identical to English, English-looking text in a non-Latin script, historical source drift, and branch-local English changes that a translation did not follow | Exit 0 with a report, findings or not; 1 for an invocation or script error such as an unauthored locale; 2 when a requested history scan cannot read the history it needs |
| `check-intent-packs` | A deliberate target or `explicit_memory` pack that is empty for the locale, fewer than three requests for a target, or a request that does not reach its expected tools | Exit 1 |
| `check-seed-catalogs` | `i18n` map shape, persona uniqueness, unpaired sample dialogues, sprite validity | Exit 1 |
| `check` | Any type error, including a `pt-br` key that is not a `LocaleCode` | Exit 1 |
| `test` | Behavior regressions | Exit 1 |

Two gates are known to report pre-existing debt that is not caused by a new locale:

- `check-locales` reports the Japanese parity gap as an advisory exit 2. Nothing is missing
  everywhere, so the run still proves the required invariant.
- `check-locale-links --locale=ja` reports two Japanese heading-fragment drifts, in
  `src/locales/ja/providers.ts` and `src/locales/ja/commands/setup.ts`. Japanese catch-up owns them.

### Drifted Translations

A key can be fully translated and still be wrong, because the English it was written against has
changed since. Neither comparison above can see that: the value is not identical to English, and it
is written in the locale's own script. `find-stale-translations` reports these as a third reason,
`drifted`.

The baseline comes from Git rather than a stored manifest. `git blame` reports the commit that last
changed each key's own translated line, and the English file at that commit is the English the
translator was working from. A key is reported when its English now differs from that version. There
is no artifact to regenerate and nothing to keep in sync, so the measurement cannot itself go stale.

Two properties are worth knowing before acting on the list:

- **The count is a floor, not a census.** The baseline is per key, so retranslating one key in a file
  leaves its neighbours on their own older baselines. Drift is under-reported rather than invented.
- **A listed key may still read correctly.** English can change wording without changing meaning, for
  example a rename from `ImageGen` to `Image Generation`. Review each entry rather than
  retranslating the list.

Values are compared the way the runtime loads them: the localizer dedents a multi-line string by the
indent its first line establishes, and this scan applies the same rule to both sides. A reflowed
sentence is therefore not a change, while a newline the runtime keeps is. Markdown hard breaks,
fenced blocks, and the `-#` panel markers survive that dedent, so editing one of them is reported.
A value rewritten from a template literal to a quoted string is not a change either.

Every input describes the same revision. The scan reads values and blame from `HEAD`, so an
uncommitted edit to a locale file is ignored rather than half-applied, and the report never mixes a
committed translation with working-tree provenance.

The scan reads history, so a shallow clone cannot answer it, and it fails in the direction that
matters: blame attributes every line to the grafted root, whose English file is the newest the clone
holds, so the comparison would find nothing and read as clean. That case exits 2 with the fetch
command that unblocks it rather than printing a clean report. The reason subset also passes through
`--export`, where each drifted entry carries the superseded English alongside the current value.

### Branch Follow-up

`bun run find-stale-translations --reason=unfollowed --base=origin/main` asks a narrower review question: which `en-US` keys did this branch add, materially change, or remove while a translation did not move with them? It compares the merge base with committed `HEAD`, so work that landed on `main` after the branch started is not blamed on the branch.

Added and changed keys list existing translations to review separately from locales that still render the English fallback. Removed keys are listed for cleanup, not translation. Every non-English locale is advisory follow-up. A touched translation can still be wrong, and an untouched one can still be correct after a non-semantic English edit, so this reason exits zero on findings.

This reason needs a usable base ref. A shallow clone or unavailable base exits 2 with the fetch or ref error instead of claiming the branch is clean. It shares `--export` with the other reasons; exported entries include the current English, prior English when applicable, and the current translation when one exists.

Report a gate failure with its exact output rather than describing it. A gate that was not run is not a
passed gate.

## Locale Failures Only `test` Reports

Passing every localization gate does not make `bun run test` pass, because several locale checks live
only in the unit lane:

- **Panel runtime formatting.** `tests/unit/discord/panelProseRuntime.test.ts` builds localized panel
  payloads and verifies that the shared container boundary already formatted every `TextDisplay`.
  Write natural prose and reserve newlines for paragraphs, lists, quote rows, and other semantic
  structure. Thumbnail context and repeated `-# ` or `> ` markers are inferred from the component
  tree. `check-locale-lengths` still enforces Discord's hard component limits, which runtime visual
  wrapping does not replace.
- **Fixtures that list the authored locales.** The personal language picker test asserts every
  endonym in `tests/unit/discord/personalConfigRoutes.test.ts`, and
  `tests/unit/db/personaNamingCatalog.test.ts` asserts each persona's `namingConfig` per language.
  Both are exact on purpose, so they fail when a locale lands. Add the new locale's reviewed values
  instead of loosening the assertion.
- **Docs publication.** `tests/unit/docs/docsLocaleConfig.test.ts` fails when a `docsTree` flag and
  the directories under `docs/` disagree. The docs build also fails when the root landing page does
  not link to every published locale. Flipping `docsTree` is the change these checks expect, so they
  stay green only when the tree and the flag land together.

## The Gate No Script Replaces

**Boot the bot and confirm command registration succeeds.**

An invalid Discord locale folder name fails registration for *every* command in *every* language, and
nothing above catches it. The localization checks read the tree; only registration proves Discord
accepted the key.

Boot also asserts the protocol-key map. Two protocol keys rendering to the same title in any loaded
locale is a startup failure, on the same grounds as an invalid locale code: the runtime cannot
recover from an ambiguous title, and startup is the only place the ambiguity is still visible.

## The Gate No Tool Can Automate

**A protocol key's translation is frozen after that locale's first release.**

Editing a released protocol value orphans every embed already posted with the old title in that
locale's servers, because classification rests on the rendered title alone.
`sliceMessagesAtResetMarker` reports no marker rather than an error, so the user's `/reset` or
`/refresh` quietly stops applying with no log line and no failing test.

The review checklist in [UI Strings](/contributing/adding-locale/ui-strings/) has to carry this,
because the ship-unreviewed-then-review-later flow is exactly the sequence that triggers it. Review
every protocol value before the locale's first release, and after release treat the value as data
rather than as prose.

## Migrations

A locale addition needs no migration. The `descriptions` JSONB columns already exist (migration `081`),
and the legacy per-language columns are gone (migration `082`). Adding a locale's descriptions is a
seed-only change.

Run the migration gates only if the change touches schema or seed writers:

```bash
bun run check-migrations   # numbering uniqueness and up/down pairing, working tree only
bun run check-seed-catalogs
```

`check-migrations` cannot see a colliding number on another branch, because Git does not conflict on
two differently named files. A cross-branch scan is part of the procedure for any new migration.

## Docs App Typing

The root `bun run check` does not cover `apps/docs`. Its `routeData.ts` and `docsRouting.ts` reach
`@astrojs/starlight` and `astro:content`, which resolve only under `apps/docs/node_modules`, so the
root tsconfig cannot include them. `bun run build` in `apps/docs` is the only type-level check those
files get today, and it doubles as the `hreflang` and `llms.txt` verifier.

Adding `astro check` to the docs package is the open improvement. It needs `@astrojs/check` plus
`typescript` as docs-only dev dependencies, and it is not installed yet, so do not claim a docs type
gate that does not exist.

## What To Report

A completed locale lane reports:

- The gate commands that ran, with their exit codes and any finding text verbatim.
- Any key authored differently from the English meaning, and why.
- Which protocol values were reviewed and frozen.
- Any fragment whose translated heading changes the anchor.
- Any third-party localization candidate that was left unverified.
- Any check failure outside the lane's allowed scope, with the file paths involved.

## Definition Of Done

A locale is ready to publish when every gate above passes, the bot boots and registers commands, the
protocol values are reviewed, and either the translated tree and README exist or they are deliberately
deferred with `docsTree: false` and the root switcher row still disabled.

## Related Docs

- [UI Strings](/contributing/adding-locale/ui-strings/): the required tier and the freeze rule
- [Documentation](/contributing/adding-locale/documentation/): the docs build and publish step
- [Testing DB Changes](/contributing/testing-db-changes/): database lanes and disposable Postgres
- [Docs Site Localization](/contributing/docs-site-localization/): the docs build's own checks
