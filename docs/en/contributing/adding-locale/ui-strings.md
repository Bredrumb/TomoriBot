---
title: "UI Strings"
---

Runtime strings live in `src/locales/{code}/` and are the required tier: a locale with a complete tree
is a usable display language even before its documentation exists. The tree mirrors
`src/locales/en-US/` and splits by area: `general.ts`, `tools.ts`, `providers.ts`, `bridges.ts`,
`commands.ts`, and `commands/`.

`commands.ts` is an executable assembler, not a static inventory. Its imports must point to the new
locale's `./commands/<file>` modules. Leaving `../en-US/commands/<file>` imports in a copied assembler
makes an apparently translated command tree render English at runtime. Before accepting a locale, verify
that its assembler has no `../en-US/commands/` imports and that it loads successfully.

## Structure And Key Patterns

Copy the English tree's shape rather than inventing one. Keys are dot-notation paths
(`commands.{category}.{subcommand}.{key}`), and the checker reads keys statically, so a key built from
a template literal in the locale file is invisible to parity checks.

Two naming conventions are load-bearing because `commandLoader` localizes them automatically:

- Option and parameter descriptions use `{option_name}_description`.
- Choice labels use `{choice_value}_option`.

Using `{option_name}_option` for a description fails silently: the description falls back to English
while the key looks correct in the file.

## What Falls Back, And What Does Not

`localizer()` resolves the requested locale, then its alias, then an unambiguous base language, then
the `en-US` value for that same key, and only then returns the raw key path. Two properties follow:

- A partial locale degrades to English per key. It never shows a user a dotted key path and never
  needs 100 percent parity to be usable.
- A key missing from every locale is still a bug, and `bun run check-locales` exits 1 for it.

The fallback is a runtime safety net, not permission to ship gaps. Author what you can, and treat the
advisory parity report as a work list rather than a pass.

## If The Model Reads It, It Stays English

Only user-rendered output is localized. Tool schema `description:` fields in
`src/tools/functionCalls/*.ts` are hardcoded English string literals and never pass through
`localizer()`, deliberately: a localized tool schema degrades tool-calling accuracy in a way no
automated check would catch.

The tool return shape makes the split explicit. `error` is English for machine consumption, `message`
is localized for display. The same rule covers system prompt bodies (`systemPrompts.ts`
`preset_prompt_text`), which stay English while only their user-facing descriptions are localized.
Interpolated values that reach the model, such as dates, durations, and lateness figures inside model
context, also stay English even where the same value is localized for a user sink.

`src/locales/{code}/tools.ts` looks like part of that boundary and is not: every string in it renders
into a Discord embed, so it localizes normally.

## Protocol Keys Are Frozen

A set of bot-produced embeds carries meaning in its title string. The read side does not know which
locale wrote a message, so it compares a title against every loaded locale's rendering to classify
the embed. `PROTOCOL_KEYS` in `src/utils/discord/embedProtocol.ts` names every key whose value is
compared rather than merely displayed.

**A protocol key's translation is frozen after that locale's first release.** Correct it before
release; never after. The bot writes no footer token on new embeds, so classification rests on the
rendered title alone. Rewriting a released value orphans every embed already posted with the old
title in that locale's Discord servers, including the reset and compact-refresh embeds that history
slicing depends on. The failure is silent: `sliceMessagesAtResetMarker` reports no marker rather
than an error, so a user's `/refresh` quietly stops applying and no log or test fails.

Rules to work by:

| Rule | Reason |
|---|---|
| Review every protocol key before the locale's first release | It cannot be corrected afterward |
| Add a new classification key to the registry before shipping it | Otherwise the reader cannot see it |
| Keep placeholders and literal anchors intact | Templates are matched with placeholder spans blanked, and a template needs a literal part to anchor on |
| Avoid a short title that another key could also render | Two keys rendering the same string in one locale is a startup failure |
| Never end a reward or punish title with a period | The classifier uses an explicit key-existence check, and a trailing period used to drop a title from classification |

`bun run check-locales` verifies protocol key presence, template placeholder parity, literal anchors,
and cross-locale title collisions. The runtime check runs at startup as well, because a collision has to
fail loudly rather than misclassify embeds under traffic.

## Intent Detector Packs

Heuristics that read the user's message rather than the bot's reply localize through per-locale
keyword packs under `tools.intent_packs` in the locale's `tools.ts`. Three families exist:
deliberate tool mode targets (`deliberate.image`, `deliberate.reminder`, and thirteen more), and
`explicit_memory` for a direct "remember this" request.

Packs are a recommended tier. A locale with no pack still works: matching uses the union of every
authored locale's pack, so adding one later widens coverage for every user of the bot.

Authoring rules:

- **Write what a native speaker actually types**, not a translation of the English patterns. The
  English entries are a reference for meaning, not a template for wording.
