import { z } from "zod";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

// Registration waits on this inside an already deferred panel submit, so a slow catalog lookup only delays the
// receipt.
export const MODEL_LOOKUP_TIMEOUT_MS = 5_000;

const openAIModelListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

// Catalog lookup failures are logged as expected rather than incidents because registration proceeds unchecked and
// the first request catches bad codenames.
export async function reportModelLookupFailure(provider: string, error: unknown, apiKey?: string): Promise<void> {
  await reportProviderFailure({
    summary: "Model catalog lookup failed",
    errorType: "ModelCatalogLookupFailed",
    error,
    expected: true,
    dimensions: { provider, operation: "model_lookup" },
    redactValues: apiKey ? [apiKey] : undefined,
  });
}

// Empty /models listings return null rather than false because some endpoints describe the account rather than the
// full catalog.
export async function isListedInOpenAIModelCatalog(params: {
  provider: string;
  url: string;
  modelId: string;
  apiKey?: string;
}): Promise<boolean | null> {
  try {
    const response = await fetch(params.url, {
      headers: params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : undefined,
      signal: AbortSignal.timeout(MODEL_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      await reportModelLookupFailure(params.provider, new Error(`Model listing returned ${response.status}`));
      return null;
    }
    const listing = openAIModelListSchema.safeParse(await response.json());
    if (!listing.success) {
      await reportModelLookupFailure(params.provider, listing.error);
      return null;
    }
    if (listing.data.data.length === 0) return null;
    return listing.data.data.some((model) => model.id === params.modelId);
  } catch (error) {
    await reportModelLookupFailure(params.provider, error, params.apiKey);
    return null;
  }
}
