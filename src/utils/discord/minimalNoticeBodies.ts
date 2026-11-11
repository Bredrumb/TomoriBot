import type { MinimalNoticeRef, ResolvedMinimalNoticeRefRow } from "@/types/db/schema";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { extractNoticeTextFromComponents, hasMediaGallery } from "@/utils/discord/componentNoticeReader";
import { buildGeneratedMediaSourceLine } from "@/utils/discord/generatedMediaMetadata";
import { classifyProtocolTitle, isMinimalTitleKind } from "@/utils/discord/embedProtocol";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { log } from "@/utils/misc/logger";

const RETENTION_DAYS = 30;
// Pruning piggybacks on the write path because production has no scheduled jobs.
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastPruneAt = 0;

export async function recordMinimalNoticeRef(messageDiscId: string, ref: MinimalNoticeRef): Promise<void> {
  await minimalNoticeRefRepository.record(messageDiscId, ref);
  void pruneIfDue();
}

async function pruneIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;

  const deleted = await minimalNoticeRefRepository.pruneOlderThanDays(RETENTION_DAYS);
  if (deleted > 0) {
    log.info(`[MinimalNoticeRefs] Pruned ${deleted} rows older than ${RETENTION_DAYS} days`);
  }
}

function isBodylessMinimalNotice(components: readonly unknown[] | undefined): boolean {
  const notice = extractNoticeTextFromComponents(components);
  return Boolean(notice?.title && !notice.description && isMinimalTitleKind(classifyProtocolTitle(notice.title)));
}

export function formatMinimalNoticeBody(row: ResolvedMinimalNoticeRefRow): string | null {
  if (row.ref_kind === "generation") {
    return buildGeneratedMediaSourceLine("en-US", row.generation_source);
  }
  if (row.ref_kind === "task") {
    return row.reminder_purpose === null ? null : `ID:${row.ref_id} "${row.reminder_purpose}"`;
  }
  return row.memory_content === null ? null : formatMemoryWithId(row.ref_id, row.memory_content, row.memory_tags ?? []);
}

export async function resolveMinimalNoticeBodies(
  messages: Iterable<{ id: string; components?: readonly unknown[]; attachments?: { size: number } }>,
): Promise<Map<string, string>> {
  const candidateIds: string[] = [];
  for (const message of messages) {
    if (
      isBodylessMinimalNotice(message.components) ||
      hasMediaGallery(message.components) ||
      message.attachments?.size
    ) {
      candidateIds.push(message.id);
    }
  }

  const bodies = new Map<string, string>();
  if (candidateIds.length === 0) {
    return bodies;
  }

  const rows = await minimalNoticeRefRepository.resolveByMessageIds(candidateIds);
  for (const [messageDiscId, row] of rows) {
    const body = formatMinimalNoticeBody(row);
    if (body !== null) {
      bodies.set(messageDiscId, body);
    }
  }
  return bodies;
}
