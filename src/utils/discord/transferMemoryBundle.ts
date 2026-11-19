import type { MemoryBucket, ParsedExportPayload } from "@/types/db/dataExport";

// V1 combined exports nested under memories return null because memory entry points refuse that shape and all callers
// must agree on importable bundles.
export function readMemoryBundleBuckets(payload: ParsedExportPayload): MemoryBucket[] | null {
  if (!payload || typeof payload !== "object" || !("buckets" in payload) || !Array.isArray(payload.buckets)) {
    return null;
  }
  return payload.buckets;
}
