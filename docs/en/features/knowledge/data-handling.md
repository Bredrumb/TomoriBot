---
title: "Data Handling"
sidebar:
  order: 4
---

Export, back up, import, or delete your settings, memories, and personas using Discord slash
commands. For service terms and privacy details, see `/legal terms-of-service` and
`/legal privacy-policy`.

:::note
This page covers in-Discord user controls. On self-hosted instances, full database backups
and restores are host-side operations; see [Maintenance & Backups](/self-hosting/maintenance/).
:::

## What She Stores

### Stored data

- Server and personal memories
- Persona profiles, traits, and dialogue examples
- Server configuration settings
- Encrypted provider API keys
- Expression metadata, persona access rules, and uploaded expression media

### Not stored

- Discord message history (messages are not archived in a persistent message log)

### Sent to your AI provider

Whenever triggered, TomoriBot fetches recent messages in the channel along with relevant
memories as context for the model. She does not read or process messages outside of those
triggers.

:::note
Your chosen AI provider (Google, OpenRouter, NovelAI, …) processes messages under their own
privacy policy. Avoid sharing sensitive personal credentials or confidential data.
:::

## Export Your Data

Exportable data is delivered to your DMs as a JSON file:

- `/export config`: server configuration values (excludes API keys and credentials).
- `/export personal config`: personal profile settings (privacy, appearance tags, naming).
- `/export memories`: server memories, scoped to the main persona, one persona, or all personas.
- `/export personal memories`: personal memories, scoped globally or per persona.
- `/persona export`: full persona definitions.

Uploaded expression media is stored on the server host and is outside these JSON exports.
Self-hosters must back up database storage and media assets together; see
[custom media backups](/self-hosting/safe-migration/#custom-expression-media-backups).

## Import Your Data

Attach an exported file to restore it:

- `/import config`: server configuration (requires Manage Server). Choose which sections to apply.
- `/import personal config`: personal settings. Choose which detected sections to apply.
- `/import memories`: server memories (requires Manage Server). Merge or replace, and map personas.
- `/import personal memories`: personal memories. Merge or replace, and map personas.
- `/persona import`: restore a persona. Also imports SillyTavern PNG cards, JSON cards, and `.charx`
  archives (see [SillyTavern Support](/features/integrations/sillytavern-support/)).

## Delete Your Data

These actions permanently remove or reset stored data:

- `/personal memories`: manage or remove personal memories.
- `/memories`: manage or remove server memories (requires Manage Server).
- `/personal nuke`: permanently deletes all personal data across servers.
- `/nuke`: wipes server data, including custom expressions and persona access rules. Set
  `preserve_personas: true` to keep personas while removing custom expressions and media.
- `/reset config`: restores server configuration to database defaults.
  - **Preserves**: active model assignments, API keys, custom endpoints, personas, server
    memories, and integrations.
  - **Clears**: channel overrides, auto-trigger rules, user blacklists, and channel whitelists.
  - Requires the Manage Server permission in servers; also available in DMs.
- `/reset personal config`: restores personal profile settings and channel spotlights to defaults.
  - **Preserves**: user identity, personal memories, saved provider API keys, custom endpoints,
    and scheduled tasks.
  - **Clears**: nickname overrides, appearance tags, pronouns, addressing style, and channel spotlights.
  - Available to all users in servers and DMs.

For exact database tables and preserved column lists, see the
[database schema architecture](/architecture/subsystems/database-schema/#reset-domain-classifications).

## Opting Out

- `/personal config`: control your visibility, up to full invisibility (opting out of memory context).
- `/config` > Permissions: server managers can toggle self-learning and memory features off.

See [Memory](/features/knowledge/memory/) for day-to-day memory management.
