---
title: "Conversation recording"
aiGenerated: true
---

`src/modules/conversation-recording/` owns consent, capture, persistence, lifecycle, and private
exports. It consumes Discord events independently of the chat pipeline and does not call providers.
The [feature guide](/features/conversation-recordings/) owns user-visible behavior.

## Consent and capture ownership

Thin `/record` commands call `executeRecordingCommand`; the interaction router registers
`recordingInteractionRoute`. Controls bind a random nonce to the caller, guild, action, and allowed
interaction type. Submissions consume their control. These process-local controls expire after
15 minutes; restart or controller ownership changes require reopening the command. They contain
settings and scope metadata, never transcripts. Manager permissions provide no override.

Activation requires explicit confirmation of both settings. The controller passes a repository
consent token, so a stale confirmation cannot start collection after an intervening lifecycle change.
Modal opening precedes acknowledgement; other asynchronous interaction work acknowledges first.

The detached `conversationRecording.ts` handlers under `messageCreate`, `messageUpdate`,
`messageDelete`, and `messageDeleteBulk` call `RecordingCaptureRuntime`. Only a real owner's new
guild message admits capture. Shard ownership and lease checks surround asynchronous work. A
per-channel work queue preserves create/edit ordering; admission retains its original session revision.
There is no restart replay or backfill. Saturation skips windows instead of retaining an unbounded
raw-message backlog.

Before history retrieval, capture checks current owner and bot permissions and the shared channel
privacy gate. It requests one bounded history page, filters eligibility, and selects at most ten
preceding messages plus the trigger. Private/restricted channels and private threads are excluded.
Fresh repository eligibility checks prevent permissive cached privacy state from admitting excluded
participants. Proxy and persona attribution reuse the existing verified identity paths.

## Stored records and lifecycle

`db/repositories.ts` owns SQL; `db/types.ts` validates version-1 transcripts and input shapes.
`runtime/identity.ts` normalizes bodies before persistence using shared participant alias catalogs
and original-text matching spans. Alias names remain transient. Structured identities stay bare;
generated body replacements have square brackets. User-authored lookalikes convey no identity
provenance. Neither persistence nor export runs template expansion. Attachment type/count metadata
travels with each message, including edits and logical-size accounting.

Sessions belong to one owner and server. Restricted source identifiers support ownership,
deduplication, privacy pruning, and observed source updates; export never exposes them. Messages can
be shared by overlapping excerpts within a session, but each excerpt preserves ordered membership
and its eligible reply relationships. Reclaim shared messages only after no excerpt references them.

Owner-row transaction locks serialize writes across servers, including the 100 MiB owner quota.
`conversation_recording_excerpt_sizes` accounts for UTF-8 serialized transcript messages, excerpt
metadata, separators, and reply references independently of physical deduplication. Eviction removes
oldest whole excerpts atomically across that owner's servers. Body truncation is not an admission
strategy.

Repository transactions enforce retention, session expiry, and stored privacy pruning on reads and
writes. Session/revision checks fence queued capture after stop, expiry, settings changes, or
deletion. Source edits update existing copies only. Observed deletes remove shared copies and fence
in-flight admission. FULL privacy writes also stop owned sessions, including empty sessions; other
stored exclusions are reconciled through repository maintenance. Losing Discord channel access alone
does not erase stored records or block their export.

`runtime/cleanup.ts` runs bounded cleanup on the primary process, avoids overlapping ticks, and stops
at shutdown through `src/init/timers.ts`. Retention configuration is validated before database or
Discord startup. Operator configuration and backup handling belong in
[Maintenance & Backups](/self-hosting/maintenance/#conversation-recording-storage).

## Private export contract

`export/range.ts` supplies the UTC half-open trigger range shared by exports and range deletion.
`export/transcript.ts` reads validated stored records with current privacy/retention enforcement,
without fetching source channels. Rendering preserves individual messages and overlapping excerpt
boundaries without provider roles or inferred conversations.

Each independent export generates opaque mappings for message, excerpt, and session IDs. Shared
messages keep one export-local ID across parts, distinct messages retain distinct IDs, and reply
references outside the exported set become null. JSON structured identity fields remain bare;
Markdown brackets speaker/channel labels and emits normalized bodies unchanged. Attachment markers
are localized at Markdown rendering; JSON retains structured counts.

Exports admit at most 16 MiB of logical input or 4096 excerpts, render at most 24 MiB, and split only
between complete excerpts into at most ten files. Each file is bounded by 8 MiB or Discord's smaller
reported limit. Oversized exports request a narrower range without delivering partial results.
The controller admits two concurrent exports per process and one per owner. Files use ephemeral
interaction delivery. Failure logging reports the operation without transcript-bearing error details.
