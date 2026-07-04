---
title: "Adding a New Locale"
---

This guide walks through adding support for a new display language in TomoriBot.

## Steps

1. Create `src/locales/{locale}/` directory. Copy the file/folder structure from `src/locales/en-US/` — the top-level `.ts` files (`bridges.ts`, `commands.ts`, `general.ts`, `providers.ts`, `tools.ts`) plus the `commands/` sub-folder with one file per command category. `en-US` is the canonical reference for key structure.

2. Ensure every required key exists in the new file. Missing keys will cause `check-locales` to fail.

3. `initializeLocalizer()` auto-discovers locale files at startup — no manual registration is needed.

4. Run `bun run check-locales` to verify key parity across all locale files.

## Notes

- Keys follow dot-notation: `commands.{category}.{subcommand}.{key}`
- Auto-localization for command options uses specific key patterns — see
  [`docs/architecture/subsystems/localization.md`](../subsystems/localization) for the full naming convention.
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

- [`docs/architecture/subsystems/localization.md`](../subsystems/localization) — key naming, `localizer()` API, locale discovery
