---
title: "Lorebooks"
sidebar:
  order: 2
aiGenerated: false
---

Lorebooks are advanced memory for roleplay worlds, characters, and recurring story details. Use
Memories for everyday conversations. Lorebook entries recall the details you write when their keywords
appear in recent messages.

Manage lorebooks in `/memories` > `Lorebooks`. Every member can read the entries in scope; only
members with `Manage Server` can add, edit, import, export, or remove them.

## Serverwide and Persona lorebooks

Lorebooks have two scopes:

- **Serverwide** books apply to every persona in the server. Choose a book first, then choose an entry within it.
- **Persona** entries belong to one persona lineage. They continue to apply after the persona is
  removed and re-imported.

Use the `Serverwide` and `Persona` buttons at the top of the page to switch scope. The persona list
groups personas that share a lineage, because they share one book. Channel limits and the
Serverwide/Persona scope are separate controls: the scope decides who owns the entry, while channels
decide where it may appear.

## Writing an entry

Give each entry a title, keywords, and up to 4,000 characters of content. Keywords are comma-separated
words or phrases. Matching ignores case and full-width/half-width differences.

Leave keywords blank for background facts that need no keyword match. Add keywords again to restore
keyword matching. New entries use the after-persona placement; imported entries keep their placement.
A SillyTavern preset's world info slots control where the before and after groups appear.

## When entries activate

An enabled entry needs a keyword match unless its keywords are blank. Scope and channel limits still
apply to entries without keywords.

`Activation Rules` controls secondary keywords, the number of recent messages searched (1-100), trigger
chance, and insertion order. Secondary keywords can require any match (OR), every match (AND), no
matches (NOR), or fewer than all matches (NAND). Lower insertion numbers appear earlier.

Trigger chance runs from 0% to 100%. Zero prevents activation, including for entries without keywords.
Missing or null probability in an imported file defaults to 100%; an explicit 0% stays at 0%.
`Disabled` entries stay saved and out of the prompt.

Keyword matching is literal. Regex-shaped keys such as `/a+/` are kept as written and do not act as
regular expressions.

## What reaches the prompt

Activated entries are sent in one `World Info` block per placement, in insertion order. Both blocks
share a limit of 8,000 characters; an entry that would exceed it is skipped so later entries can still
fit.

Content may use `{{user}}`, `{{char}}`, and `{{bot}}`. TomoriBot replaces them with the current names.
Other `{{...}}` macros and conditional blocks stay as written.

## Channel limits

Serverwide channel restrictions belong to the collection and apply to all its entries. Set them with
`Channels` beside the collection's state button. Persona lorebooks keep channel restrictions on each
entry. Leaving channels empty allows every channel; threads follow their parent channel.

The collection's `Active` / `Disabled` button controls the whole book. Disabling it keeps every entry
out of the conversation without changing each entry's own state. Re-enabling the collection preserves
which entries were enabled or disabled.

Older keyword-tagged server memories converted to Persona lore may still carry an unresolved
`#channel` name. Until a manager saves a channel selection, TomoriBot treats that entry as active in
every channel and marks it on the Lorebooks page.

## Importing a lorebook

In Serverwide scope, choose `+ Import Lorebook` in the collection picker to create a book from the
uploaded file. Its name defaults to the name inside the file, then the filename; you can enter a
name in the import dialog. An existing name is refused, so importing a new book cannot overwrite one.
Use `+ Import Entries` in a selected book's entry picker to append or replace its entries.

For Persona scope, `+ Import Lorebook` stays in the entry picker because the persona owns one book.
Both imports accept SillyTavern world info JSON, Character Book JSON, and character cards in PNG,
CHARX, or JSON form. Uploading a card here imports only its embedded Character Book. A card without a
book leaves the selected lorebook unchanged.

Append is the default: entries already present are skipped, and new ones are added. Check
`Replace this lorebook` to replace only the selected book. Other Serverwide books stay intact.
Each persona can hold 250 entries, and Serverwide books share a separate 250-entry limit;
an import that would exceed that is refused as a whole, so nothing is half imported. Files are limited
to 2 MB for JSON; PNG and CHARX cards use the host's persona import limits shown in the upload dialog.

The receipt reports how many entries were added and how many were skipped. Skipped counts include
duplicates and entries the converter could not use, such as entries with no content. Settings with no
destination, such as groups, recursion, sticky timers, cooldowns, and triggers, are counted and
dropped. World info positions 2 through 7 arrive before the persona. Regex keys stay inert. The import receipt identifies unsupported keywords and settings.

A card's Character Book is imported as that persona's lorebook by `/persona import`; see
[SillyTavern Support](/features/integrations/sillytavern-support/).

## Exporting a lorebook

`+ Export Lorebook` in the entry picker downloads the selected Serverwide book or Persona book as
SillyTavern world info JSON. Reimport it through the same lorebook upload. Entry activation settings
and individual enabled states travel with the file; channel restrictions, unresolved channel names,
and collection state do not.

For a server backup that keeps these restrictions and collection settings, use `/export memories`
with `All Personas`. `Main Persona` and `Selected Persona` export memories only and leave destination
lore untouched when imported.

## Related pages

- [Memory](/features/knowledge/memory/)
- [Inside The Prompt](/features/knowledge/inside-the-prompt/)
- [Data Handling](/features/knowledge/data-handling/)
