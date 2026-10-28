---
title: "Lorebooks"
sidebar:
  order: 2
aiGenerated: false
---

Lorebooks hold authored world canon: places, factions, rules, and history that TomoriBot should know
only when they matter. Each entry waits until its keywords appear in recent messages, so a large book
does not fill the prompt on every turn.

Manage lorebooks in `/memories` > `Lorebooks`. Every member can read the entries in scope; only
members with `Manage Server` can add, edit, import, or remove them.

## Serverwide and Persona lorebooks

Lorebooks have two scopes:

- **Serverwide** entries apply to every persona in the server.
- **Persona** entries belong to one persona lineage. They continue to apply after the persona is
  removed and re-imported.

Use the `Serverwide` and `Persona` buttons at the top of the page to switch scope. The persona list
groups personas that share a lineage, because they share one book. Channel limits and the
Serverwide/Persona scope are separate controls: the scope decides who owns the entry, while channels
decide where it may appear.

## Writing an entry

An entry has a title, keywords, content, and a placement.

- **Title** names the entry in the picker.
- **Keywords** are comma-separated words or phrases. Matching ignores case and full-width/half-width
  differences. A phrase matches as written.
- **Content** is what TomoriBot reads when the entry activates, up to 4,000 characters.
- **Placement** puts the entry before or after the persona description.

Add an entry with `+ Add Lorebook Entry`, then select it to edit, change its activation, enable it,
make it Always On, or delete it.

## When entries activate

An active entry needs a keyword match unless it is **Always On**. Always On entries appear whenever
their scope and channel limits allow, which suits rules and background facts that should never be
missed.

Open `Activation` to tune an entry:

| Setting | Meaning |
|---|---|
| Secondary keywords | Extra keys checked with the secondary logic. |
| Secondary logic | Whether any secondary key, all of them, none, or not all of them must also match. |
| Scan depth | How many recent messages are searched, from 1 to 100. |
| Trigger chance | Percentage chance to activate after a keyword match, from 1 to 100. |
| Insertion order | Lower numbers appear earlier among activated entries. |

`Disable` keeps an entry stored but out of the prompt. `Use Keywords` returns an Always On entry to
keyword matching.

Keyword matching is literal. Regex-shaped keys such as `/a+/` are kept as written and do not act as
regular expressions.

## Channel limits

An entry can be limited to selected channels and their threads. Leave the channel selection empty to
apply it in every channel. The page shows the saved limit below the entry content. Limits move with
the entry when its scope changes.

Older keyword-tagged server memories that were converted to lore may still carry an unresolved
`#channel` name. Until a manager saves a channel selection, TomoriBot treats that entry as active in
every channel and marks it on the Lorebooks page.

## Importing a lorebook

Managers can choose `+ Import Lorebook` in the entry picker. It accepts two JSON shapes:

- a SillyTavern world info file, whose entries are keyed by number;
- a Character Book, whose entries are an array.

Append is the default: entries already present are skipped, and new ones are added. Check
`Replace this scope` to delete the current scope's entries first. A scope holds at most 250 entries;
an import that would exceed that is refused as a whole, so nothing is half imported. Files are limited
to 2 MB.

The receipt reports how many entries were added and how many were skipped. Skipped counts include
duplicates and entries the converter could not use, such as entries with no content. Settings with no
destination, such as groups, recursion, sticky timers, cooldowns, and triggers, are counted and
dropped. World info positions 2 through 7 arrive before the persona. Regex keys stay inert.

A card's Character Book is imported as that persona's lorebook by `/persona import`; see
[SillyTavern Support](/features/integrations/sillytavern-support/).

## Related pages

- [Memory](/features/knowledge/memory/)
- [Inside The Prompt](/features/knowledge/inside-the-prompt/)
- [Data Handling](/features/knowledge/data-handling/)
