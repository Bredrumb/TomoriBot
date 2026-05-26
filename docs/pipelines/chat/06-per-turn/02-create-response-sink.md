<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Per-Turn Stage 02 — `createChatResponseSink`

Resolve the Discord delivery target and produce the sink callbacks that
generation will write through.

**File:** `src/utils/chat/responseEmitter.ts:62-99`

## Mission

The `ChatResponseSink` is the **seam between provider streaming and Discord
delivery.** Generation calls into the provider, the stream orchestrator
processes chunks, and the sink owns *where the rendered text lands*: an
alter-persona webhook, a temporary user-impersonation webhook, or the
plain-channel-send fallback. This stage builds that sink, including the
`prepare/emitStreamResult/emitError/finalize` callbacks, and stores the
resolved `responseTarget` on the carried context.

## Input

`ChatTurnContext` (from per-turn stage 01).

## Output

`ChatResponseSink` — see `src/utils/chat/types.ts:223-228`:

```ts
interface ChatResponseSink {
  prepare?(context): Promise<ChatResponseTarget | undefined>;
  emitStreamResult(result: StreamResult): Promise<void>;
  emitError(error: unknown): Promise<void>;
  finalize(result: GenerationTurnResult): Promise<void>;
}
```

The `ChatResponseTarget` returned by `prepare` (see
`src/utils/chat/types.ts:214-221`) carries:

- `webhook` / `temporaryWebhook` — Discord webhook for delivery (if any)
- `personaUsername`, `personaAvatarUrl` — display identity
- `prefixStrippingName` — for impersonation, strip this prefix from emitted
  text
- `webhookTargetChannel` — parent channel for thread-scoped webhooks

`undefined` target means "fall back to `channel.send` as the bot account."

## Side effects

**On `prepare()`:**

- Resolves the delivery target via `resolveResponseTarget`:
  - **User impersonation** (`isUserImpersonation` + `impersonatedUserId`):
    creates a *temporary* webhook with the impersonated user's display name
    and avatar via `webhookTargetChannel.createWebhook`. Cached via
    `cacheUserImpersonationWebhook`.
  - **Alter persona** (`currentPersona.is_alter`): resolves the
    server-owned persona webhook via `getOrCreateWebhook` and
    `resolvePersonaWebhookIdentity`.
  - **Main persona / DM / unsupported channel:** returns `undefined`.
- Sends a webhook-error embed (cooldown-throttled per channel) if webhook
  creation failed and the turn is deliberate enough to surface user errors.
- Updates the channel lock's `activeTurnState` with this turn's persona ID
  and impersonation flags; clears `isInToolCallChain`.

**On `emitStreamResult(result)`:**

- Logs and renders an error embed via `sendStandardEmbed` if `result.status
  === "error"` and `context.shouldSurfaceUserErrors` is true.

**On `emitError(error)`:**

- Renders an error embed (or re-throws if `isUserImpersonation`, since
  impersonation errors must not surface as the impersonated user's
  "message"). Non-deliberate turns log the failure and stay quiet in chat.

**On `finalize(result)`:**

- Deletes the temporary impersonation webhook if one was created.
- Logs the response count and final status.

## Invariants

After `prepare()` runs:

- `context.responseTarget` is set (to the resolved target or `undefined`).
- The channel lock's `activeTurnState` reflects this turn's persona +
  impersonation identity.
- A temporary impersonation webhook, if created, will be deleted in
  `finalize` regardless of generation outcome.

After `finalize()` runs:

- Any temporary webhook created during `prepare` has been deleted (best-effort
  — failures are logged, not thrown).

## Extension points

**The `ChatResponseSink` interface itself is the extension point.** The sink
is constructed *per turn* and the same interface contract is consumed by
both the stream orchestrator (writes chunks) and the generation stage (calls
`prepare`/`finalize`). A plugin wanting to:

- **Intercept emitted text** (filter, transform, redact) — wrap the sink's
  emit pathway. → plugin plan candidate; today there's no registration
  mechanism.
- **Add a new delivery target type** (e.g. Matrix relay, embedded reply) —
  extend `resolveResponseTarget` with a new target-kind branch.
- **Customize webhook identity** — `resolvePersonaWebhookIdentity` and
  `resolveImpersonatedIdentity` are the named seams.

**Related but non-sink extensibility:**

- Webhook creation/fetch policy lives in `getOrCreateWebhook` in
  [webhook manager](../../../systems/) <!-- TBD-XREF:legacy --> (currently
  `webhookManager.ts` / `webhook/webhookCore.ts`).
- Stream-orchestrator-side rendering and chunking lives in
  [provider pipeline](../../provider/) (currently also in
  `docs/ai/streaming.md` <!-- TBD-XREF:legacy --> and
  `docs/ai/text-flushing-and-chunking.md` <!-- TBD-XREF:legacy -->).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WEBHOOK_ERROR_COOLDOWN_MS` | `600000` | Per-channel cooldown between webhook-error embeds |

## Related docs

- Stream consumption: → [provider pipeline](../../provider/)
  <!-- TBD-XREF:sibling -->
- Webhook lifecycle and fallback: → [webhook subsystem](../../../subsystems/)
  <!-- TBD-XREF:sibling --> (currently in webhook helper files; no dedicated
  doc yet)
- Multi-persona delivery identity: → `docs/ai/multi-persona.md`
  <!-- TBD-XREF:legacy -->
