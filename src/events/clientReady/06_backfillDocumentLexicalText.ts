import { sql } from "@/utils/db/client";
import { backfillDocumentLexicalTextBatch } from "@/utils/documents/documentService";
import { log } from "@/utils/misc/logger";

const BATCH_DELAY_MS = 1000;
const RETRY_DELAY_MS = 60_000;

let running = false;

export default (): void => {
  if (running) return;
  running = true;
  let selected = 0;
  let updated = 0;
  const run = async (): Promise<void> => {
    try {
      const [schema] = await sql`SELECT to_regclass('public.document_chunks') IS NOT NULL AS ready`;
      if (!schema?.ready) {
        running = false;
        return;
      }
      const batch = await backfillDocumentLexicalTextBatch();
      selected += batch.selected;
      updated += batch.updated;
      log.metric("document_lexical_backfill", { selected: batch.selected, updated: batch.updated });
      if (batch.selected > 0) {
        setTimeout(() => void run(), BATCH_DELAY_MS).unref();
      } else {
        running = false;
      }
    } catch {
      log.warn("Document lexical backfill failed; pending rows will retry", undefined, {
        metadata: { selected, updated, failed: 1 },
      });
      setTimeout(() => void run(), RETRY_DELAY_MS).unref();
    }
  };
  setTimeout(() => void run(), BATCH_DELAY_MS).unref();
};
