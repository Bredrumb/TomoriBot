---
title: "Chat Pipeline"
sidebar:
  groupLabel: "Chat"
  order: 100
---

The chat pipeline turns a single Discord `messageCreate` event into zero, one, or
many persona replies. It is the spine of TomoriBot — most other AI subsystems
(context build, tool loop, provider streaming, memory capture) are reached from
inside this pipeline.

**Entry point:** `src/events/messageCreate/tomoriChat.ts:tomoriChat()`

**Triggered by:** every Discord `messageCreate` event (including bot/webhook
messages — filtering happens inside `evaluateChatAdmission`), plus internal
re-invocations from retries, queue replays, stop-response generation, boomerang
follow-ups, and command-driven manual triggers.

## Read order

This folder is numbered. Read the stage files top to bottom; the per-turn loop
lives in `06-per-turn/`.

## Stage flow

```
tomoriChat(TomoriChatInput)
  │
  ▼
[01] normalizeChatInvocation                  → ChatIncoming
  │
  ▼
[02] evaluateChatAdmission                    → ChatAdmission
  │                                              (run | ignore | queued | blocked | error)
  │   disposition === "run"?
  │       no  ─────────────────────────────→ [03] handleChatDisposition → end
  │       yes
  ▼
[04] runWithChannelLock {                     ← concurrency wrapper (not a transform)
  │
  ▼
[05] planChatTurns                            → ChatTurnPlan { turns: ChatTurn[] }
  │
  │   turns.length === 0? ────────────────→ release lock, replay queue, end
  │   else: for each turn:
  │     │
  │     ▼
  │   [06-per-turn]
  │     ├─ [01] buildChatTurnContext         → ChatTurnContext
  │     ├─ [02] createChatResponseSink       → ChatResponseSink
  │     ├─ [03] runGenerationTurn            → GenerationTurnResult
  │     └─ [04] runPostTurnEffects
  │
} ← lock released, queued messages replayed
```

## Stage index

| # | Stage | File | Mission |
|---|-------|------|---------|
| 01 | `normalizeChatInvocation` | [`01-normalize-invocation.md`](./01-normalize-invocation) | Defensive input normalization. |
| 02 | `evaluateChatAdmission` | [`02-evaluate-admission.md`](./02-evaluate-admission) | Decide if/how this message turns into a generation. |
| 03 | `handleChatDisposition` | [`03-handle-disposition.md`](./03-handle-disposition) | Terminal handler for non-run dispositions. |
| 04 | `runWithChannelLock` | [`04-channel-lock.md`](./04-channel-lock) | Per-channel mutex + typing keepalive + queue replay. |
| 05 | `planChatTurns` | [`05-plan-turns.md`](./05-plan-turns) | Persona selection + per-turn state assembly. |
| 06 | per-turn loop | [`06-per-turn/`](./06-per-turn/) | Iterated once per responding persona. |

## Cross-references

- **Per-turn stage 01 (build context)** delegates to the
  [context-build pipeline](../context-build/).
- **Per-turn stage 03 (generation)** delegates to the
  [tool-loop pipeline](../tool-loop/) and the
  [provider pipeline](../provider/).
- **Per-turn stage 04 (post-turn effects)** writes to
  [memory](../memory/) and may schedule cross-channel
  work via the boomerang mechanism in `crossChannelMessageTool`.

## Concurrency model

- One channel ⇄ one active turn-sequence at a time. Enforced by
  `runWithChannelLock`.
- Messages arriving while a channel is locked are either **enqueued for replay
  after lock release**, **converted to a follow-up interrupt** (if eligible),
  **converted to a natural-stop signal** (if matching stop phrasing), or
  **dropped** — full decision tree in [`04-channel-lock.md`](./04-channel-lock).
- Three recursive re-entries into `tomoriChat()` are by design:
  empty-response retry (with `skipLock=true`), stop-response generation (after
  lock release, via `handleStopResponse`), and boomerang follow-up (with
  `suppressNextSelfReply`).

## Quality notes

- `tomoriChat.ts` is the coordinator only — all stage implementations live under
  `src/utils/chat/`. The event-loader scans `src/events/messageCreate/*.ts`
  shallowly, so helper modules colocated with chat logic *must not* sit in that
  folder (they would be auto-registered as additional handlers).
