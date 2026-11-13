---
title: "Conversation recordings"
description: "Save excerpts around your server messages and privately export or delete your recordings."
sidebar:
  order: 5
---

Conversation recordings is an opt-in feature that saves excerpts around your own server messages for your personal use only, with structured Discord identities replaced by placeholders before storage (free text and external links can still identify people).

**By default, TomoriBot does not save your messages, recording is optional per-user for their own personal use only, and starts only after you confirm the `/record` command. TomoriBot does not automatically build personas, make AI-provider calls, or feed any training pipeline with these excerpts.**

## What it is used for

- Keeping personal archives of your own server messages and surrounding context.
- Reviewing past discussions with timestamps, message order, and reply links.
- Reviewing your own writing style to draft persona notes or prompts offline.
- Exporting structured Markdown or JSON transcripts for your own offline use.

## Start and stop recording

- **`/record start`**: Pick a duration and whether to save only your messages or include surrounding messages, then confirm. Avoid `Until stopped (not recommended)` unless you plan to stop it manually.
- **Active sessions**: You can have one active recording per server. Running `/record start` while active opens its settings: context changes apply to new excerpts only; changing duration sets a new end from now, while keeping the same duration keeps the current end.
- **`/record stop`**: Stops collection and keeps saved excerpts.
- **`/record data`**: Opens your recordings and settings for the current server.
- **Scope**: Unavailable in DMs. Server managers cannot view, export, or delete your recordings.

## What gets saved

- **Triggers**: After activation, each real message you send can save an excerpt ending with that message (even when Tomori does not reply). Impersonation messages do not trigger recording.
- **Context**: Up to 10 earlier eligible messages in the same channel or thread from a bounded recent window (they may predate activation).
- **Modes**: `My messages only` saves only your messages. `Include surrounding messages` can also save other members, bots, and webhooks, even if they never started a recording.
- **Eligible channels**: Server channels and threads where both you and the bot can view and read history, including restricted channels and private threads. Members with Full privacy are skipped. Channel privacy and cross-channel context settings do not exclude your recordings.
- **Gaps and duplicates**: Excerpts are overlapping snapshots with timestamps, order, and reply links. The same message can appear in multiple excerpts. Downtime, missed events, or missing permissions leave gaps (no backfill).
- **Embeds**: Saves embed titles, descriptions, fields, author names, and footers as message text, with the same identity replacement as ordinary text.
- **Attachments**: Saves counts of images, videos, audio, and files (unknown types count as files). Media bytes, filenames, attachment URLs, OCR, and generated media descriptions are not saved.

### Readable identity placeholders

- Structured mentions, channels, and roles use stable session placeholders (`[SELF]`, `[PARTICIPANT_1]`, `[CHANNEL_1]`, `[ROLE_1]`).
- Unique known names and nicknames are replaced case-insensitively before saving (which can replace ordinary words that match a name). Shared names are skipped, and no server-wide search is run.
- Custom Discord emoji become `:name:`; Unicode emoji stay as is. Discord message links become a generic marker; external URLs stay as is.
- Replacement is best effort: free text and external links can still identify people. Typed text that looks like a placeholder stays literal text.

## Export and delete

- **Export**: In `/record data`, choose a time range and Markdown or JSON. Relative ranges end when you submit; `All time` includes all saved excerpts. Excerpts are selected by their ending message's time.
- **Delivery**: Files arrive in a private reply (save them before it expires). Filenames include the UTC export time and a short export ID; split files also include part numbers. Large exports split between complete excerpts; narrow the range if a range or excerpt exceeds size limits. Saved excerpts remain exportable even if you later lose source-channel access.
- **JSON IDs**: Each export assigns fresh opaque IDs (shared messages keep the same ID across split files; identical-text messages get different IDs). No Discord or stored IDs are exported.
- **Delete**: Use `Delete server records` to choose a time range, including `All time`, then confirm. Time ranges end when you submit the selection; messages recorded afterward remain saved. Deleting does not stop an active recording, and stopping does not delete saved records.

## Privacy and retention

- **Operator access and AI**: The bot operator stores recordings in its database and may have infrastructure access. Recording makes no AI-provider calls and starts no training or impersonation workflow.
- **Quota**: 100 MiB of logical transcript content across all servers (shared messages count per excerpt). When full, the oldest complete excerpts across your servers are evicted first.
- **Retention**: Automatic age expiry is off unless the operator sets `RECORD_RETENTION_DAYS`, which expires whole excerpts (including existing ones) by their ending message's time.
- **Edits and deletions**: Observed source edits update stored text and attachment counts; observed deletions and later privacy exclusions remove stored copies. Offline or inaccessible events cannot be observed, and downloaded files or backups are unaffected. See the [Privacy Policy](/legal/privacy-policy/) and [recording maintenance](/self-hosting/maintenance/#conversation-recording-storage).
