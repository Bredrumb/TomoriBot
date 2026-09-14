---
title: "Seed Catalog"
---

Model, preset, and persona metadata is seeded from typed TypeScript catalogs at boot. Adding a locale
means adding that locale's descriptions to those catalogs, and in the persona case it means writing a
native voice rather than translating one.

## Locale-Keyed Descriptions

Six tables carry a `descriptions` JSONB column keyed by locale code instead of a per-language column.
The shape is `{"en-US": "...", "ja": "...", "pt-BR": "..."}`, so adding a locale is a seed-only change
with no migration.

The catalog field is `i18n`, typed as `Partial<Record<Exclude<LocaleCode, "en-US">, string>>`:

```ts
{
  name: "Some Model",
  desc: "English description.",
  i18n: { ja: "日本語の説明。", "pt-BR": "Descrição em português." },
}
```

Two properties of that type are deliberate:

- **English is not in the map.** It comes from `desc`, so there is exactly one English source and no
  way to author a second, divergent one.
- **The keys are `LocaleCode`.** A typo such as `pt-br` is a compile error rather than a silently
  ignored entry that falls back to English forever.

`resolveDescription()` in `src/utils/text/localizer.ts` is the single reader, and its chain is exact
locale, then base language, then any key whose base language matches (so `pt` resolves to `pt-BR`),
then `en-US`. It returns `null` when nothing matches, and the caller renders no description rather
than an empty string.

A missing entry is a deliberate, supported state. The English description shows, and no user sees a
key path or a blank. Author descriptions for the surfaces a user picks from (`/model`, `/provider`,
NovelAI presets, system prompt presets) and let the rest fall back.

## The Three Shared Catalogs

Descriptions live in shared files, which is the one place a per-locale lane must not work
concurrently:

| File | Rows carrying `i18n` |
|---|---|
| `src/db/seed/catalog/models.ts` | LLM, image, video, and embedding descriptions |
| `src/db/seed/catalog/naiPresets.ts` | NovelAI preset descriptions |
| `src/db/seed/catalog/systemPrompts.ts` | System prompt preset descriptions |

One dedicated worker owns every remaining locale's `i18n` entries in these three files after the
glossaries are accepted. Per-locale lanes hand their descriptions over rather than editing the
catalogs, because two lanes editing one typed array will conflict on every batch.

System prompt **bodies** (`promptText`) are not localized. They stay English by design, and only the
user-facing `desc` is translated.

## Persona Presets

Personas are structured differently and are the voice of the product. Each persona lives in its own
folder with one file per locale:

```
src/db/seed/catalog/personas/
  default/
    en-US.ts
    ja.ts
    default.png
    sprites/
  bratty/
    en-US.ts
    ja.ts
```

Each locale file exports a single named `persona` constant of type `PersonaInput`, and every variant
is registered by hand in `src/db/seed/catalog/personas/index.ts`. There is no directory scan, so a new
locale variant that is not added to that file simply does not seed.

Authoring a persona variant is not a translation task. A translated persona reads as a foreigner
performing a character, and the voice is the product feature. Write the description, trigger words,
and sample dialogue the way a native speaker of that language would write an original character:
same identity, same relationship to the user, same register, different words.

Fields that participate in a locale variant:

| Field | Localized | Notes |
|---|---|---|
| `name` | Yes | The character's name, which may transliterate rather than translate |
| `desc` | Yes | The user-facing preset description |
| `attributes` | Yes | Character traits, in the locale's voice |
| `sampleDialoguesIn` / `sampleDialoguesOut` | Yes | Paired arrays; the in/out pairing is validated |
| `triggerWords` | Yes | Native address forms, not transliterations of the English ones |
| `preset_lineage_id` | No | The identity anchor shared across every locale variant |
| `avatarPath`, `sprites` | No | Shared art, authored once |
| `sprites[].usageInstructions` | Yes | Prompt guidance may be localized |

`preset_lineage_id` is what makes the locale variants one canonical character rather than several
unrelated presets, so it must be identical across every variant. Records with a lineage apply as
copy-on-write pointers: the seed can later update text, sprites, and the main persona's avatar without
touching a server's local customization.

Preset option lists resolve by locale through `ConfigRepository.loadPresetOptionsByLocale`, in the
order exact locale, base language, then `en-US`. A locale with no persona variants therefore ships
working, with the English presets. Persona coverage is per locale and never blocks the rest of a
locale's release.

One preset is deliberately out of scope: `prideful` is unregistered, so adding locale variants for it
would seed rows nothing reads. Leave it alone.

## Validation

```bash
bun run check-seed-catalogs   # catalog shape, uniqueness, paired dialogue arrays
bun run check-media-size      # avatar and sprite art under the Discord budget
bun run check                 # the i18n map type is checked here
bun run lint
```

`check-seed-catalogs` validates persona name uniqueness, paired sample dialogue arrays, required
official attributes, sprite name and file validity, non-empty system prompt text, and NovelAI default
uniqueness. It does not check whether a description reads well, which is what the locale's own review
pass is for.

New avatar or sprite art goes through `bun run compress-media` before committing. Anything above the
media budget is rejected by `bun run vl`.

## Related Docs

- [Adding a Persona Preset](/contributing/adding-persona-preset/): the full preset structure and pointer behavior
- [Persona Presets](/architecture/subsystems/persona-presets/): lineage, pointer resolution, and sprite seeding
- [Verification](/contributing/adding-locale/verification/): the gates that cover this page
