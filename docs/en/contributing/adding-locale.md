---
title: "Adding a New Locale"
---

This guide walks through adding support for a new display language in TomoriBot.

## Steps

1. Choose a [Discord locale code](https://docs.discord.com/developers/reference#locales) for `src/locales/{locale}/`. Invalid directory names are skipped at startup. `es-ES` is an alias of `es-419`, so author Spanish only in `src/locales/es-419/`. Copy the file and folder structure from `src/locales/en-US/`, including its top-level category files and `commands/` subfolder. `en-US` is the canonical reference for key structure.

2. Add `general.language_name` as the language's own name, plus localized `general.defaults.bot_name` and `general.defaults.base_trigger_words`. The language picker in `/personal config` > Profile > General reads the names from authored locale files. Its String Select can hold at most 25 locales; adding more requires a paginated picker.

3. Add UI keys from `en-US`. Missing translations fall back per key to English and appear as advisory parity findings, while a source key absent from every locale is blocking. `initializeLocalizer()` discovers valid authored directories at startup. Command registration also emits active aliases automatically.

Protocol keys listed in `src/utils/discord/embedProtocol.ts` are persisted through rendered embed text. A
protocol-key translation is frozen after that locale's first release. Review and correct these values
before release; after release, changing one would make older Discord messages unrecognizable by their
legacy title. New embeds also carry a stable footer marker, but historical embeds have no marker and
still depend on the released title. Add any new key used to classify an embed or reply-context notice
to that registry before shipping it.

4. Run `bun run check-locales` to inspect parity, then `bun run check`, `bun run lint`, and `bun run check-locale-lengths`.

## Notes

- Keys follow dot-notation: `commands.{category}.{subcommand}.{key}`
- Auto-localization for command options uses specific key patterns — see
  [Localization System](/architecture/subsystems/localization/) for the full naming convention.
- The locale scanner reads comments too. If a comment contains a locale key example, write it
  in split form (`"m.room" + ".message"`) rather than joined — the scanner will otherwise count it
  as a real key and flag false parity failures.

## Quality Gate

```bash
bun run check-locales   # verify key parity across all locale files
bun run check           # TypeScript strict mode
bun run lint            # Biome formatting
```

## Related Docs

- [Localization System](/architecture/subsystems/localization/): key naming, `localizer()` API, locale discovery
