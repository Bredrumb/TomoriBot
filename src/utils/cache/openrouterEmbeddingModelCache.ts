// OpenRouter omits embedding models from `/api/v1/models`, so registration must validate against this separate
// catalog endpoint.

import {
  createOpenRouterCatalog,
  type OpenRouterCatalogModelEntry,
  parseOpenRouterCatalogModelList,
} from "@/utils/cache/openrouterCatalog";

const OPENROUTER_EMBEDDING_MODELS_URL = "https://openrouter.ai/api/v1/embeddings/models";

function parseOpenRouterEmbeddingModelList(payload: unknown): OpenRouterCatalogModelEntry[] {
  return parseOpenRouterCatalogModelList("embedding", payload);
}

const embeddingCatalog = createOpenRouterCatalog<OpenRouterCatalogModelEntry>({
  label: "embedding",
  url: OPENROUTER_EMBEDDING_MODELS_URL,
  parse: parseOpenRouterEmbeddingModelList,
  keyOf: (entry) => entry.id,
});

export async function initializeOpenRouterEmbeddingModelCache(): Promise<void> {
  await embeddingCatalog.initialize();
}

export function getOrFetchOpenRouterEmbeddingModel(
  modelCodename: string,
  options?: { fresh?: boolean },
): Promise<OpenRouterCatalogModelEntry | undefined> {
  return embeddingCatalog.getOrFetch(modelCodename, options);
}

export function refreshOpenRouterEmbeddingModelCacheIfStale(): Promise<boolean> {
  return embeddingCatalog.refreshIfStale();
}

export function getOpenRouterEmbeddingModelCacheSize(): number {
  return embeddingCatalog.size();
}
