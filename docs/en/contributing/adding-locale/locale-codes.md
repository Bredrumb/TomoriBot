---
title: "Locale Codes"
---

The folder name under `src/locales/` is a Discord API key, not a label you choose. Discord validates
every localization key at command registration, so an unrecognized folder name fails registration for
every command in every language.

## The Code Table

`DISCORD_LOCALES` in `src/constants/locales.ts` is the accepted set, and `LocaleCode` is derived from
it. Discord adds codes over time, so treat the constant as authoritative and check
[Discord's locale reference](https://docs.discord.com/developers/reference#locales) before assuming a
missing code is invalid.

| Code | Language | Code | Language |
|---|---|---|---|
| `id` | Indonesian | `pt-BR` | Portuguese (Brazil) |
| `da` | Danish | `ro` | Romanian |
| `de` | German | `fi` | Finnish |
| `en-GB` | English (United Kingdom) | `sv-SE` | Swedish |
| `en-US` | English (United States) | `vi` | Vietnamese |
| `es-ES` | Spanish (Spain) | `tr` | Turkish |
| `es-419` | Spanish (Latin America) | `cs` | Czech |
| `fr` | French | `el` | Greek |
| `hr` | Croatian | `bg` | Bulgarian |
| `it` | Italian | `ru` | Russian |
| `lt` | Lithuanian | `uk` | Ukrainian |
| `hu` | Hungarian | `hi` | Hindi |
| `nl` | Dutch | `th` | Thai |
| `no` | Norwegian | `zh-CN` | Chinese (Simplified) |
| `pl` | Polish | `ja` | Japanese |
| `ko` | Korean | `zh-TW` | Chinese (Traditional) |

Every target locale in this project is written left to right. None of the eight target locales is
right-to-left, so no layout mirroring, bidirectional control, or RTL-specific prose handling is part
of a locale addition today. If a future locale needs it, that is a separate change across the panels
and the markdown renderer, not a translation task.

## Why The Folder Name Is Load-Bearing

`commandLoader` reads the authored locale set and writes those exact strings into
`setDescriptionLocalizations()` and `choice.name_localizations`. Nothing maps or validates them on the
way out. A folder named `pt` or `zh-Hant` is not a near miss to Discord: it is an unknown key, and the
registration request is rejected as a whole.

Three consequences worth internalizing:

- **The failure is all-or-nothing.** One bad directory name breaks every slash command, not just the
  one locale.
- **No script catches it.** `bun run check`, `bun run check-locales`, and the docs build all pass with
  an invalid locale directory. The only detector is booting the bot and watching registration.
- **`initializeLocalizer()` skips the directory.** An unrecognized name logs an error and is left out
  of the authored set, so the tree silently does nothing rather than poisoning startup. Skipping is
  the safety net for a local experiment, not a substitute for using a real code.

## Aliases

Some Discord keys should reuse another locale's strings. `LOCALE_ALIASES` in `src/constants/locales.ts`
maps an alias key to its authored source:

```ts
export const LOCALE_ALIASES = {
  "es-ES": "es-419",
} as const satisfies Partial<Record<LocaleCode, LocaleCode>>;
```

Spanish is authored once, in neutral Latin American register under `es-419`, and `es-ES` clients read
that same tree. Authoring both would produce two divergent Spanish translations of the same product,
which is worse than one register that reads naturally on both sides of the Atlantic.

Two integration points consume the map:

- `localizer()` resolves the alias before lookup, so a stored `language_pref` of `es-ES` reads the
  `es-419` strings. The same resolution applies to the base-language step, so `es-MX` also lands on
  `es-419`.
- `commandLoader` emits the alias key alongside its source in every localizations map, so Discord
  clients that report `es-ES` receive Spanish labels.

`getSupportedLocales()` keeps returning authored directories only, while `getRegisterableLocales()`
returns the Discord-facing expansion. Keep the two uses distinct: an alias is a registration and
lookup concept, never a directory.

The docs site mirrors this through `DOCS_LOCALE_ALIASES`, which is inverted from the same registry so
one alias decision covers runtime strings and docs destinations. The docs root presents explicit language
links, so aliases affect generated bot links rather than request routing. See
[Documentation](/contributing/adding-locale/documentation/).

## What A New Locale Registers

1. `src/locales/{code}/` with a name from the table above.
2. `general.language_name` as the language's own name. This is what the language picker shows, so
   `Deutsch` rather than `German`.
3. Nothing else for registration. Command metadata localizations are emitted automatically from the
   keys the tree actually authors.

Pickers list the locales in `LOCALE_DISPLAY_ORDER`, which `src/constants/docsLocales.ts` derives
from the order of the `DOCS_LOCALES` rows themselves. Moving a row there reorders the docs language
switcher, the README switcher row, and the bot's own picker together, so a new locale is placed by
inserting its row where it should read rather than by editing three lists. Placement is a product
decision, not an alphabetization.

The same picker is reachable on its own as `/personal language`, which shows the Language modal with
no panel behind it. Its submit carries the `language-only-submit` route because the panel's own
submit ends by repainting a message a slash command has not created.

The language picker in `/personal config` > Profile > General is a String Select with a 25-option
ceiling (`checkDiscordLimits.ts` `MAX_SELECT_OPTIONS`). Ten authored locales fit comfortably. A
twenty-sixth locale needs a paginated picker before it can be offered.

Do not add a `DEFAULT_BOTNAME_{CODE}` family to `.env.optional.example`. Locale files own localized
defaults: `general.defaults.bot_name` and `general.defaults.base_trigger_words` are the primary
source, and the environment variable is only a generic fallback for a locale that authors neither.

## Related Docs

- [UI Strings](/contributing/adding-locale/ui-strings/): the required key tier
- [Localization System](/architecture/subsystems/localization/): discovery, resolution order, and the per-key fallback
- [Verification](/contributing/adding-locale/verification/): the boot gate that catches a bad code
