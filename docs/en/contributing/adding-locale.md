---
title: "Adding a New Locale"
---

This guide walks through adding support for a new display language in TomoriBot.

## Steps

1. Choose a [Discord locale code](https://docs.discord.com/developers/reference#locales) for `src/locales/{locale}/`. Invalid directory names are skipped at startup. `es-ES` is an alias of `es-419`, so author Spanish only in `src/locales/es-419/`. Copy the file and folder structure from `src/locales/en-US/`, including its top-level category files and `commands/` subfolder. `en-US` is the canonical reference for key structure.

2. Add `general.language_name` as the language's own name, plus localized `general.defaults.bot_name` and `general.defaults.base_trigger_words`. The language picker in `/personal config` > Profile > General reads the names from authored locale files. Its String Select can hold at most 25 locales; adding more requires a paginated picker.

   Also fill `tools.intent_packs`: the words and short phrases native speakers type when asking for each Deliberate Tool Mode target, plus phrases for an explicit "remember this" request. These are not translations of the English patterns. Lean toward catching more requests rather than fewer, end an entry with `*` to match a word stem, and never use regex syntax. Entries in Chinese, Japanese, or Korean need at least two characters.

3. Add UI keys from `en-US`. Missing translations fall back per key to English and appear as advisory parity findings, while a source key absent from every locale is blocking. `initializeLocalizer()` discovers valid authored directories at startup. Command registration also emits active aliases automatically.

Protocol keys listed in `src/utils/discord/embedProtocol.ts` are persisted through rendered embed text. A
protocol-key translation is frozen after that locale's first release. Review and correct these values
before release; after release, changing one would make older Discord messages unrecognizable by their
legacy title. New embeds also carry a stable footer marker, but historical embeds have no marker and
still depend on the released title. Add any new key used to classify an embed or reply-context notice
to that registry before shipping it.

4. Run the localization safety gates, then `bun run check` and `bun run lint`:
   - `bun run check-locales`: Verifies key parity across locale files (advisory exit 2 in CI; exit 1 fatal when keys are missing everywhere).
   - `bun run check-locale-placeholders`: Validates `{placeholder}` parity against `en-US` (missing English placeholders are fatal exit 1; extra placeholders are advisory exit 0 warnings). Use `--locale=<code>` to check a specific locale.
   - `bun run check-locale-lengths`: Verifies Discord length limits (modal titles/input labels <=45; command descriptions, choice names, placeholders, select options <=100; counted in Unicode code points).
   - `bun run check-locale-markers`: Verifies embed protocol keys, template placeholder parity, literal anchors, and title collisions.
   - `bun run check-locale-links`: Validates project-owned documentation routes and heading fragments. Use `--locale=<code>` to check a specific locale.
   - `bun run find-stale-translations`: Identifies untranslated English strings using per-locale expected scripts.

## Notes

- Keys follow dot-notation: `commands.{category}.{subcommand}.{key}`
- Auto-localization for command options uses specific key patterns — see
  [Localization System](/architecture/subsystems/localization/) for the full naming convention.
- The locale scanner reads comments too. If a comment contains a locale key example, write it
  in split form (`"m.room" + ".message"`) rather than joined — the scanner will otherwise count it
  as a real key and flag false parity failures.

## Quality Gate

```bash
bun run check-locales              # key parity (advisory exit 2 in CI; exit 1 fatal)
bun run check-locale-placeholders  # placeholder parity (exit 1 on missing placeholders)
bun run check-locale-lengths       # Discord 45/100 code-point caps (fatal on overrun)
bun run check-locale-markers       # embed protocol key uniqueness and templates (fatal)
bun run check-locale-links         # project doc routes and heading fragments (fatal)
bun run check                      # TypeScript strict mode
bun run lint                       # Biome formatting
```

## Related Docs

- [Localization System](/architecture/subsystems/localization/): key naming, `localizer()` API, locale discovery