- **Entries are literals.** A trailing `*` matches a word stem (`messag*`). No other regex syntax is
  accepted, and a violating entry throws at startup rather than silently matching everything.
- **Lean toward recall.** A false positive only exposes a tool the model already has, and only while
  the mode is off, so missing a real request costs more than an extra match.
- **Cover the registers people type in chat.** Include casual and formal imperatives, spellings with
  and without diacritics, and phrasings with demonstratives. The pilot pack carried only formal
  Portuguese imperatives and missed most casual requests.
- **Keep a stem from starting common words in another supported language.** Matching unions every
  locale, so `cita*` would also fire on English "citation"; use a longer phrase instead.
- **Two characters minimum in Han, kana, or Hangul.** A single ideograph or syllable matched as a
  substring would fire on most messages in that script.
- **English deliberate packs stay empty by design.** The built-in English patterns in
  `deliberateToolMode.ts` already cover English phrasing, and entries there would widen matching past
  those patterns.

Verify a pack with natural requests rather than by reading its entries. Write a request file before
looking at the pack, with at least three casual requests per deliberate target and for
`explicit_memory`, then run `bun run check-intent-packs --locale=<code> --requests=<file.json>`.
Requests written after reading the pack tend to reuse its wording and pass without proving coverage.

Matching is script aware: a pack entry containing Han, kana, or Hangul is matched as a substring,
because those scripts have no spaces and Hangul attaches particles directly to the noun. Latin,
Cyrillic, and other spaced scripts use a Unicode-aware word boundary, so an accented word is not
matched mid-word.

## Text Processing Follows Scripts, Not Locales

The humanizer and the message splitter classify text by character script, never by the user's locale,
because a persona may reply in a different language than the user reads. A rule applies to every
script that has the feature it targets, and a script without the feature is left untouched.

What that means for a locale:

- **Case folding applies to cased scripts only.** Latin, Cyrillic, and Greek words are lowercased
  outside acronyms and internet expressions. Han, kana, and Hangul have no case, so they pass through
  unchanged.
- **Prose commas are per script.** A full-width comma (`、`, `，`, `､`) rolls without requiring
  following whitespace, because CJK prose has none. An ASCII comma only counts as prose punctuation
  when whitespace or the end of the text follows it, which protects `1,000` and `a,b`.
- **Terminators are per script.** Full-width `！` and `？` roll without a space requirement, while an
  ASCII `!` or `?` run needs whitespace or the end, which protects `<@!123>` and `!help`.
- **Paired quotation marks are protected in every script that has them.** `「」`, `『』`, `｢｣`, `«»`,
  `‹›`, `“”`, `〈〉`, and `《》` all keep their contents unsplit, so a flush never leaves one side of a
  pair as broken syntax in a separate Discord message.
- **Word boundaries are per script.** An emphasis marker glued to Latin, Cyrillic, or Greek letters
  sits inside a word and is not emphasis (`f***ing`), while Han, kana, and Hangul write without
  spaces, so a `*` glued to those letters is (`ふん*顔をそむける*わけ`). The exemption is for `*`
  only: `_` glued to a letter is an identifier in every script, and `~~` glued to kana is a
  wave-dash elongation (`やだ~~w`), not strikethrough. That decision covers both the stream
  buffer's hold and the `HEAVY` message splitter.
- **Sentence splitting recognizes full-width periods** (`。`, `．`, `｡`) alongside ASCII `.` and
  matches a wide abbreviation list, including a few non-English address and title forms.

There is no per-locale configuration to add for any of this. A locale whose script already appears in
the rules is covered, and a locale whose script needs a feature the rules do not implement is a code
change in `src/utils/text/processors/`, not a translation task. Left-to-right is assumed throughout;
none of the target locales is right-to-left.

## Locale String Conventions

- Follow the project prose rules. No em dashes or spaced double hyphens; in Japanese use `：` and `。`.
- Never repeat a real person's name, handle, or account in a shipped string.
- Keep panel prose inside the width rules in
  [Panel Prose And Layout](/contributing/panel-prose-and-layout/), which applies to every authored
  locale.
- Leave `{placeholder}` tokens exactly as English has them. A missing token is fatal to
  `bun run check-locales`; an extra token is an advisory warning, because a call site may
  supply a variable the English string does not use.
- Respect the Discord length caps: 45 code points for modal titles and input labels, 100 for command
  descriptions, option descriptions, choice names, and placeholders. Counts are code points, not
  UTF-16 units.

## Related Docs

- [Localization System](/architecture/subsystems/localization/): resolution order and the checker's contract
- [Verification](/contributing/adding-locale/verification/): the gates that cover this page
- [Panel Prose And Layout](/contributing/panel-prose-and-layout/): text width and markers in panels
