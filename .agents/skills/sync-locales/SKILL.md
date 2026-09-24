---
name: sync-locales
description: Translate the English locale changes on the current branch into every authored TomoriBot locale. Use when a diff adds or edits keys under src/locales/en-US/ and the user asks to update, sync, or translate the other locales.
---

# Sync locales

Contributors only have to write `en-US`. Other locales fall back to English for any key they do not
define, so this skill is a follow-up that brings the authored trees level with a branch's English
changes. Run it only when asked.

## Find the work

New English keys show up as parity gaps, and edited English keys show up as unfollowed changes:

```bash
bun run check-locales --verbose
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

`check-locales` exits 2 when only parity is missing; that is advisory. A shallow clone makes the
second command exit 2 as well; run `git fetch --unshallow` and retry.

Limit the work to keys the branch touched. Pre-existing gaps belong to their own change.

## Translate

The authored trees are the directories under `src/locales/` other than `en-US`. Each mirrors the
English file layout, so a key lives at the same path in every tree.

For each target locale, read `references/glossary-<code>.md` first and follow it over your own
preferences. It fixes register, forms of address, product terms, and renderings that were already
rejected. When a term is missing from the glossary, reuse the rendering the locale's existing strings
already use for it.

Keep these byte-for-byte: placeholders (`{user_nickname}`), slash commands, option names, code,
URLs, environment variable names, product names, and Discord markers (`-# `, `> `, fenced blocks).

Locale prose follows the repository dash rule. In `ja`, use `：`, `。`, and `（）` instead of dashes;
the Chinese glossaries state their own punctuation.

Persona-voiced strings keep the persona's character. Translate the voice, not only the words.

## Verify

```bash
bun run check-locales
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

Fatal `check-locales` findings (Discord length caps, modal limits) must be fixed by shortening the
translation, never by editing English to make room. Report any key you could not translate
confidently instead of guessing.
