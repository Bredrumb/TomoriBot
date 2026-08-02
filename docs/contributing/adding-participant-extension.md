---
title: "Adding a Participant Source or Profile Enricher"
---

Participant extensions add typed identities or privacy-safe profile fields without changing
response routing, core hydration, or the prompt renderer. They are source-code extension
contracts, not a dynamic plugin loader.

## Choose the contract

Use `ParticipantSource` from `src/utils/text/participants/sources.ts` when a transport or
integration contributes participant identities. A source receives only the visible participant
input, persona catalog, reference plan, and an abort signal. It returns typed candidate keys,
inclusion reasons, aliases, and evidence.

Use `ParticipantProfileEnricher` from
`src/utils/text/participants/profileEnrichers.ts` when an integration appends display lines to
an already hydrated profile. An enricher receives an immutable identity snapshot, the active
persona scope, privacy-filtered core fields, and an abort signal. It returns fields only; core
attaches the stable owner key and final order.

## Descriptor and registration rules

Every contribution supplies `ContributionMeta`:

```ts
const meta = {
  id: "example.badges",
  owner: "example-integration",
  source: "src/integrations/example/participantBadges.ts",
  order: 300,
  criticality: "optional",
  after: ["core.profile-fields"],
} as const;
```

IDs are case-normalized and globally unique within their participant registry. Duplicate IDs
hard-fail with both owners and source paths. `after` and `before` dependencies must exist and
must be acyclic. Resolution uses dependencies first, then numeric order and stable ID, so
filesystem or registration order cannot change output.

Build registries explicitly and pass them through the supported preparation boundary:

```ts
const sourceRegistry = createParticipantSourceRegistry([{ source: exampleSource }]);
const profileEnricherRegistry = createParticipantProfileEnricherRegistry([
  { enricher: exampleEnricher },
]);

const prepared = await prepareParticipantContext({
  ...input,
  sourceRegistry,
  profileEnricherRegistry,
});
```

`PreparedParticipantContext` carries the enricher registry into native participant hydration.
No renderer or `buildContext()` change is required.

## Security boundaries

- Sources cannot schedule responses because routing state and schedulers are absent from their
  input and output contracts.
- Non-core sources cannot contribute a bot key or the `active_identity` reason.
- Every alias must be owned by the candidate's exact typed key.
- Mentionability is a core-granted `ParticipantCapability`. New source registrations receive
  no capability by default, even when they propose a Discord-user key.
- Enrichers cannot replace identity, aliases, mentionability, privacy decisions, or another
  field owner. Core supplies cloned immutable inputs and stamps returned fields with the
  participant key.
- Extension field kinds must use the `extension:{contribution-id}` namespace. Attempts to emit
  privacy-owned core kinds fail the contribution.
- Identity deduplication, alias collision resolution, exposure policy, and rendering stay in
  participant core.

## Failure and timeout behavior

Optional contributions record a bounded `failed` or `timed_out` diagnostic and contribute no
output. Critical first-party failures throw `ContributionExecutionError`, including the
contribution identity, owner, source, status, and cause. The runtime aborts work at these
configurable defaults:

- `PARTICIPANT_SOURCE_TIMEOUT_MS=1500`
- `PARTICIPANT_ENRICHER_TIMEOUT_MS=1500`

Diagnostics and metrics contain stable contribution IDs and aggregate counts/durations, never
participant IDs, aliases, or message content.

## Required tests

- registry order is stable when registration order is reversed
- duplicate IDs, unknown dependencies, and cycles fail before execution
- optional failure/timeout and critical failure follow their declared policies
- source candidates retain typed identity and cannot acquire ungranted mentionability
- enricher output keeps the original identity, core privacy fields, and deterministic order
- the rendered participant golden remains unchanged

Run `bun run check`, `bun run lint`, `bun run audit-comments`, focused participant tests, and
`bun run test` before handoff.

## Generic context contributor status

The generic `ContextContributor` registry from the modularization roadmap has not landed. The
whole participant slice remains one adapter-ready prepared input for that future participants
anchor; these registries do not imitate or claim completion of modularization Batch 4A.
