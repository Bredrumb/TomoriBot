<!-- ARCH-ALIGNMENT: prereq-phase-5.5d -->

# Stage 03 — `handleChatDisposition`

Terminal handler for non-run dispositions.

**File:** `src/utils/chat/admission.ts:378-385`

## Mission

The "exit door" for the four non-runnable dispositions. Currently log-only —
emits `log.warn` for errors and `log.info` for ignore/queued/blocked. Exists as
a named stage (rather than being inlined into the coordinator) precisely so
disposition handling has a single seam to grow into.

## Input

`NonRunnableChatAdmission` (from stage 02, when `disposition !== "run"`).

## Output

`Promise<void>` — terminal stage. No further pipeline activity for this message.

## Side effects

- `log.warn(...)` if `admission.error` is set.
- `log.info(...)` otherwise.

## Invariants

After this stage runs:

- The chat coordinator returns immediately; no lock is acquired, no further
  stages execute for this message.
- The original `messageCreate` event has been fully consumed.
- Channel state (locks, queues, self-reply chain) is **not** mutated here —
  stage 02 made any required mutations already.

## Extension points

**Internal — log-only terminal handler.** This is the natural seam if the
project ever needs to:

- Emit metrics (`disposition_count{disposition="blocked", reason="rate_limit"}`)
- Surface user-visible feedback for certain block reasons that don't already
  emit an embed in stage 02
- Notify external observability (Sentry, log aggregator) for `error`
  dispositions with structured metadata

For now, the stage is intentionally minimal. Plugins should not hook here
unless they're adding orthogonal telemetry — disposition decisions belong in
stage 02 (or its helpers), not after the fact.
