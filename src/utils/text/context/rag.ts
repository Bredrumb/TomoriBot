import { sql } from "@/utils/db/client";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { loadEmbeddingModelById } from "@/utils/db/repositories";
import { formatRetrievedChunksForPrompt, retrieveRelevantDocumentChunks } from "@/utils/documents/documentService";
import { log } from "@/utils/misc/logger";
import { resolveCapabilityCredentials, getResolvedCapabilityModelId } from "@/utils/provider/credentialResolver";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { SimplifiedMessageForContext } from "./types";

const DOCUMENT_QUERY_MAX_LENGTH = 1000;
const DOCUMENT_QUERY_MIN_LENGTH = 3;
const DOCUMENT_MAX_RESULTS = (() => {
  const parsed = Number.parseInt(process.env.DOCUMENT_MAX_RESULTS || "6", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 6;
})();
const DOCUMENT_MIN_SIMILARITY = (() => {
  const parsed = Number.parseFloat(process.env.DOCUMENT_MIN_SIMILARITY || "0.5");
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
})();

function getLatestUserQuery(messages: SimplifiedMessageForContext[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.authorType !== "user") continue;
    if (!msg.content) continue;
    if (msg.authorId === "0") continue;
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[System:")) continue;
    return trimmed.slice(0, DOCUMENT_QUERY_MAX_LENGTH);
  }

  return null;
}

export async function buildServerDocumentContextItem(params: {
  tomoriState: TomoriState | null | undefined;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  triggererUserId?: number;
}): Promise<StructuredContextItem | null> {
  try {
    const { tomoriState, simplifiedMessageHistory, triggererUserId } = params;
    if (!isRagAvailable() || memoryGuard.getStatus() === "critical" || !tomoriState?.server_id) {
      return null;
    }

    const queryText = getLatestUserQuery(simplifiedMessageHistory);
    if (!queryText || queryText.length < DOCUMENT_QUERY_MIN_LENGTH) {
      return null;
    }

    const [documentRow] =
      tomoriState.tomori_id === null || tomoriState.tomori_id === undefined
        ? await sql`
            SELECT document_id
            FROM documents
            WHERE server_id = ${tomoriState.server_id}
              AND tomori_id IS NULL
            LIMIT 1
          `
        : await sql`
            SELECT document_id
            FROM documents
            WHERE server_id = ${tomoriState.server_id}
              AND (
                tomori_id = ${tomoriState.tomori_id}
                OR tomori_id IS NULL
              )
            LIMIT 1
          `;

    if (!documentRow?.document_id) {
      return null;
    }

    const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
      userId: triggererUserId ?? null,
    });
    const resolvedEmbeddingModelId =
      getResolvedCapabilityModelId(creds, "embedding") ?? tomoriState.config.embedding_model_id;
    const embeddingModel = resolvedEmbeddingModelId ? await loadEmbeddingModelById(resolvedEmbeddingModelId) : null;
    if (!embeddingModel) {
      return null;
    }

    const chunks = await retrieveRelevantDocumentChunks({
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.tomori_id ?? null,
      query: queryText,
      embeddingModel,
      apiKey: creds.apiKey,
      maxResults: DOCUMENT_MAX_RESULTS,
      minSimilarity: DOCUMENT_MIN_SIMILARITY,
    });

    const documentContext = formatRetrievedChunksForPrompt(chunks);
    if (!documentContext) {
      return null;
    }

    return {
      role: "user",
      parts: [{ type: "text", text: documentContext }],
      metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
    };
  } catch (error) {
    log.warn("Failed to add server document context", error);
    return null;
  }
}
