---
title: "06.3: Generation Turn"
---

The generation stage executes the model request for a persona turn. It manages primary and fallback
models, rotates API keys upon failures, resolves server-route failovers for personal accounts, and
deletes superseded partial messages committed by failed attempts.

## Flow and ownership

`runGenerationTurn()` in `src/utils/chat/generationTurn.ts` prepares the response sink, builds a
`GenerationPlan`, and executes attempts in sequence:

```
ChatTurnContext & ChatResponseSink
  │
  ├─► responseSink.prepare()
  │
  ▼
buildGenerationPlan()
  │   ├─► Primary model & fallback models assembled
  │   ├─► Model randomizer (if enabled and ≥2 models): reorders lead attempt
  │   └─► extendWithServerRoute thunk: deferred server fallback for BYOK turns
  │
  ▼
for each attempt:
  │
  ├─► prepareProviderContextItems()      ──► resolves media parts, truncates dialogue history
  ├─► applyAssistantPrefill()            ──► formats prefill for attempt model
  │
  ▼
Key rotation loop:
  │
  ├─► runToolLoop()                      ──► provider streaming and tool execution
  │     ├─► Success?                     ──► break loop, recordKeySuccess()
  │     └─► Error?                       ──► recordKeyError(), rotate key if available
  │
  ▼
Attempt failed (error or timeout)?
  │
  ├─► deleteSupersededStreamMessages()   ──► deletes partial messages already sent to Discord
  ├─► More planned attempts?             ──► advance to next fallback model
  └─► Planned attempts exhausted?        ──► materialize extendWithServerRoute()
  │
  ▼
Successful attempt:
  ├─► index > 0?                         ──► sendFallbackModelUsageNotice()
  └─► responseSink.finalize(result)
  │
finally:
  └─► responseSink.cleanup()             ──► sink cleanup after exceptions
```

### Generation plan and model fallbacks

`buildGenerationPlan()` constructs the sequence of attempts:

- **Model chain**: places the primary model at index 0 followed by configured fallback entries (`FallbackEntry`).
- **Model randomizer**: when `model_randomizer_enabled` is active and the pool contains at least two models,
  it promotes a random pool member to the lead position. The original primary shifts into the failover chain.
- **Key rotation**: each attempt selects a credential from `keyRotation.ts`. Connection errors and rate limits
  cycle through available keys before attempting the next model.

### Deferred server route fallback

For turns planned using personal Bring Your Own Key (BYOK) credentials outside user impersonation,
`buildGenerationPlan` attaches an `extendWithServerRoute` thunk:

- **Lazy evaluation**: the server route is resolved only if every planned personal attempt fails. Successful
  personal attempts avoid these server-fallback reads and admission checks. Tools can resolve separate
  credentials according to their own routing policies.
- **Server admission**: before contributing attempts, the server route admits itself against the server's
  message cooldown and text quota. If admission fails, the personal failure remains the final outcome.
- **Credential transition**: when a server attempt runs, `textCredentialSource` switches to `"server"`.
  Subsequent recovery tips and thought-log attribution reflect the server's credentials.

### Context preparation and prefill

Each attempt tailors the context closure to its specific model before calling `runToolLoop()`:

- **Media capability resolution**: `prepareProviderContextItems()` checks the attempt model's media
  capabilities, converting dialogue media descriptors into image or video parts, or inserting notices
  when the model does not support media input.
- **History truncation**: trims dialogue history when the model's context window is known, reserving an
  output budget determined by server configuration or provider defaults.
- **Prefill formatting**: `applyAssistantPrefill()` continues the prefill as a trailing model message
  if the provider supports prefix completion, or converts it into a tail directive otherwise.

### Superseded message cleanup

If an attempt fails after partially delivering content (such as an SDK timeout or mid-stream error),
`deleteSupersededStreamMessages()` deletes those partial messages before the next attempt runs:

- Committed message references are tracked in `streamingContext.deliveredMessageRefs`.
- Deletion targets persona webhooks directly, falling back to channel-level message deletion if needed.
- Deleting partial messages prevents truncated fragments from lingering above the fallback model's
  complete response.
- Before cleanup after an SDK timeout, the tool loop awaits the abandoned stream for up to
  `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` (5000ms) to let in-flight sends register before deletion.
  Sends that outlive this window and failed deletions can leave partial output visible.

### Error suppression and notices

- **Suppression during failover**: error embeds are suppressed while further rotation keys or fallback
  models remain available, preventing transient provider hiccups from posting false failure notices.
- **Fallback notice**: if a fallback model succeeds (`index > 0`), `sendFallbackModelUsageNotice()`
  renders a compact Discord button notice informing users that a fallback model answered the turn.
- **Final emission**: if all attempts fail, only the terminal error is emitted to the response sink.

## Constraints and rationale

- **Failover effects**: cleanup attempts to remove tracked stream messages. It does not roll back tool
  database writes, external requests, or independently delivered tool messages. A replacement attempt
  starts a new tool history, so tools must own any protection against repeated external effects.
- **Deferred server admission**: resolving server fallback routes only on personal failure prevents
  unnecessary database writes and server quota checks on successful member turns.
- **Per-turn cleanup**: a `finally` block invokes sink cleanup after exceptions. Temporary webhook
  deletion is best-effort, as described by [Response Sink](/architecture/pipelines/chat/06-per-turn/02-create-response-sink/).

## Source pointers

- `src/utils/chat/generationTurn.ts`: `runGenerationTurn()` and generation plan execution.
- `src/utils/chat/toolLoop.ts`: `runToolLoop()` function-calling loop.
- `src/utils/discord/stream/supersededMessageCleanup.ts`: deletion of abandoned partial message sends.
- `src/utils/security/keyRotation.ts`: API key selection and rotation tracking.
