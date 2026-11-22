---
name: sync-locales
description: Translate the English changes on the current branch into every authored TomoriBot locale, covering locale keys under src/locales/, translated docs pages under docs/, and the translated READMEs. Use when a diff edits src/locales/en-US/, reader-facing pages under docs/en/, or README.md, and the user asks to update, sync, or translate the other locales.
---

# Sync locales

Contributors only have to write English. Other locales fall back to English for any key or docs page
they do not define, so this skill is a follow-up that brings the translated surfaces level with a
branch's English changes. Run it only when asked.

## Find the work

Use the parity check for missing locale keys and the history scan for branch follow-ups.
These commands assume a branch targeting `main`. Set `--base` to the actual target ref for other branches.

```bash
bun run check-locales --verbose
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

- New English keys show up as parity gaps in `check-locales`; edited keys show up as unfollowed.
  `check-locales` exits 2 when only parity is missing; that is advisory.
- Docs pages appear under "Docs pages this branch changed without updating the translation", one
  line per page with the locales still behind. `[English added]` means no translation exists yet;
  `[English removed]` means the translation should be deleted with it.
- A shallow clone makes the command exit 2; run `git fetch --unshallow` and retry.

Limit the work to what the branch touched. Pre-existing gaps belong to their own change;
`bun run find-stale-translations --scope=docs` lists the whole-tree backlog when asked for it.

## Delegate per locale

The parent session assigns work and verifies the results. Each worker edits only its assigned locale.

Assign one fresh worker to each affected locale and run them in parallel. When slots fill, start
the remaining locales in fresh workers as slots open. Keep each worker's files and context isolated
to that locale. Give it the English changes or missing source keys, this skill, its own
`references/glossary-<locale>.md`, and the matching files in `src/locales/<locale>/`,
`docs/<locale>/`, and `.github/README_<locale>.md`. Leave other workers' translations out of its
context. If the harness cannot provide a separate worker for a locale, report that locale as pending.

Choose the worker model for the task. Short, well-specified key updates can use a fast model.
Longer prose or persona dialogue needs a model that can preserve register and voice.

Once all locale workers finish, run `bun run generate-command-reference` once in the parent
session if command descriptions changed. Then run the verification steps below.

## Translate locale keys

The authored trees are the directories under `src/locales/` other than `en-US`. Each mirrors the
English file layout, so a key lives at the same path in every tree.

## Translate docs pages

- A page at `docs/en/<path>` translates to `docs/<locale>/<path>` for every locale with a published
  docs tree (`docsTree: true` in `src/constants/docsLocales.ts`). `README.md` translates to
  `.github/README_<locale>.md`.
- `README_ja.md` shows Japanese screenshots from `assets/img/scs/ja/`; keep those paths. When
  English adds or renames a screenshot, keep the English image there and report that it has no
  Japanese version yet.
- `architecture/`, `contributing/`, and `wiki/` stay English. Never translate or create them; the
  command already leaves them out.
- `features/command-reference.md` is generated from the command description keys. The parent
  regenerates it after the locale workers finish. Keep this file out of manual translation edits.
- Translate the whole changed passage in its context, and keep the
  translated page's existing structure and wording elsewhere.
- Translate the frontmatter `title` and `description`. Copy `aiGenerated: true` or
  `aiGenerated: false` from English, or omit the field when English omits it. The field tracks
  review of the source content. Keep other frontmatter fields as they are in the translation.
  Check review-status changes against the English diff because the history scan ignores this field.
- In docs pages and component links, use unprefixed internal routes so the build can pick the
  locale or fall back to English. In translated READMEs and locale strings, use absolute
  `https://docs.tomoribot.app` links with the target locale prefix, or `/en/` if the page has no
  translation. See `docs/en/contributing/localization/docs-site.md` for the link rules.
- Keep every `<!-- anchor: english-slug -->` (in MDX, `{/* anchor: english-slug */}`) comment under
  its heading exactly as it is: it is the English anchor that links in every locale target.
- UI labels are the exception to "code spans stay verbatim". A code span that names something the
  bot shows (`Finish Setup`, `Add MCP`) holds that locale's UI text, copied from the value of the same
  key in `src/locales/<locale>/`, never your own translation and never the English with a gloss.
  Search the English file for the label to find its key. Discord's own labels (`Manage Server`) use
  the Discord client's wording in that language.

## Shared rules

For each target locale, read `references/glossary-<code>.md` first and follow it over your own
preferences. It fixes register, forms of address, product terms, and renderings that were already
rejected. When a term is missing from the glossary, reuse the rendering the locale's existing strings
or pages already use for it.

Keep these byte-for-byte: placeholders (`{user_nickname}`), slash commands, option names, code,
external URLs, environment variable names, product names, and Discord markers (`-# `, `> `, fenced blocks).
Use the docs link rules above for links to TomoriBot documentation.

Locale prose follows the repository dash rule. In `ja`, use `：`, `。`, and `（）` instead of dashes;
the Chinese glossaries state their own punctuation.

Persona-voiced strings keep the persona's character. Preserve that voice in the translation.

## Verify

```bash
bun run check-locales
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

Use the same target ref for both history scans. The follow-up command reads committed `HEAD`,
so uncommitted translations still appear in it. Leave committing to the user. Resolve
fatal `check-locales` findings, such as Discord and modal limits, by shortening the translation.
Leave English as the source. Report keys or pages you could not translate confidently.
