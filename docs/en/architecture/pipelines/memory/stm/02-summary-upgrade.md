---
title: "STM 02: Background Summary"
aiGenerated: true
---

The background summarizer maintains a durable short-term memory (STM) summary or category values
for each channel and persona scope.

## Scheduling and request

After passive capture advances the scope's reply counter, `writeShortTermMemory` schedules
`startStmSummarizer` without waiting for the summary request. Automatic summarization must be on,
the scope must reach the server's summary interval (10 bot replies by default), and the provider
must support conversation summaries. Tool Use and model tool support are independent of this
check. NovelAI does not support conversation summaries.

The request uses the finishing reply attempt's provider, model, endpoint, and credentials,
including a personal API key. This is a separate generation charged to those credentials.
Server stats and applicable subscription usage attribute its tokens to that model.

The prompt contains the previous STM, the server's category definitions, the available messages
since the last summary, and the newly delivered reply. It uses the default summarizer instructions
or the server override, with no character prompt. The default instructions ask for neutral third
person. The response is plain text, with one `### <Label>` section per category in category mode.

## Write and retry

Only one run can be in flight per live scope (server, channel, and persona in a guild, or user,
channel, and persona in a DM). The summarizer snapshots the stored memory before the request.
The cache and persistence checks discard the result if that memory was edited or cleared
while the request was running. A successful write saves the memory and its
`summarized_through` cursor and resets the cadence in one transaction. The cache updates
after commit.

The cursor records the newest included timestamp from the fetched history. It excludes the
appended reply's timestamp, so messages arriving between the history fetch and reply delivery
remain eligible for the next summary. A terminal provider error or timeout can still leave
delivered text in passive capture, but it cannot start a summary or advance the cursor.
A failed summary leaves the stored memory, cursor, and cadence intact. The next eligible reply
retries from the last saved cursor. The summarizer posts nothing to Discord.

## Source pointers

- `src/utils/chat/postTurnEffects.ts`, `writeShortTermMemory`
- `src/utils/memory/stmSummarizer.ts`, `startStmSummarizer`
- `src/utils/cache/shortTermMemoryCache.ts`, `persistStmSummarization`
- [STM overview](/architecture/pipelines/memory/stm/) for hydration and deletion.
