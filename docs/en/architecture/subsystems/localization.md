---
title: "Localization System"
---

TomoriBot localizes user-facing text through locale files in `src/locales/`.

## Supported Locales

Currently loaded from source:

- `en-US` (default fallback)
- `ja`

## Runtime Architecture

- Loader: `src/utils/text/localizer.ts`
- Locale structure: `src/locales/{locale}/` directories, one `.ts` file per category
- Categories: `general`, `commands`, `providers`, `tools`, `bridges`
- At boot, `initializeLocalizer()` scans each locale directory, imports all category slices, and merges them into a single tree via `Object.assign`
- Locale values are nested objects accessed through dot-path keys. `general.defaults.base_trigger_words` is a string array used for locale-specific persona defaults.
- `tools.intent_packs` holds keyword lists that let non-English messages reach detectors whose built-in patterns are English: `deliberate.<target>` for each Deliberate Tool Mode target and `explicit_memory` for explicit memory requests. `src/utils/text/localeIntentPacks.ts` unions every authored locale's list instead of following the user's preference, because members of a bilingual server type in either language. Entries are literal text with an optional trailing `*` word stem, no regex syntax, and at least two characters when written in Han, kana, or Hangul; those scripts match as substrings. `getLocaleStringList()` reads one locale's list with no English fallback. English deliberate packs stay empty because the built-in patterns already cover English.
- Directory names must be [Discord locale codes](https://docs.discord.com/developers/reference#locales). Unsupported names and alias-key directories are logged and skipped, so they cannot break command registration.

Example lookup:

```ts
localizer(locale, "commands.config.setup.description")
```

## Important Behaviors

- `initializeLocalizer()` must run during startup before lookups.
- Locale lookup tries an exact authored code, then an alias, then an unambiguous base-language match, then `en-US`. For example, `es-ES` uses the authored `es-419` tree once that tree exists; unsupported codes use English.
- Missing key falls back to `en-US` for that key alone (see below).
- Panel route IDs accept Discord locale codes even when no translation is loaded. This keeps
  controls usable for users whose Discord language is not yet authored; their text falls back to
  `en-US`.
- Multi-line strings are dedented automatically on load.
- Values interpolated into user-facing strings resolve through the same authored-locale chain, so their language matches the sentence around them: dates through `formatTimeWithOffset(date, offset, options, locale)`, durations through `formatLocalizedDuration()`, and integer grouping through `formatLocaleInteger()`. Durations use `Intl` unit formatting rather than locale keys because some languages have several plural forms. Model-facing text keeps English values: `formatTimeRemaining()`, tool results, and context builders that omit the locale.
- Rendered strings used as embed protocol data are registered in `src/utils/discord/embedProtocol.ts`.
  Startup builds one reverse lookup from the authored locale trees and fails on a title collision
  between distinct protocol keys. Template keys must retain the same placeholder names and counts
  across authored locales; target-title templates also need literal text around a placeholder.
  Reply-context field templates are matched only against their own embed fields, not against titles.
  Each released locale's protocol-key values are immutable because
  Discord already stores unmarked historical embeds using those values.

New bot-produced protocol embeds carry a `[tomori:v1:<kind>]` footer token. The classifier reads the
token first, then uses the precomputed localized title lookup for older messages. Reset markers drop
the marker message from history; compact-refresh markers keep their summary message as the new
conversation opener. The Matrix relay serializes footer text along with title and description, so
the token remains in its plain-text copy. A Matrix `/refresh` also writes the token on its Discord
embed. Components V2 notices have no embeds and continue to use their reconstructed title text.

## Key Resolution and the `en-US` Fallback

`localizer()` resolves in three steps, and the middle one is what keeps an incomplete locale
usable:

| Case | Result |
|---|---|
| Key present in the requested locale | That locale's string, with `{placeholder}` variables interpolated |
| Key missing from the requested locale but present in `en-US` | The `en-US` string, with the same interpolation applied, plus one `warn` log |
| Key missing from both | The key path itself, returned verbatim |

The per-key retry means a locale that is 99% translated renders English for the remaining 1%
instead of showing users a raw `commands.foo.bar_description` path. The `warn` fires once per
`locale:key` per process, so a gap stays visible in development without flooding a hot path.

`check-locales` treats missing translations as an advisory exit 2 while the Japanese catch-up is
pending. A source key missing from every locale remains a blocking error.

`getSupportedLocales()` returns authored locale directories only. `getRegisterableLocales()` adds
aliases whose source tree is loaded, so command descriptions, option descriptions, and choice names
register under both `es-419` and `es-ES` once Spanish content ships. The personal language control
lists authored locales, not aliases.

Command registration emits a locale-specific description or choice only when that authored locale
defines the key; an English runtime fallback is not advertised as a translation. Panel route tokens
accept any known Discord locale from a stored preference, including locales that currently render
through English fallback.

Two consequences to keep in mind when writing new code:

- **Do not infer key existence from the returned string.** A miss now yields English, which is
  indistinguishable from a real translation. Use `hasLocaleKey(locale, key)` instead: it walks
  only the requested locale's tree and never falls back. `embedClassifier.ts` depends on this
  to decide which dynamically discovered reward and punish titles a locale actually defines.
- **The miss-everywhere case is unchanged**, so callers that detect an unknown key by comparing
  the result against the key still work. `openrouterStreamAdapter.ts` and
  `openaiCompatibleErrorFormatter.ts` use that comparison, and `st-preset/node/toggle.ts` relies
  on the verbatim echo to pass a dynamic label through `localizer()`.

`getLocaleSubKeys(locale, path)` deliberately enumerates only what the requested locale defines
and performs no fallback of any kind, so callers can pair it with `hasLocaleKey` to build a set
of keys that genuinely exist in one locale.

## Locale File Shape

Each locale exports a nested object (not a flat key-value map).

`general.language_name` is the locale's endonym shown in `/personal config` > Profile > General.
`general.defaults.bot_name` and `general.defaults.base_trigger_words` own localized defaults.
Trigger-word reservation reads `getAllBaseTriggerWords()`, the union across authored locales, so an
alter can never claim the bot's name in any shipped language.
`BASE_TRIGGER_WORDS` remains a global chat-trigger detection setting and does not supply the
locale-specific persona default list. The language modal uses a String Select, which holds at most
25 options; beyond that, the picker needs pagination or another selection flow.

```ts
export default {
	commands: {
		config: {
			setup: {
				description: "...",
			},
		},
	},
};
```

## Slash Command Metadata Localization

`commandLoader.ts` auto-generates description/choice localizations from locale keys.

Recommended pattern in command files:

- set base metadata with `localizer("en-US", key)`
- do not hardcode localized `setDescriptionLocalizations(...)` per command

Key conventions:

- Subcommand description:
  - `commands.{category}.{path}.description`
- Option description:
  - `commands.{category}.{path}.{option_name}_description`
- Choice label:
  - `commands.{category}.{path}.{option_name}_choice_{choice_value}`

## Tip-item keys (`genai.tips.*`)

User-facing hints ("Tips") are stored as **atomic, single-sentence** keys under `genai.tips.*`
(defined in `providers.ts`, which exports the `genai` tree). Each key is one self-contained bullet —
never a multi-hint paragraph:

```ts
genai: {
  tips: {
    title: "💡 Tip",
    wait_and_retry: "Please wait a few minutes before trying again.",
    openrouter_models: "Browse the [OpenRouter model list](https://openrouter.ai/models) and switch models with `/providers`.",
    // ...one key per bullet
  },
}
```

Callers compose the bullet list by passing an ordered `tipKeys` array to `createTipText()` (see
[Tip modals](./utils.md#tip-modals)), including or omitting keys per branch. This is why tips are
atomic: a conditional hint (e.g. an OpenRouter-only tip) is added by including its key in one branch,
not by duplicating a whole paragraph string. Descriptions render markdown and hyperlinks.

`genai.tips.support_server` is the one reserved key: `createTipText()` appends it as the closing
bullet of every rendered tip modal so the Official Support Server link is always offered. Do not put
it in a caller's `tipKeys` array.

When adding a tip:

1. Add the atomic key under `genai.tips` in both `src/locales/en-US/providers.ts` and
   `src/locales/ja/providers.ts`.
2. Reference it by dot-path from the calling `tipKeys` array — do not inline hint text in code.
3. Run `bun run check-locales` for parity.

## User Language Preference

- User preference is stored in `users.language_pref`.
- Registration writes the observed Discord locale to `language_pref` and `registration_locale` for a new user. A guild join uses the guild's preferred locale; a slash-command registration uses the interaction locale. Chat registration uses the invoker locale when available, otherwise the guild locale. Existing preferences are not reset on registration. `registration_locale` is analytics data and never controls routing.
- Unsupported stored preferences remain intact. The localizer resolves them at read time, so a matching authored locale begins serving those users when its content ships without a database rewrite. `/personal config` > Profile > General lets a user change the preference explicitly.
- Most interaction replies receive `locale`/`userData.language_pref` and should use that for response text.

## Adding or Changing Locale Keys

1. Update the appropriate category file under `src/locales/en-US/` (e.g. `commands.ts`, `general.ts`).
2. Mirror the same key structure in the corresponding `src/locales/ja/` file.
3. Run:

```bash
bun run check-locales
```

This validates cross-locale key parity and catches missing keys.
Follow with the placeholder, marker, and link validation gates:

```bash
bun run check-locale-placeholders --locale=<target>  # placeholder parity against en-US
bun run check-locale-lengths                         # Discord 45/100 code-point caps
bun run check-locale-markers                         # embed protocol key uniqueness and templates
bun run check-locale-links --locale=<target>         # project doc routes and heading fragments
```

Use `--locale=<code>` to validate a specific translation target. Running `check-locale-placeholders`
or `check-locale-links` across the entire repository surfaces pre-existing Japanese catch-up debt
(command modernization placeholder drifts and untranslated documentation anchors), which is
reconciled during the Japanese catch-up phase.

## Discord Length Limits

Discord silently truncates several text slots past their cap, so a separate strict gate
(`bun run check-locale-lengths`, also run as a fatal step in `bun run vl`) source-traces each
locale key to the Discord component it feeds and flags any value that overruns:

- Command descriptions and choice names — ≤100 chars
- Modal titles / input labels — ≤45 chars
- Modal placeholders / Label descriptions — ≤100 chars
- **Select / checkbox option `label` and `description`** — ≤100 chars (traced from
  `{ value, label: localizer(...), description: localizer(...) }` option literals)

Both the `en-US` and `ja` values must fit. Shorten the reported string rather than relying on
Discord's truncation — the cap is counted in characters (code points), matching Discord backend
measurements, so compact Japanese text usually fits where English does not.

## Best Practices

- Localize all user-facing command/embed strings.
- Keep command metadata keys aligned with command path conventions.
- Avoid hardcoded strings in command implementations.
