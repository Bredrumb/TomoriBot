---
title: "Adding a Panel or Panel Button"
sidebar:
  order: 10
aiGenerated: true
---

How to build a Components V2 panel that users click through, and how to add a button or select to an
existing one. The text and layout rules are in
[Panel Prose and Layout](/contributing/policies/panel-prose-and-layout/); this page covers the wiring.

## Choose the lifecycle

First decide whether this should be a panel at all, and which kind, with
[Command Archetypes](/contributing/policies/command-archetypes/).

- **Global route**: the panel outlives the command, and every click rebuilds its state from the custom
  ID plus the database. Most settings panels (`/config`, `/moderation`, `/memories`) work this way.
- **Anchor workflow**: a multi-step write that belongs to one command session, with a collector and a
  timeout. See [Pattern 4A](/architecture/subsystems/command-system/#pattern-4a-anchor-message-workflow-persona-picker).

The rest of this page covers global routes. Do not move an existing collector to a global route unless
the panel needs to outlive the command.

## Files

A panel named `example` has three files. Copy `conditioning` (small, with a modal write) or
`moderation` (categories, pagination, receipts):

| File | Owns |
|---|---|
| `src/utils/discord/examplePanelCatalog.ts` | `EXAMPLE_ROUTE_NAMESPACE`, `EXAMPLE_ROUTE_VERSION`, the route union, its codecs, `buildExampleRouteId()`, and `parseExamplePanelRoute()` |
| `src/utils/discord/ui/examplePanel.ts` | A pure builder from state to payload, ending in `buildPanelContainer()` |
| `src/utils/discord/interactions/exampleRoutes.ts` | `createExampleInteractionRoute(overrides)` and the exported `exampleInteractionRoute` |

Then:

1. Register `exampleInteractionRoute` in the `InteractionRouteRegistry` list in
   `src/utils/discord/interactions/router.ts`. If the namespace differs from the command name, add it to
   the outdated-panel mapping in the same file, or a click on an old panel tells users to run a
   command that does not exist.
2. Send the first render from the command's `execute()` with
   `deliverGuardedPanel(interaction, payload, { method: "reply", locale, flags: payload.flags | MessageFlags.Ephemeral })`,
   or `deferReply()` first and use `method: "editReply"` when loading state is slow.
3. Add the builder to `tests/unit/discord/componentsV2ProducerManifest.test.ts`, which fails for any
   module that sets `MessageFlags.IsComponentsV2` without an entry.

## Custom IDs

Build every ID with the catalog's builder, which calls `buildInteractionRouteId(namespace, version,
...segments)`:

- IDs are `namespace:version:action:locale:...fields`. Segments cannot be empty or contain `:`.
- The builder throws past Discord's 100 characters. Put a list index and a short content fingerprint
  in the ID; never a name, a URL, or free text.
- Carry the panel locale, so later clicks keep the language without another database read.
- Field order in a codec is a published format: posted messages still carry IDs from older builds.
  To change the order or meaning of a field, bump the version. The registry then answers old clicks
  with an outdated-panel reply instead of misreading them.
- For a write that depends on a list (remove the third entry), put a fingerprint of that list in the
  ID and refuse the write when it no longer matches. See `computeConditioningAggregateFingerprint()`.

## Handling a click

```ts
const scope = await beginPanelInteraction(interaction, {
  authorize: () => isAuthorized(interaction),
  onDenied: () => interaction.editReply(terminalPayload(route.locale, "commands.example.permission_denied")),
  load: () => dependencies.resolveScope(interaction),
  onMissing: () => interaction.editReply(terminalPayload(route.locale, "commands.example.not_setup")),
});
if (!scope) return;
await repaint(interaction, route.locale, scope);
```

- `beginPanelInteraction()` acknowledges first, then authorizes and loads. Discord allows three
  seconds for the acknowledgement, and anything slow before it loses the interaction.
- A branch that opens a modal does not use it: `showModal()` must be that interaction's
  acknowledgement, so everything before it (permission check, one fast read) has to finish inside the
  three seconds. Refuse such a press (denied, stale, nothing to change) with
  `replyPanelReceipt(interaction, receipt)` from `src/utils/discord/ui/panel.ts`. It sends the receipt as
  a private card and never edits the panel that was pressed. Do not reply with plain `content`.
- Check the interaction type for each action (`isButton()`, `isStringSelectMenu()`,
  `isModalSubmit()`) and throw on a mismatch; the router logs it and replies with a generic error.
- Repaint through `deliverGuardedPanel(interaction, payload, { locale, receipt })`. It validates
  Discord's limits, substitutes a fallback in production, and emits a `panel_failure` metric for an
  `error` or `warning` receipt. Return the failure as a receipt; do not throw after a write has
  committed. See [Panel failure observability](/architecture/subsystems/command-system/#panel-failure-observability).
- Take repositories and other side effects as dependencies of `createExampleInteractionRoute()`, so
  tests pass fakes instead of using `mock.module()`.
- After a successful write, call `recordPanelActionStat()` with an action from `PANEL_ACTIONS` in
  `src/constants/panelActions.ts` (`<surface>.<scope>.<resource>.<verb>`). Add the action there
  first; the metric only accepts listed identifiers.

## Opening on a page

A panel with categories takes an optional `page` option so users can jump straight to a page or
category; [Command Archetypes](/contributing/policies/command-archetypes/#opening-on-a-page) says which
panels get one. The helpers are in `src/utils/discord/autocomplete/panelPageAutocomplete.ts`:

1. Write `listExamplePageDestinations(locale, context)` next to the command's executor. It returns
   one `PanelPageDestination` per page the invoker may open, filtered by the same visibility rules
   the page select uses, with the existing category and page label keys. A category without pages
   is one destination with a null `page` and `pageLabel`, as in `/memories`.
2. Add the option with `configurePanelPageOption(option, description)` and the key
   `commands.<path>.page_description`. Keep it optional: a subcommand or a required option stops the
   bare command from running.
3. In `autocomplete`, answer with `respondWithPanelPages(interaction, destinations)`. Labels read
   `Category > Page` and match on either half. Autocomplete has the three-second limit and no deferral,
   so build the context from the interaction (guild, member permissions) instead of a database read.
   If the command has another autocompleted option, branch on `interaction.options.getFocused(true).name`.
4. In `execute`, run `resolvePanelPage(destinations, submitted)` on destinations rebuilt from the
   loaded scope; a suggestion does not authorize anything. Open the panel on the result through the
   normal repaint so each page loads its own data. When nothing matches, open the default page with
   `panelPageNotFoundReceipt(locale)`.

A panel whose pages belong to a persona also takes an optional option named `persona`, so the loader
localizes `commands.<path>.persona_description`. Check that key is free first, because the loader applies
whatever text it already holds. Answer it with `handleWorkspacePersonaAutocomplete`
and resolve it with `resolveSelectedPersona` from `src/utils/persona/personaOptionValue.ts`, which also
accepts a typed nickname that exactly one persona has. When nothing resolves, open on the default
persona with `panelPersonaNotFoundReceipt(locale)`. A command that deletes without a confirmation step
accepts only a picked ID, as `/persona remove` does.

## Discord limits

`validateComponentsV2MessageLimits()` in `src/utils/discord/ui/componentsV2Limits.ts` enforces these,
and `deliverGuardedPanel()` runs it:

- 40 components per message, counting every nested component. Modal components do not count, so a
  long form belongs in a modal.
- 4,000 characters across all `TextDisplay` components. Bound body text with `buildTextPreview()`,
  and render a stored prompt or note with `renderFencedPreview()`.
- 25 options per select, each value unique. A duplicate value makes Discord reject the payload, and
  no static check catches it.

## Adding a button or select to an existing panel

1. Add the action to the route union and codecs in the catalog. Append fields; bump the version if an
   existing action's fields change.
2. Render the component in the `ui/` builder with an ID from the catalog builder. Follow the colour
   and label rules in
   [Panel Prose and Layout](/contributing/policies/panel-prose-and-layout/#buttons);
   `tests/unit/discord/panelButtonColour.test.ts` checks the styles.
3. Handle the action in the route file, with its interaction-type check.
4. Add the `PANEL_ACTIONS` entry if it writes, and localized labels under the panel's key prefix in
   `src/locales/en-US/`.
5. Extend the panel's route test and its `*PanelLimits.test.ts`, then check that the extra component
   stays under 40 in the fullest state.

## Tests

- `tests/unit/discord/exampleRoutes.test.ts`: each action with fake dependencies, including denied,
  missing, stale fingerprint, and write failure.
- `tests/unit/discord/examplePanelLimits.test.ts`: the builder across every locale in `src/locales/`,
  receipts on and off, each state, list sizes around the page size, and varied content shapes (long
  bodies, backticks, empty values). Uniform short fixtures miss the overflows.
- A table of literal custom IDs when the panel has several versions in use, as
  `WIRE_CONTRACT_V2` in `tests/unit/discord/personalConfigRoutes.test.ts` does.

Run `bun run check`, `bun run lint`, `bun run check-locales`, and `bun run test`, then click through
the panel in Discord in a second locale.

Background: [Command System](/architecture/subsystems/command-system/#globally-routed-persistent-interactions),
[Message Components V2](/architecture/integrations/discord/message-components-v2/),
[Modal Input Components](/architecture/integrations/discord/modal-input-components/).
