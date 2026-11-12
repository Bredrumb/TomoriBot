---
title: "Conversation recordings"
description: "Save excerpts around your server messages and privately export or delete your recordings."
sidebar:
  order: 5
aiGenerated: true
---

Conversation recordings let you save excerpts around your own messages in a server, then download
them as Markdown or JSON. Recording is optional and starts only after you confirm it.

## Start and stop recording

Run `/record start` in the server where you want to record. Choose a duration and whether to save
only your messages or include surrounding messages, then review the private confirmation.
`Until stopped (not recommended)` has no collection end, so choose a finite duration unless you
intend to manage it yourself.

You can have one active recording per server. Starting again while it is active opens its settings.
A context change affects new excerpts only. Choosing a different duration sets a new end measured
from that change; keeping the same duration keeps the existing end.

`/record stop` stops collection and preserves saved excerpts. `/record data` opens your data and
settings for the current server. These commands are unavailable in DMs. Server managers cannot use
these controls to inspect, export, or delete another member's recordings.

## What gets saved

Each new real message you send after activation can save an excerpt ending with that message,
even when Tomori does not reply. An excerpt contains up to ten preceding eligible messages in the
same channel or thread. There is no time cutoff for those preceding messages, and they may predate
activation. The recorder searches a bounded recent window, so it may find fewer than ten.

`My messages only` filters the excerpt to your messages. `Include surrounding messages` may also
save other members, bots, and webhooks, including participants who never started a recording.
Collection covers eligible server channels and public threads where both you and the bot can view
and read history. Private threads, restricted channels, configured privacy exclusions, and excluded
participants are skipped. Full privacy excludes a member's text; reduced personalization alone does
not exclude text.

Excerpts are overlapping source records. They preserve timestamps, chronological order, individual
message boundaries, and eligible reply relationships, including consecutive messages from one
speaker. They can contain the same message more than once across excerpts. They do not establish
complete conversations or training turns. Missed events, downtime, unavailable permissions, or a busy
recorder can leave gaps; there is no activation sweep or downtime backfill. Synthetic impersonation
messages do not trigger recording.

The recorder saves attachment presence as counts of images, videos, audio, and files, including
attachment-only messages. Unknown types count as files. Markdown renders localized markers such as
`[Image attached]` with counts; JSON keeps structured counts. Media bytes, filenames, attachment
URLs, OCR, and generated descriptions are not saved or downloaded. Embedded previews are omitted.

### Readable identity placeholders

Structured mentions become readable placeholders, for example `[SELF]: Hello [PARTICIPANT_1]!`.
Participants, channels, and roles have stable labels within a recording session:
`[SELF]`, `[PARTICIPANT_1]`, `[CHANNEL_1]`, and `[ROLE_1]`.

Before storing text, the recorder also replaces exact standalone known names and nicknames,
case-insensitively, using available privacy-permitted participants. It skips names shared by multiple
known identities and does no fuzzy matching or server-wide member search. A name that is also an
ordinary word can replace that word in unrelated prose. Custom Discord emoji become `:name:`;
Unicode emoji stay unchanged. Discord message links become a generic marker, while ordinary external
URLs stay unchanged.

Replacement is best effort. Free text and external links can still identify people. Text someone
types that resembles a placeholder remains literal text; its appearance is no proof that the
recorder generated it. Recorded text is never expanded as a template.

## Export and delete

In `/record data`, choose a date range and Markdown or versioned JSON. Dates use `YYYY-MM-DD` at
midnight UTC: `From` is inclusive and `Until` is exclusive. To include a whole day, use the following
day as `Until`. The range selects excerpts by their ending message's time; preceding context may be
older than the range.

Files arrive in the private interaction reply. Save them before that reply expires. Large exports
split between complete excerpts; if a range or single excerpt exceeds the limits, choose a narrower
range. Already-stored excerpts remain exportable after you lose source-channel access, subject to
current privacy exclusions and retention.

JSON assigns opaque IDs within each export. One source message shared by overlapping excerpts keeps
the same ID across split files; different messages with identical text keep different IDs. Reply
references use those IDs and omit targets outside the export. A separate export generates new IDs.
Structured identity fields stay bare, such as `SELF`; body placeholders keep their brackets.
Exports expose no stored or Discord source IDs. They preserve source records without merging
messages, inferring sessions or topics, or converting to provider training formats.

You can delete a selected date range or all your current-server records after confirmation. Deleting
records leaves the collection setting in place, so stop first if you also want to prevent new
excerpts. Stopping alone does not delete anything.

## Privacy and retention

The bot operator stores recordings in its database and may have infrastructure access. Private
Discord controls do not make storage exclusive to you. Recording makes no automatic AI-provider
calls and does not start a training pipeline or impersonation workflow.

Your quota is 100 MiB of logical transcript content across all servers. Repeated content counts in
each excerpt even when storage shares a message. When needed, the recorder evicts the oldest complete
excerpts across your servers; it never truncates message bodies to fit. The panel shows usage and
current-server eviction information.

The operator may set an age limit with `RECORD_RETENTION_DAYS`. Without it, automatic age expiry is
off. A configured limit applies to existing data too and expires whole excerpts by their ending
message's time. Collection duration and saved-data retention are separate.

Observed source edits reapply identity replacement and attachment counts. Observed single or bulk
deletions remove stored copies. Later privacy exclusions also prune affected stored data. The bot
cannot guarantee observing events while offline or after access changes, and it cannot retract
downloaded exports. Backups have separate retention and deletion handling. See the
[Privacy Policy](/legal/privacy-policy/) and, for self-hosters,
[recording maintenance](/self-hosting/maintenance/#conversation-recording-storage).
