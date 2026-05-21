<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 01 — `normalizeChatInvocation`

Defensive input normalization at the chat pipeline's entry boundary.

**File:** `src/utils/chat/admission.ts:26-56`

## Mission

Promote the loose `TomoriChatInput` (many optional fields, defaults left to
consumers) into the strict `ChatIncoming` shape carried through the rest of the
pipeline. Apply defaults once, here, so every downstream stage can rely on a
populated contract instead of re-checking `?? defaultValue` everywhere. Pure
transform; no I/O.

## Input

`TomoriChatInput` — defined in `src/utils/chat/types.ts:33-61`. The public input
shape accepted by `tomoriChat()`. Optional fields cover the many invocation
contexts: Discord event handler, command-triggered manual invocations, retry
re-entries, boomerang follow-ups, reminder scheduler, stop-response generation.

## Output

`ChatIncoming` — defined in `src/utils/chat/types.ts:63-91`. Same fields as
`TomoriChatInput`, but with non-optional defaults applied:

| Field | Default |
|---|---|
| `retryCount` | `0` |
| `skipLock` | `false` |
| `isPersonaJob` | `false` |
| `isUserImpersonation` | `false` |
| `textQuotaSource` | `"user"` |

Every other field is copied through verbatim.

## Side effects

None. Pure function.

## Invariants

After this stage runs:

- The returned `ChatIncoming` has every non-optional field populated.
- No downstream stage needs to defensively check `input.retryCount ?? 0` or
  similar — those checks happened here, once.
- Mutating `ChatIncoming` later is allowed in specific cases (e.g.
  `evaluateChatAdmission` sets `isPersonaJob = true` for self-messages), and is
  permitted *because* the shape is now well-defined.

## Extension points

**Internal — pure normalization stage.** A plugin wanting to inject input
transformations should hook *before* this stage runs (i.e. at the `tomoriChat()`
entry, not here). Once normalization completes, the contract is "fields are as
declared on `ChatIncoming`" and modifying them later risks invariants in
downstream stages.

If a plugin needs to add new optional input fields (e.g. plugin-specific
metadata), the right move is to extend `TomoriChatInput` and `ChatIncoming` with
the new field plus a default — not to bypass this stage.
