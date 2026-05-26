---
title: "Adding a New Locale"
---

This guide walks through adding support for a new display language in TomoriBot.

## Steps

1. Create `src/locales/{locale}.ts`, mirroring the key structure of an existing locale file (`en-US.ts` is the canonical reference).

2. Ensure every required key exists in the new file. Missing keys will cause `check-locales` to fail.

3. `initializeLocalizer()` auto-discovers locale files at startup — no manual registration is needed.

4. Run `bun run check-locales` to verify key parity across all locale files.

## Notes

- Keys follow dot-notation: `commands.{category}.{subcommand}.{key}`
- Auto-localization for command options uses specific key patterns — see
  [`docs/subsystems/localization.md`](../subsystems/localization) for the full naming convention.
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

- [`docs/subsystems/localization.md`](../subsystems/localization) — key naming, `localizer()` API, locale discovery
