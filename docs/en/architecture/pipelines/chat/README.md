---
title: "Chat Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Chat"
  order: 100
---

The chat pipeline turns a single Discord `messageCreate` event into zero, one, or
many persona replies. It is the spine of TomoriBot: most other AI subsystems
(context build, tool loop, provider streaming, memory capture) are reached from
inside this pipeline.

- **Entry point**: `src/events/messageCreate/tomoriChat.ts:tomoriChat()`

- **Triggered by**: every Discord `messageCreate` event (including bot/webhook
messages: filtering happens inside `evaluateChatAdmission`), plus internal
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
- **Stage 02 (admission)** runs the selected chat-proxy speedbump. See
  [`02-evaluate-admission.md`](./02-evaluate-admission) for admission mechanics,
  [Chat-Proxy Integration](../../integrations/chat-proxy) for the shared safety and identity model,
  and [PluralKit Adapter](../../integrations/pluralkit) for supported transport behavior.

## Concurrency model

- One channel ⇄ one active turn-sequence at a time. Enforced by
  `runWithChannelLock`.
- Messages arriving while a channel is locked are either enqueued for replay
  after lock release, converted to a follow-up interrupt (if eligible),
  converted to a natural-stop signal (if matching stop phrasing), or
  dropped: full decision tree in [`04-channel-lock.md`](./04-channel-lock).
- Three recursive re-entries into `tomoriChat()` are by design:
  empty-response retry (with `skipLock=true`), stop-response generation (after
  lock release, via `handleStopResponse`), and boomerang follow-up (with
  `suppressNextSelfReply`).

## Quality notes

- `tomoriChat.ts` is the coordinator only: all stage implementations live under
  `src/utils/chat/`. The event-loader scans `src/events/messageCreate/*.ts`
  shallowly, so helper modules colocated with chat logic *must not* sit in that
  folder (they would be auto-registered as additional handlers).

## Chat troubleshooting files

`/troubleshoot chat` gives a user a private JSON file for their latest message in the current
channel from the past 15 minutes. They can supply a link to their message or a bot reply to
select a specific turn from the past hour, or enter the approximate number of minutes ago
(within five minutes of a matching trigger). Standard, Canary, and PTB Discord message links are
accepted for the current channel. The command tries a DM first and shows a private embed receipt.
If the DM fails, it attaches the file to that private reply. It does not send the file to support.

`diagnosticTimeline.ts` records admission, queue and persona turns, context history, provider
attempts, tool continuations, and Discord sends. Attempts use labels such as `model-1` so two
attempts on the same model can be compared without exposing its name. Context history records
the latest 25 fetched messages with relative millisecond offsets, author roles, and whether each
message entered the simplified history. The provider event lists the dialogue messages retained
for that attempt. This shows whether a later user's message entered the first user's prompt.

Each streamed `message_sent` event names its trigger source, persona turn, model attempt ordinal,
key attempt, tool iteration, and message number within that stream. The `origins` list marks
persona jobs, later persona turns, model fallbacks, key retries, and tool continuations. The `reason` marks a
streamed segment, a length or formatting split, a heavy humanizer split, or a rendered table.
The `route` distinguishes a normal send from webhook recovery or bot fallback after a webhook
failure. Standalone reply notices and tool UI sent outside the stream delivery path are not
`message_sent` events. Tool continuations reuse the existing context items; another
`context_history` event appears only if a chat turn rebuilds them.

The file contains UTC times, relative millisecond offsets, counts, status codes, and labels such
as `message-2`. It excludes message text, prompts, user IDs, channel IDs, and raw message IDs.
The bot keeps the raw IDs in memory to find and join events. The store holds at most 5,000
message traces for one hour, 100 events per trace, and 100 delivered message IDs per trace for
reply-link lookup. A restart clears it. If chat runs on multiple bot processes or users need
reports after a restart, move this bounded record to a
shared store before relying on the command for those cases. `stat_counters` remains an aggregate
usage record and cannot reconstruct this event order.
